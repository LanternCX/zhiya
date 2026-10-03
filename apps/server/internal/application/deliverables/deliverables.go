package deliverables

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	fault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	models  data.Models
	objects objectstore.Store
}

func New(models data.Models, objects objectstore.Store) *Service { return &Service{models, objects} }

type Write struct {
	RequestID   string                     `json:"requestId"`
	Kind        string                     `json:"kind"`
	Title       *string                    `json:"title"`
	Blocks      []domain.DeliverableBlock  `json:"blocks"`
	Revision    int                        `json:"revision"`
	Changes     []domain.DeliverableChange `json:"changes"`
	importNotes []string
}

func (s *Service) within(ctx context.Context, auth identity.Authorize, course string, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		user, err := auth(ctx, m)
		if err != nil {
			return err
		}
		if err = m.Deliverables.LockCourse(ctx, user.ID, course); err != nil {
			return err
		}
		return action(m, user)
	})
}

func (s *Service) List(ctx context.Context, auth identity.Authorize, course string) (items []domain.Deliverable, err error) {
	err = s.within(ctx, auth, course, func(m data.Models, user domain.User) error {
		stored, e := m.Deliverables.List(ctx, course)
		if e != nil {
			return e
		}
		items, e = classroomFiles(ctx, m, user.ID, course, stored)
		items = append(items, stored...)
		return e
	})
	return
}

func (s *Service) Get(ctx context.Context, auth identity.Authorize, course, id string) (item domain.Deliverable, err error) {
	if id == "classroom" || id == "course-document" {
		items, e := s.List(ctx, auth, course)
		if e != nil {
			return item, e
		}
		for _, candidate := range items {
			if candidate.ID == id {
				return candidate, nil
			}
		}
	}
	err = s.within(ctx, auth, course, func(m data.Models, _ domain.User) error {
		item, err = m.Deliverables.Get(ctx, course, id)
		return missing(err)
	})
	return
}

func missing(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return fault.Error{Code: fault.ErrorNotFound, Message: "未找到交付产物或图片"}
	}
	return err
}

func (s *Service) Write(ctx context.Context, auth identity.Authorize, course, id string, input Write) (result domain.Deliverable, err error) {
	if id == "classroom" || id == "course-document" {
		return result, fault.Invalid("请修改课堂源页面、课程大纲或文档补充内容；PPT 和课程文档会同步更新")
	}
	if input.RequestID == "" || len(input.RequestID) > 200 {
		return result, fault.Invalid("缺少有效操作标识")
	}
	raw, _ := json.Marshal(input)
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(append([]byte(id+":"), raw...)))
	err = s.within(ctx, auth, course, func(m data.Models, user domain.User) error {
		previous, saved, receiptErr := m.Deliverables.Receipt(ctx, course, input.RequestID)
		if receiptErr == nil {
			if previous != fingerprint {
				return fault.Conflict("操作标识已用于其他修改")
			}
			result = saved
			return nil
		}
		if !errors.Is(receiptErr, pgx.ErrNoRows) {
			return receiptErr
		}
		if id == "" {
			result = domain.Deliverable{ID: identifier.New(), Kind: input.Kind, Blocks: input.Blocks, ImportNotes: input.importNotes}
		} else {
			var e error
			result, e = m.Deliverables.Get(ctx, course, id)
			if e != nil {
				return missing(e)
			}
			if result.Revision != input.Revision {
				return fault.Conflict("产物已被修改，请重新读取后编辑")
			}
			if input.Blocks != nil || input.Kind != "" {
				return fault.Invalid("请使用 changes 修改指定内容")
			}
			if e = change(&result, input.Changes); e != nil {
				return e
			}
		}
		if input.Title != nil {
			result.Title = strings.TrimSpace(*input.Title)
		}
		if e := validate(&result); e != nil {
			return e
		}
		for _, block := range result.Blocks {
			for _, image := range block.ImageIDs {
				if _, e := m.Deliverables.Image(ctx, course, image); e == nil {
					continue
				} else if !errors.Is(e, pgx.ErrNoRows) {
					return e
				}
				original, e := m.Illustrations.Get(ctx, user.ID, course, image)
				if e != nil || original.Status != "complete" {
					return fault.Invalid("图片不存在或尚未生成完成")
				}
				key := "courses/" + course + "/deliverables/images/" + image
				if e = s.objects.Copy(ctx, original.ObjectKey, key); e != nil {
					return e
				}
				if e = m.Deliverables.SaveImage(ctx, course, image, key); e != nil {
					return e
				}
			}
		}
		result.Revision++
		result.UpdatedAt = time.Now().UTC()
		if e := m.Deliverables.Save(ctx, course, result); e != nil {
			return e
		}
		return m.Deliverables.Record(ctx, course, input.RequestID, fingerprint, result)
	})
	return
}

