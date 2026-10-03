package courses

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/jackc/pgx/v5"
)

type MaterialContent struct {
	Material domain.CourseMaterial `json:"material"`
	Revision int                   `json:"revision"`
	Excerpt  materialparse.Excerpt `json:"excerpt"`
}

func (s *Service) ReadMaterial(ctx context.Context, authorize identity.Authorize, courseID, materialID string, revision, start, end int) (MaterialContent, error) {
	var out MaterialContent
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		out.Material, err = models.Materials.Get(ctx, user.ID, courseID, materialID)
		if err != nil {
			return err
		}
		if revision == 0 {
			revision = out.Material.ParseRevision
		}
		out.Revision = revision
		p, err := models.Materials.Parse(ctx, materialID, revision)
		if err != nil {
			return err
		}
		if p.Status == "failed" {
			return appfault.Conflict("材料解析失败：" + p.Error + "；可以重试解析")
		}
		if p.Status != "ready" && p.Status != "partial" {
			return appfault.Conflict("材料正在解析，请稍后读取；不要反复轮询")
		}
		var doc materialparse.Document
		if err = json.Unmarshal(p.Document, &doc); err != nil {
			return err
		}
		out.Excerpt, err = doc.Read(start, end)
		if err != nil {
			return appfault.Invalid(err.Error())
		}
		return nil
	})
	return out, err
}

func (s *Service) RetryMaterial(ctx context.Context, authorize identity.Authorize, courseID, materialID string) (int, error) {
	var revision int
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		if _, err := models.Materials.Get(ctx, user.ID, courseID, materialID); err != nil {
			return err
		}
		var err error
		revision, err = models.Materials.RetryParse(ctx, materialID)
		return err
	})
	return revision, err
}

type MaterialParser interface {
	Parse(context.Context, string, []byte) (materialparse.Document, error)
}

// Upload completion returns only after its parsed copy is readable. The lease also
// prevents duplicate conversion when a worker or another completion request wins.
func (s *Service) completeMaterialParse(ctx context.Context, material domain.CourseMaterial) (domain.CourseMaterial, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	for {
		p, err := s.models.Materials.Parse(ctx, material.ID, material.ParseRevision)
		if err != nil {
			return domain.CourseMaterial{}, err
		}
		material.ParseStatus = p.Status
		switch p.Status {
		case "ready", "partial":
			return material, nil
		case "failed":
			return domain.CourseMaterial{}, appfault.Conflict("材料解析失败：" + p.Error + "；请重试解析")
		}
		claimed, err := s.models.Materials.ClaimMaterialParse(ctx, material.ID, material.ParseRevision)
		if err == nil {
			if err = s.processMaterial(ctx, s.parser, claimed); err != nil {
				return domain.CourseMaterial{}, err
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return domain.CourseMaterial{}, err
		}
		select {
		case <-ctx.Done():
			return domain.CourseMaterial{}, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// ProcessNextMaterial may run in multiple server instances; the database owns the lease.
func (s *Service) ProcessNextMaterial(ctx context.Context, parser MaterialParser) (bool, error) {
	p, err := s.models.Materials.ClaimParse(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, s.processMaterial(ctx, parser, p)
}

func (s *Service) processMaterial(ctx context.Context, parser MaterialParser, p data.MaterialParse) error {
	var err error
	work, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	doc, parseErr := s.parseMaterial(work, parser, p)
	p.Status = "failed"
	if parseErr != nil {
		p.Error = parseErr.Error()
	} else {
		p.Status = doc.Status
		p.Document, err = json.Marshal(doc)
		if err != nil {
			return err
		}
	}
	// A disconnected uploader or shutdown must not hold the material's lease.
	if ctx.Err() != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := s.models.Materials.ReleaseParse(cleanup, p); err != nil {
			return fmt.Errorf("%w: failed to release parsing lease: %v", ctx.Err(), err)
		}
		return ctx.Err()
	}
	return s.models.Materials.FinishParse(ctx, p)
}

func (s *Service) parseMaterial(ctx context.Context, parser MaterialParser, p data.MaterialParse) (materialparse.Document, error) {
	content, metadata, err := s.objects.Open(ctx, p.ObjectKey)
	if err != nil {
		return materialparse.Document{}, fmt.Errorf("无法读取原文件")
	}
	defer content.Close()
	if metadata.SizeBytes > int64(s.maxBodyBytes) {
		return materialparse.Document{}, fmt.Errorf("原文件超过大小限制")
	}
	raw, err := io.ReadAll(io.LimitReader(content, int64(s.maxBodyBytes)+1))
	if err != nil || len(raw) > s.maxBodyBytes || int64(len(raw)) != metadata.SizeBytes {
		return materialparse.Document{}, fmt.Errorf("原文件读取不完整")
	}
	return parser.Parse(ctx, p.Name, raw)
}
