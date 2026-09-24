package application

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

const illustrationTextMax = 1000

type IllustrationService struct {
	models    data.Models
	objects   objectstore.Store
	generator imagegen.Generator
	modelID   string
	urlTTL    time.Duration
}

func NewIllustrationService(models data.Models, objects objectstore.Store, generator imagegen.Generator, modelID string, urlTTLSeconds int) *IllustrationService {
	return &IllustrationService{models: models, objects: objects, generator: generator, modelID: modelID, urlTTL: time.Duration(urlTTLSeconds) * time.Second}
}

func (s *IllustrationService) withUser(ctx context.Context, token, claimedUser string, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		if token == "" {
			return data.ErrInvalidSession
		}
		user, err := models.Users.GetBySession(ctx, token, claimedUser)
		if err != nil {
			return err
		}
		return action(models, user)
	})
}

func (s *IllustrationService) Create(ctx context.Context, token, claimedUser, courseID, conversationID, pageID, title, description, alt string) (domain.IllustrationGeneration, error) {
	values := []*string{&conversationID, &pageID, &title, &description, &alt}
	for _, value := range values {
		*value = strings.TrimSpace(*value)
	}
	if conversationID == "" || pageID == "" || title == "" || description == "" || alt == "" || len([]rune(description)) > illustrationTextMax {
		return domain.IllustrationGeneration{}, Invalid("教学插图参数无效")
	}
	var user domain.User
	err := s.withUser(ctx, token, claimedUser, func(models data.Models, current domain.User) error {
		user = current
		return models.Illustrations.Authorize(ctx, current.ID, courseID, conversationID)
	})
	if err != nil {
		return domain.IllustrationGeneration{}, err
	}
	prompt := description + "。面向中小学生，保持清晰的二维平面视觉表达，避免三维建模、塑料质感和夸张立体透视。沿用描述指定的风格；未指定时依据内容选择水彩绘本、彩铅插画、扁平矢量或手绘示意图，漫画只在叙事动作或分镜确有帮助时使用。突出主体、动作或知识关系，构图有层次和适当留白，色彩协调。可用于绘本场景、思维导图、知识示意图、轻文字视觉课件页或课件配图，布局服从教学目的。仅在描述需要时绘制少量简短中文词语或短句，避免密集文字、长段落和大面积文字覆盖；未要求时不自行添加文字。需要逐字准确的标题、公式和较长说明由页面文字呈现。不要水印或Logo。"
	var result domain.IllustrationGeneration
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		var createErr error
		result, createErr = models.Illustrations.Create(ctx, user.ID, courseID, conversationID, pageID, title, alt, prompt, s.modelID)
		return createErr
	})
	return result, err
}

func (s *IllustrationService) Generate(ctx context.Context, id string) error {
	result, err := s.models.Illustrations.GetInternal(ctx, id)
	if err != nil || result.Status != "running" {
		return err
	}
	imageURL, err := s.generator.Generate(ctx, result.Prompt)
	if err != nil {
		_ = s.models.Illustrations.Fail(ctx, id, "图片生成失败")
		return err
	}
	body, mediaType, err := s.generator.Download(ctx, imageURL)
	if err != nil {
		_ = s.models.Illustrations.Fail(ctx, id, "图片下载失败")
		return err
	}
	defer body.Close()
	if !strings.HasPrefix(mediaType, "image/") {
		_ = s.models.Illustrations.Fail(ctx, id, "图片格式无效")
		return fmt.Errorf("image provider returned %q", mediaType)
	}
	objectKey := "courses/" + result.CourseID + "/illustrations/" + result.ID
	if err = s.objects.Put(ctx, objectKey, mediaType, body); err != nil {
		_ = s.models.Illustrations.Fail(ctx, id, "图片保存失败")
		return err
	}
	completed, err := s.models.Illustrations.Complete(ctx, id, objectKey)
	if err != nil || !completed {
		_ = s.objects.Delete(ctx, objectKey)
	}
	return err
}

func (s *IllustrationService) Get(ctx context.Context, token, claimedUser, courseID, id string) (domain.IllustrationGeneration, error) {
	var result domain.IllustrationGeneration
	err := s.withUser(ctx, token, claimedUser, func(models data.Models, user domain.User) error {
		var getErr error
		result, getErr = models.Illustrations.Get(ctx, user.ID, courseID, id)
		return getErr
	})
	return result, err
}

func (s *IllustrationService) Cancel(ctx context.Context, token, claimedUser, courseID, id string) error {
	var result domain.IllustrationGeneration
	err := s.withUser(ctx, token, claimedUser, func(models data.Models, user domain.User) error {
		var getErr error
		result, getErr = models.Illustrations.Get(ctx, user.ID, courseID, id)
		return getErr
	})
	if err != nil || result.Status != "running" {
		return err
	}
	if err := s.models.Illustrations.Cancel(ctx, id); err != nil {
		return err
	}
	return nil
}

func (s *IllustrationService) CleanupStale(ctx context.Context, now time.Time) error {
	return s.models.Illustrations.ExpireRunning(ctx, now.Add(-time.Hour))
}

func (s *IllustrationService) Download(ctx context.Context, token, claimedUser, courseID, id string) (objectstore.Request, error) {
	result, err := s.Get(ctx, token, claimedUser, courseID, id)
	if err != nil {
		return objectstore.Request{}, err
	}
	if result.Status != "complete" || result.ObjectKey == "" {
		return objectstore.Request{}, Conflict("教学插图尚未生成完成")
	}
	return s.objects.PresignDownload(ctx, result.ObjectKey, s.urlTTL)
}
