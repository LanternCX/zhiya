package courses

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	appfault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

const (
	courseTitleMax       = 80
	courseTopicMax       = 240
	courseLabelMax       = 32
	sectionTitleMax      = 100
	sectionObjectiveMax  = 500
	conversationTitleMax = 100
)

var courseMotifs = map[string]bool{"code": true, "orbit": true, "geometry": true, "language": true, "nature": true, "history": true, "abstract": true}
var coursePalettes = map[string]bool{"sprout": true, "sunrise": true, "ocean": true, "berry": true, "clay": true}

type Warn func(message string, err error, values ...any)

type Service struct {
	models       data.Models
	objects      objectstore.Store
	maxBodyBytes int
	urlTTL       time.Duration
	parser       MaterialParser
}

type Upload struct {
	Record  domain.CourseMaterialUpload
	Request objectstore.Request
}

type OutlineResult struct {
	Course         domain.Course
	Reorganization *domain.OutlineReorganization
}

func New(models data.Models, objects objectstore.Store, maxBodyBytes, urlTTLSeconds int, parser MaterialParser) *Service {
	return &Service{models: models, objects: objects, maxBodyBytes: maxBodyBytes, urlTTL: time.Duration(urlTTLSeconds) * time.Second, parser: parser}
}

func (s *Service) List(ctx context.Context, authorize identity.Authorize) ([]domain.Course, error) {
	var courses []domain.Course
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		courses, err = models.Courses.List(ctx, user.ID)
		return err
	})
	return courses, err
}

func (s *Service) Create(ctx context.Context, authorize identity.Authorize, title, topic string, cover domain.CourseCover) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = CreateInTransaction(ctx, models, user.ID, title, topic, cover)
		return err
	})
	return course, err
}

// CreateInTransaction validates and creates a course within the caller's transaction.
func CreateInTransaction(ctx context.Context, models data.Models, user, title, topic string, cover domain.CourseCover) (domain.Course, error) {
	var err error
	title, err = courseText(title, "课程名称", courseTitleMax)
	if err != nil {
		return domain.Course{}, err
	}
	topic, err = courseText(topic, "课程主题", courseTopicMax)
	if err != nil {
		return domain.Course{}, err
	}
	cover.Label, err = courseText(cover.Label, "封面标识", courseLabelMax)
	if err != nil || !courseMotifs[cover.Motif] || !coursePalettes[cover.Palette] {
		return domain.Course{}, appfault.Invalid("课程封面无效")
	}
	return models.Courses.Create(ctx, user, title, topic, cover)
}

func (s *Service) Get(ctx context.Context, authorize identity.Authorize, courseID string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = models.Courses.Get(ctx, user.ID, courseID)
		return err
	})
	return course, err
}

func (s *Service) Update(ctx context.Context, authorize identity.Authorize, courseID string, requestedTitle, requestedTopic *string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		current, err := models.Courses.Get(ctx, user.ID, courseID)
		if err != nil {
			return err
		}
		title, topic := current.Title, current.Topic
		if requestedTitle != nil {
			title, err = courseText(*requestedTitle, "课程名称", courseTitleMax)
			if err != nil {
				return err
			}
		}
		if requestedTopic != nil {
			topic, err = courseText(*requestedTopic, "课程主题", courseTopicMax)
			if err != nil {
				return err
			}
		}
		course, err = models.Courses.Update(ctx, user.ID, current.ID, title, topic)
		return err
	})
	return course, err
}

func courseText(value, field string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > max {
		return "", appfault.Invalid(field + "无效")
	}
	return value, nil
}

func (s *Service) SaveConversation(ctx context.Context, authorize identity.Authorize, courseID, conversationID string, state json.RawMessage) error {
	return s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		return models.Courses.SaveConversation(ctx, user.ID, courseID, conversationID, state)
	})
}

func (s *Service) GetOutlineReorganization(ctx context.Context, authorize identity.Authorize, courseID string) (domain.OutlineReorganization, error) {
	var result domain.OutlineReorganization
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		result, err = models.Courses.GetOutlineReorganization(ctx, user.ID, courseID)
		return err
	})
	return result, err
}

func (s *Service) CreateConversation(ctx context.Context, authorize identity.Authorize, courseID, sectionID, title string) (domain.CourseConversation, error) {
	var conversation domain.CourseConversation
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		conversation, err = CreateConversationInTransaction(ctx, models, user.ID, courseID, sectionID, title)
		return err
	})
	return conversation, err
}

