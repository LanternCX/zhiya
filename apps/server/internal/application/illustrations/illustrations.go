package illustrations

import (
	"context"
	"fmt"
	"strings"
	"time"

	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/imagegen"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

const illustrationTextMax = 1000

type Service struct {
	models    data.Models
	objects   objectstore.Store
	generator imagegen.Generator
	modelID   string
	urlTTL    time.Duration
}

func New(models data.Models, objects objectstore.Store, generator imagegen.Generator, modelID string, urlTTLSeconds int) *Service {
	return &Service{models: models, objects: objects, generator: generator, modelID: modelID, urlTTL: time.Duration(urlTTLSeconds) * time.Second}
}

func (s *Service) withUser(ctx context.Context, authorize identity.Authorize, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		user, err := authorize(ctx, models)
		if err != nil {
			return err
		}
		return action(models, user)
	})
}

func (s *Service) Create(ctx context.Context, authorize identity.Authorize, courseID, conversationID, pageID, title, description, alt string) (domain.IllustrationGeneration, error) {
	values := []*string{&conversationID, &pageID, &title, &description, &alt}
	for _, value := range values {
		*value = strings.TrimSpace(*value)
	}
	if conversationID == "" || pageID == "" || title == "" || description == "" || alt == "" || len([]rune(description)) > illustrationTextMax {
		return domain.IllustrationGeneration{}, appfault.Invalid("教学插图参数无效")
	}
	var user domain.User
	err := s.withUser(ctx, authorize, func(models data.Models, current domain.User) error {
		user = current
		return models.Illustrations.Authorize(ctx, current.ID, courseID, conversationID)
	})
	if err != nil {
		return domain.IllustrationGeneration{}, err
	}
	prompt := description + "。这是一张依据本次描述从头构图的全新画面，不是修改输入图片。请仅参考输入图片的视觉风格：柔和的水彩和水粉笔触、温暖自然的光线与细腻纸张肌理；若本次描述明确指定其他风格，以描述为准。不要复用参考图中的孩子、教室、电脑、白板、灯泡、方框、箭头、道具或构图；除非本次描述需要这些元素，否则彻底舍弃。画面内容由本次描述决定，只加入有助于表达当前知识的元素。面向中小学生和课堂展示，保持清晰的二维平面表达，不使用三维建模质感。根据教学内容安排主体、知识关系和留白，绘本场景、示意图或课件配图可采用不同构图。仅在描述需要时绘制少量简短中文词语或短句，避免密集文字、长段落和大面积文字覆盖；未要求时不自行添加文字。需要逐字准确的标题、公式和较长说明由页面文字呈现。不要水印或Logo。"
	var result domain.IllustrationGeneration
	err = s.models.Transaction(ctx, data.StandardTransaction, func(models data.Models) error {
		var createErr error
		result, createErr = models.Illustrations.Create(ctx, user.ID, courseID, conversationID, pageID, title, alt, prompt, s.modelID)
		return createErr
	})
	return result, err
}

func (s *Service) Generate(ctx context.Context, id string) error {
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

func (s *Service) Get(ctx context.Context, authorize identity.Authorize, courseID, id string) (domain.IllustrationGeneration, error) {
	var result domain.IllustrationGeneration
	err := s.withUser(ctx, authorize, func(models data.Models, user domain.User) error {
		var getErr error
		result, getErr = models.Illustrations.Get(ctx, user.ID, courseID, id)
		return getErr
	})
	return result, err
}

func (s *Service) Cancel(ctx context.Context, authorize identity.Authorize, courseID, id string) error {
	var result domain.IllustrationGeneration
	err := s.withUser(ctx, authorize, func(models data.Models, user domain.User) error {
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

func (s *Service) CleanupStale(ctx context.Context, now time.Time) error {
	return s.models.Illustrations.ExpireRunning(ctx, now.Add(-time.Hour))
}

func (s *Service) Download(ctx context.Context, authorize identity.Authorize, courseID, id string) (objectstore.Request, error) {
	result, err := s.Get(ctx, authorize, courseID, id)
	if err != nil {
		return objectstore.Request{}, err
	}
	if result.Status != "complete" || result.ObjectKey == "" {
		return objectstore.Request{}, appfault.Conflict("教学插图尚未生成完成")
	}
	return s.objects.PresignDownload(ctx, result.ObjectKey, s.urlTTL)
}