func change(item *domain.Deliverable, changes []domain.DeliverableChange) error {
	type replacement struct {
		start, end int
		text       string
	}
	groups := map[string][]replacement{}
	for _, edit := range changes {
		if edit.Action != "patch" {
			continue
		}
		index := slices.IndexFunc(item.Blocks, func(b domain.DeliverableBlock) bool { return b.ID == edit.BlockID })
		if index < 0 || (edit.Field != "markdown" && edit.Field != "title") || edit.OldText == "" {
			return fault.Invalid("请提供有效的内容标识、字段和唯一原文")
		}
		text := item.Blocks[index].Markdown
		if edit.Field == "title" {
			text = item.Blocks[index].Title
		}
		start := strings.Index(text, edit.OldText)
		if start < 0 {
			return fault.Invalid("找不到要修改的原文，请重新读取")
		}
		if strings.Contains(text[start+1:], edit.OldText) {
			return fault.Invalid("原文匹配多处，请增加上下文")
		}
		key := edit.BlockID + ":" + edit.Field
		for _, previous := range groups[key] {
			if start < previous.end && start+len(edit.OldText) > previous.start {
				return fault.Invalid("同一次修改不能包含重叠的原文范围")
			}
		}
		for _, other := range changes {
			if other.BlockID == edit.BlockID && other.Action != "patch" {
				return fault.Invalid("同一内容不能同时使用局部 patch 与结构修改")
			}
		}
		groups[key] = append(groups[key], replacement{start: start, end: start + len(edit.OldText), text: edit.NewText})
	}
	for key, edits := range groups {
		parts := strings.SplitN(key, ":", 2)
		index := slices.IndexFunc(item.Blocks, func(b domain.DeliverableBlock) bool { return b.ID == parts[0] })
		text := &item.Blocks[index].Markdown
		if parts[1] == "title" {
			text = &item.Blocks[index].Title
		}
		slices.SortFunc(edits, func(a, b replacement) int { return b.start - a.start })
		for _, edit := range edits {
			*text = (*text)[:edit.start] + edit.text + (*text)[edit.end:]
		}
	}
	for _, edit := range changes {
		if edit.Action == "patch" {
			continue
		}
		index := slices.IndexFunc(item.Blocks, func(b domain.DeliverableBlock) bool { return b.ID == edit.BlockID })
		if edit.Action != "insert" && index < 0 {
			return fault.Invalid("找不到要修改的页面或段落")
		}
		switch edit.Action {
		case "replace":
			if edit.Block == nil || edit.Block.ID != edit.BlockID {
				return fault.Invalid("替换内容必须保留原标识")
			}
			item.Blocks[index] = *edit.Block
		case "remove":
			item.Blocks = slices.Delete(item.Blocks, index, index+1)
		case "insert", "move":
			var block domain.DeliverableBlock
			if edit.Action == "insert" {
				if index >= 0 || edit.Block == nil || edit.Block.ID != edit.BlockID {
					return fault.Invalid("新内容标识无效或重复")
				}
				block = *edit.Block
			} else {
				block = item.Blocks[index]
				item.Blocks = slices.Delete(item.Blocks, index, index+1)
			}
			after := -1
			if edit.AfterID != "" {
				after = slices.IndexFunc(item.Blocks, func(b domain.DeliverableBlock) bool { return b.ID == edit.AfterID })
				if after < 0 {
					return fault.Invalid("找不到插入位置")
				}
			}
			item.Blocks = slices.Insert(item.Blocks, after+1, block)
		default:
			return fault.Invalid("不支持的产物修改操作")
		}
	}
	return nil
}

var blockID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var imageID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func validate(item *domain.Deliverable) error {
	if item.Kind != "presentation" && item.Kind != "document" {
		return fault.Invalid("产物类型应为演示文稿或文档")
	}
	if item.Title == "" || len([]rune(item.Title)) > 120 || len(item.Blocks) < 1 || len(item.Blocks) > 100 {
		return fault.Invalid("请提供标题和 1–100 个页面或章节")
	}
	seen := map[string]bool{}
	total := 0
	for i := range item.Blocks {
		b := &item.Blocks[i]
		if !blockID.MatchString(b.ID) || seen[b.ID] || strings.TrimSpace(b.Title) == "" || len([]rune(b.Title)) > 120 || len(b.Markdown) > 24000 || len(b.ImageIDs) > 4 {
			return fault.Invalid("页面或章节内容无效、过长或标识重复")
		}
		seen[b.ID] = true
		total += len(b.Markdown)
		if b.ImageIDs == nil {
			b.ImageIDs = []string{}
		}
		for _, id := range b.ImageIDs {
			if !imageID.MatchString(id) {
				return fault.Invalid("图片标识无效")
			}
		}
		if strings.Contains(b.Markdown, "![") {
			return fault.Invalid("请使用 imageIds 插入图片")
		}
	}
	if total > 300000 {
		return fault.Invalid("产物内容过长，请分为多份")
	}
	return nil
}

func (s *Service) Image(ctx context.Context, auth identity.Authorize, course, id string) (request objectstore.Request, err error) {
	err = s.within(ctx, auth, course, func(m data.Models, user domain.User) error {
		key, e := m.Deliverables.Image(ctx, course, id)
		if errors.Is(e, pgx.ErrNoRows) {
			illustration, readErr := m.Illustrations.Get(ctx, user.ID, course, id)
			if readErr != nil || illustration.Status != "complete" {
				return missing(pgx.ErrNoRows)
			}
			key, e = illustration.ObjectKey, nil
		}
		if e != nil {
			return missing(e)
		}
		request, e = s.objects.PresignDownload(ctx, key, 5*time.Minute)
		return e
	})
	return
}