func CreateConversationInTransaction(ctx context.Context, models data.Models, user, courseID, sectionID, title string) (domain.CourseConversation, error) {
	title, err := courseText(title, "对话名称", conversationTitleMax)
	if err != nil {
		return domain.CourseConversation{}, err
	}
	return models.Courses.CreateConversation(ctx, user, courseID, sectionID, title)
}

func AssignConversationInTransaction(ctx context.Context, models data.Models, user, conversationID, courseID, sectionID, title string) (domain.CourseConversation, error) {
	title, err := courseText(title, "对话名称", conversationTitleMax)
	if err != nil {
		return domain.CourseConversation{}, err
	}
	return models.Conversations.Assign(ctx, user, conversationID, courseID, sectionID, title)
}

func (s *Service) DeleteConversation(ctx context.Context, authorize identity.Authorize, courseID, sectionID, conversationID string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = models.Courses.DeleteConversation(ctx, user.ID, courseID, sectionID, conversationID)
		return err
	})
	return course, err
}

func (s *Service) ListMaterials(ctx context.Context, authorize identity.Authorize, courseID string) ([]domain.CourseMaterial, error) {
	var materials []domain.CourseMaterial
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		materials, err = models.Materials.List(ctx, user.ID, courseID)
		return err
	})
	return materials, err
}

func (s *Service) ReplaceOutline(ctx context.Context, authorize identity.Authorize, courseID string, outline []domain.OutlineSection) (OutlineResult, error) {
	if len(outline) == 0 || len(outline) > domain.CourseOutlineMaxSections {
		return OutlineResult{}, appfault.Invalid("课程大纲无效")
	}
	seen := make(map[string]bool, len(outline))
	for index := range outline {
		section := &outline[index]
		if section.ID != "" && seen[section.ID] {
			return OutlineResult{}, appfault.Invalid("课程大纲包含重复的小节")
		}
		seen[section.ID] = true
		var err error
		section.Title, err = courseText(section.Title, "小节名称", sectionTitleMax)
		if err != nil {
			return OutlineResult{}, err
		}
		section.Objective, err = courseText(section.Objective, "学习目标", sectionObjectiveMax)
		if err != nil {
			return OutlineResult{}, err
		}
		if section.Status != "" && section.Status != "planned" && section.Status != "active" && section.Status != "complete" && section.Status != "archived" {
			return OutlineResult{}, appfault.Invalid("小节状态无效")
		}
	}
	var result OutlineResult
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		current, err := models.Courses.Get(ctx, user.ID, courseID)
		if err != nil {
			return err
		}
		conversationCount := 0
		for _, section := range current.Sections {
			conversationCount += len(section.Conversations)
		}
		if conversationCount == 0 {
			result.Course, err = models.Courses.ReplaceOutline(ctx, user.ID, current.ID, outline)
			return err
		}
		reorganization, err := models.Courses.BeginOutlineReorganization(ctx, user.ID, current.ID, outline)
		if err == nil {
			result.Reorganization = &reorganization
		}
		return err
	})
	return result, err
}

func (s *Service) AssignOutlineConversation(ctx context.Context, authorize identity.Authorize, courseID, reorganizationID, conversationID, sectionID, reason string, updatedAt time.Time, newSection *domain.OutlineSection) (OutlineResult, error) {
	if updatedAt.IsZero() || (sectionID == "") == (newSection == nil) {
		return OutlineResult{}, appfault.Invalid("课程对话分类无效")
	}
	if newSection != nil {
		var err error
		newSection.Title, err = courseText(newSection.Title, "小节名称", sectionTitleMax)
		if err != nil {
			return OutlineResult{}, err
		}
		newSection.Objective, err = courseText(newSection.Objective, "学习目标", sectionObjectiveMax)
		if err != nil {
			return OutlineResult{}, err
		}
	}
	var result OutlineResult
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		reorganization, err := models.Courses.InspectOutlineReorganization(ctx, user.ID, courseID)
		if err != nil {
			return err
		}
		if reorganization.ID != reorganizationID {
			return data.ErrOutlineReorganizationNotFound
		}
		if newSection != nil && len(reorganization.Sections) >= domain.CourseOutlineMaxSections {
			return appfault.Invalid("课程大纲最多包含 100 个小节")
		}
		if newSection == nil {
			found := false
			for _, section := range reorganization.Sections {
				if section.ID == sectionID {
					found = true
					break
				}
			}
			if !found {
				return appfault.Invalid("目标课程小节无效")
			}
		}
		result.Course, result.Reorganization, err = models.Courses.AssignOutlineConversation(ctx, user.ID, courseID, reorganizationID, conversationID, sectionID, strings.TrimSpace(reason), updatedAt, newSection)
		return err
	})
	return result, err
}

func (s *Service) StartUpload(ctx context.Context, authorize identity.Authorize, courseID, name string, size int64, warn Warn) (Upload, error) {
	if s.objects == nil {
		return Upload{}, fmt.Errorf("object storage unavailable")
	}
	filename := filepath.Base(name)
	extension := strings.ToLower(filepath.Ext(filename))
	mediaType := materialparse.MediaTypes[extension]
	if mediaType == "" {
		return Upload{}, appfault.Invalid("不支持该文件格式；支持文本、PDF、Word、PPT 和图片")
	}
	if filename == "." || size <= 0 || size > int64(s.maxBodyBytes) {
		return Upload{}, appfault.Invalid("课程材料不能为空且不能超过大小限制")
	}
	expiresAt := time.Now().Add(s.urlTTL)
	objectKey := "uploads/courses/" + courseID + "/" + identifier.New() + "/source" + extension
	var upload domain.CourseMaterialUpload
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		upload, err = models.Materials.StartUpload(ctx, user.ID, courseID, filename, mediaType, objectKey, size, expiresAt)
		return err
	})
	if err != nil {
		return Upload{}, err
	}
	request, err := s.objects.PresignUpload(ctx, upload.ObjectKey, upload.MediaType, upload.SizeBytes, time.Until(upload.ExpiresAt))
	if err != nil {
		rollbackErr := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
			return models.Materials.CancelUpload(ctx, user.ID, courseID, upload.ID)
		})
		if rollbackErr != nil && warn != nil {
			warn("material upload rollback failed", rollbackErr, "upload_id", upload.ID)
		}
		return Upload{}, err
	}
	return Upload{Record: upload, Request: request}, nil
}

func (s *Service) CompleteUpload(ctx context.Context, authorize identity.Authorize, courseID, uploadID string, warn Warn) (domain.CourseMaterial, error) {
	if s.objects == nil {
		return domain.CourseMaterial{}, fmt.Errorf("object storage unavailable")
	}
	var upload domain.CourseMaterialUpload
	var material domain.CourseMaterial
	var completionFailure error
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		upload, err = models.Materials.GetUpload(ctx, user.ID, courseID, uploadID)
		if err != nil {
			return err
		}
		if time.Now().After(upload.ExpiresAt) {
			if deleteErr := s.objects.Delete(ctx, upload.ObjectKey); deleteErr != nil && warn != nil {
				warn("expired material object cleanup failed", deleteErr, "upload_id", upload.ID)
			}
			if err = models.Materials.CancelUpload(ctx, user.ID, courseID, upload.ID); err != nil {
				return err
			}
			completionFailure = appfault.Invalid("课程材料上传已过期，请重新上传")
			return nil
		}
		content, metadata, err := s.objects.Open(ctx, upload.ObjectKey)
		if err != nil {
			return appfault.Invalid("课程材料尚未上传完成")
		}
		valid := metadata.SizeBytes == upload.SizeBytes
		var textDocument []byte
		if strings.HasPrefix(upload.MediaType, "text/") {
			raw, readErr := io.ReadAll(io.LimitReader(content, int64(s.maxBodyBytes)+1))
			document, decodeErr := materialparse.New("", "", "", "", nil).Parse(ctx, upload.Name, raw)
			valid = valid && readErr == nil && decodeErr == nil && int64(len(raw)) == upload.SizeBytes
			if valid {
				textDocument, _ = json.Marshal(document)
			}
		}
		if closeErr := content.Close(); closeErr != nil && warn != nil {
			warn("material validation stream close failed", closeErr, "upload_id", upload.ID)
		}
		if !valid {
			if deleteErr := s.objects.Delete(ctx, upload.ObjectKey); deleteErr != nil && warn != nil {
				warn("invalid material object cleanup failed", deleteErr, "upload_id", upload.ID)
			}
			if err = models.Materials.CancelUpload(ctx, user.ID, courseID, upload.ID); err != nil {
				return err
			}
			completionFailure = appfault.Invalid("课程材料大小必须与上传申请一致，文本须使用 UTF-8、带 BOM 的 UTF-16 或 GB18030 编码")
			return nil
		}
		finalKey := "courses/" + upload.CourseID + "/materials/" + upload.ID + "/source" + strings.ToLower(filepath.Ext(upload.Name))
		if err = s.objects.Copy(ctx, upload.ObjectKey, finalKey); err != nil {
			return err
		}
		material, err = models.Materials.CompleteUpload(ctx, user.ID, courseID, upload.ID, finalKey)
		if err == nil && textDocument != nil {
			err = models.Materials.CompleteTextParse(ctx, material.ID, textDocument)
			material.ParseStatus = "ready"
		}
		return err
	})
	if errors.Is(err, data.ErrMaterialUploadNotFound) {
		existingErr := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
			var getErr error
			material, getErr = models.Materials.Get(ctx, user.ID, courseID, uploadID)
			return getErr
		})
		if existingErr == nil {
			return s.completeMaterialParse(ctx, material)
		}
	}
	if err != nil {
		return domain.CourseMaterial{}, err
	}
	if completionFailure != nil {
		return domain.CourseMaterial{}, completionFailure
	}
	if deleteErr := s.objects.Delete(ctx, upload.ObjectKey); deleteErr != nil && warn != nil {
		warn("temporary material object cleanup failed", deleteErr, "upload_id", upload.ID)
	}
	return s.completeMaterialParse(ctx, material)
}

func (s *Service) Download(ctx context.Context, authorize identity.Authorize, courseID, materialID string) (domain.CourseMaterial, objectstore.Request, error) {
	if s.objects == nil {
		return domain.CourseMaterial{}, objectstore.Request{}, fmt.Errorf("object storage unavailable")
	}
	var material domain.CourseMaterial
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		material, err = models.Materials.Get(ctx, user.ID, courseID, materialID)
		return err
	})
	if err != nil {
		return domain.CourseMaterial{}, objectstore.Request{}, err
	}
	request, err := s.objects.PresignDownload(ctx, material.ObjectKey, s.urlTTL)
	return material, request, err
}

func (s *Service) DeleteMaterial(ctx context.Context, authorize identity.Authorize, courseID, materialID string) error {
	if s.objects == nil {
		return fmt.Errorf("object storage unavailable")
	}
	var material domain.CourseMaterial
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		material, err = models.Materials.Get(ctx, user.ID, courseID, materialID)
		return err
	})
	if err == nil {
		err = s.objects.Delete(ctx, material.ObjectKey)
	}
	if err == nil {
		err = s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
			return models.Materials.Delete(ctx, user.ID, courseID, materialID)
		})
	}
	return err
}

func (s *Service) Delete(ctx context.Context, authorize identity.Authorize, courseID string) error {
	var materials []domain.CourseMaterial
	var uploads []domain.CourseMaterialUpload
	var images []string
	err := s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		materials, err = models.Materials.List(ctx, user.ID, courseID)
		if err == nil {
			uploads, err = models.Materials.ListUploads(ctx, user.ID, courseID)
		}
		if err == nil {
			images, err = models.Deliverables.ImageKeys(ctx, courseID)
		}
		return err
	})
	if err == nil && s.objects != nil {
		for _, material := range materials {
			if err = s.objects.Delete(ctx, material.ObjectKey); err != nil {
				break
			}
		}
		for _, upload := range uploads {
			if err = s.objects.Delete(ctx, upload.ObjectKey); err != nil {
				break
			}
		}
	}
	if err == nil && s.objects != nil {
		for _, key := range images {
			if err = s.objects.Delete(ctx, key); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = s.withUser(ctx, authorize, data.StandardTransaction, func(models data.Models, user domain.User) error { return models.Courses.Delete(ctx, user.ID, courseID) })
	}
	return err
}

func (s *Service) CleanupExpired(ctx context.Context, now time.Time, warn Warn) error {
	uploads, err := s.models.Materials.ExpiredUploads(ctx, now)
	if err != nil {
		return err
	}
	for _, upload := range uploads {
		if err := s.objects.Delete(ctx, upload.ObjectKey); err != nil {
			if warn != nil {
				warn("expired material object cleanup failed", err, "upload_id", upload.ID)
			}
			continue
		}
		if err := s.models.Materials.RemoveUpload(ctx, upload.ID); err != nil && warn != nil {
			warn("expired material record cleanup failed", err, "upload_id", upload.ID)
		}
	}
	return nil
}

func (s *Service) withUser(ctx context.Context, authorize identity.Authorize, mode data.TransactionMode, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, mode, func(models data.Models) error {
		user, err := authorize(ctx, models)
		if err != nil {
			return err
		}
		return action(models, user)
	})
}
