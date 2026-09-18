package application

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
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

type CourseService struct {
	models       data.Models
	objects      objectstore.Store
	maxBodyBytes int
	urlTTL       time.Duration
}

type Upload struct {
	Record  domain.CourseMaterialUpload
	Request objectstore.Request
}

type OutlineResult struct {
	Course         domain.Course
	Reorganization *domain.OutlineReorganization
}

func NewCourseService(models data.Models, objects objectstore.Store, maxBodyBytes, urlTTLSeconds int) *CourseService {
	return &CourseService{models: models, objects: objects, maxBodyBytes: maxBodyBytes, urlTTL: time.Duration(urlTTLSeconds) * time.Second}
}

func (s *CourseService) List(ctx context.Context, token, claimedUser string) ([]domain.Course, error) {
	var courses []domain.Course
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		courses, err = models.Courses.List(ctx, user.ID)
		return err
	})
	return courses, err
}

func (s *CourseService) Create(ctx context.Context, token, claimedUser, title, topic string, cover domain.CourseCover) (domain.Course, error) {
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
		return domain.Course{}, Invalid("课程封面无效")
	}
	var course domain.Course
	err = s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = models.Courses.Create(ctx, user.ID, title, topic, cover)
		return err
	})
	return course, err
}

func (s *CourseService) Get(ctx context.Context, token, claimedUser, courseID string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = models.Courses.Get(ctx, user.ID, courseID)
		return err
	})
	return course, err
}

func (s *CourseService) Update(ctx context.Context, token, claimedUser, courseID string, requestedTitle, requestedTopic *string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
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
		return "", Invalid(field + "无效")
	}
	return value, nil
}

func (s *CourseService) SaveConversation(ctx context.Context, token, claimedUser, courseID, conversationID string, state json.RawMessage) error {
	return s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		return models.Courses.SaveConversation(ctx, user.ID, courseID, conversationID, state)
	})
}

func (s *CourseService) GetOutlineReorganization(ctx context.Context, token, claimedUser, courseID string) (domain.OutlineReorganization, error) {
	var result domain.OutlineReorganization
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		result, err = models.Courses.GetOutlineReorganization(ctx, user.ID, courseID)
		return err
	})
	return result, err
}

func (s *CourseService) CreateConversation(ctx context.Context, token, claimedUser, courseID, sectionID, title string) (domain.CourseConversation, error) {
	var err error
	title, err = courseText(title, "对话名称", conversationTitleMax)
	if err != nil {
		return domain.CourseConversation{}, err
	}
	var conversation domain.CourseConversation
	err = s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		conversation, err = models.Courses.CreateConversation(ctx, user.ID, courseID, sectionID, title)
		return err
	})
	return conversation, err
}

func (s *CourseService) DeleteConversation(ctx context.Context, token, claimedUser, courseID, sectionID, conversationID string) (domain.Course, error) {
	var course domain.Course
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		course, err = models.Courses.DeleteConversation(ctx, user.ID, courseID, sectionID, conversationID)
		return err
	})
	return course, err
}

func (s *CourseService) ListMaterials(ctx context.Context, token, claimedUser, courseID string) ([]domain.CourseMaterial, error) {
	var materials []domain.CourseMaterial
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		materials, err = models.Materials.List(ctx, user.ID, courseID)
		return err
	})
	return materials, err
}

func (s *CourseService) ReplaceOutline(ctx context.Context, token, claimedUser, courseID string, outline []domain.OutlineSection) (OutlineResult, error) {
	if len(outline) == 0 || len(outline) > domain.CourseOutlineMaxSections {
		return OutlineResult{}, Invalid("课程大纲无效")
	}
	seen := make(map[string]bool, len(outline))
	for index := range outline {
		section := &outline[index]
		if section.ID != "" && seen[section.ID] {
			return OutlineResult{}, Invalid("课程大纲包含重复的小节")
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
			return OutlineResult{}, Invalid("小节状态无效")
		}
	}
	var result OutlineResult
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
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

func (s *CourseService) AssignOutlineConversation(ctx context.Context, token, claimedUser, courseID, reorganizationID, conversationID, sectionID, reason string, updatedAt time.Time, newSection *domain.OutlineSection) (OutlineResult, error) {
	if updatedAt.IsZero() || (sectionID == "") == (newSection == nil) {
		return OutlineResult{}, Invalid("课程对话分类无效")
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
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		reorganization, err := models.Courses.InspectOutlineReorganization(ctx, user.ID, courseID)
		if err != nil {
			return err
		}
		if reorganization.ID != reorganizationID {
			return data.ErrOutlineReorganizationNotFound
		}
		if newSection != nil && len(reorganization.Sections) >= domain.CourseOutlineMaxSections {
			return Invalid("课程大纲最多包含 100 个小节")
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
				return Invalid("目标课程小节无效")
			}
		}
		result.Course, result.Reorganization, err = models.Courses.AssignOutlineConversation(ctx, user.ID, courseID, reorganizationID, conversationID, sectionID, strings.TrimSpace(reason), updatedAt, newSection)
		return err
	})
	return result, err
}

func (s *CourseService) StartUpload(ctx context.Context, token, claimedUser, courseID, name string, size int64, warn Warn) (Upload, error) {
	if s.objects == nil {
		return Upload{}, fmt.Errorf("object storage unavailable")
	}
	filename := filepath.Base(name)
	extension := strings.ToLower(filepath.Ext(filename))
	mediaType := map[string]string{".md": "text/markdown", ".txt": "text/plain"}[extension]
	if mediaType == "" {
		return Upload{}, Invalid("目前仅支持 Markdown 和 TXT 文件")
	}
	if filename == "." || size <= 0 || size > int64(s.maxBodyBytes) {
		return Upload{}, Invalid("课程材料不能为空且不能超过大小限制")
	}
	expiresAt := time.Now().Add(s.urlTTL)
	objectKey := "uploads/courses/" + courseID + "/" + identifier.New() + "/source" + extension
	var upload domain.CourseMaterialUpload
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		upload, err = models.Materials.StartUpload(ctx, user.ID, courseID, filename, mediaType, objectKey, size, expiresAt)
		return err
	})
	if err != nil {
		return Upload{}, err
	}
	request, err := s.objects.PresignUpload(ctx, upload.ObjectKey, upload.MediaType, upload.SizeBytes, time.Until(upload.ExpiresAt))
	if err != nil {
		rollbackErr := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
			return models.Materials.CancelUpload(ctx, user.ID, courseID, upload.ID)
		})
		if rollbackErr != nil && warn != nil {
			warn("material upload rollback failed", rollbackErr, "upload_id", upload.ID)
		}
		return Upload{}, err
	}
	return Upload{Record: upload, Request: request}, nil
}

func (s *CourseService) CompleteUpload(ctx context.Context, token, claimedUser, courseID, uploadID string, warn Warn) (domain.CourseMaterial, error) {
	if s.objects == nil {
		return domain.CourseMaterial{}, fmt.Errorf("object storage unavailable")
	}
	var upload domain.CourseMaterialUpload
	var material domain.CourseMaterial
	var completionFailure error
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
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
			completionFailure = Invalid("课程材料上传已过期，请重新上传")
			return nil
		}
		content, metadata, err := s.objects.Open(ctx, upload.ObjectKey)
		if err != nil {
			return Invalid("课程材料尚未上传完成")
		}
		valid := metadata.SizeBytes == upload.SizeBytes && validUTF8(content)
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
			completionFailure = Invalid("课程材料必须是有效的 UTF-8 文本且大小必须与上传申请一致")
			return nil
		}
		finalKey := "courses/" + upload.CourseID + "/materials/" + upload.ID + "/source" + strings.ToLower(filepath.Ext(upload.Name))
		if err = s.objects.Copy(ctx, upload.ObjectKey, finalKey); err != nil {
			return err
		}
		material, err = models.Materials.CompleteUpload(ctx, user.ID, courseID, upload.ID, finalKey)
		return err
	})
	if errors.Is(err, data.ErrMaterialUploadNotFound) {
		existingErr := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
			var getErr error
			material, getErr = models.Materials.Get(ctx, user.ID, courseID, uploadID)
			return getErr
		})
		if existingErr == nil {
			return material, nil
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
	return material, nil
}

func (s *CourseService) Download(ctx context.Context, token, claimedUser, courseID, materialID string) (domain.CourseMaterial, objectstore.Request, error) {
	if s.objects == nil {
		return domain.CourseMaterial{}, objectstore.Request{}, fmt.Errorf("object storage unavailable")
	}
	var material domain.CourseMaterial
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
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

func (s *CourseService) DeleteMaterial(ctx context.Context, token, claimedUser, courseID, materialID string) error {
	if s.objects == nil {
		return fmt.Errorf("object storage unavailable")
	}
	var material domain.CourseMaterial
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		material, err = models.Materials.Get(ctx, user.ID, courseID, materialID)
		return err
	})
	if err == nil {
		err = s.objects.Delete(ctx, material.ObjectKey)
	}
	if err == nil {
		err = s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
			return models.Materials.Delete(ctx, user.ID, courseID, materialID)
		})
	}
	return err
}

func (s *CourseService) Delete(ctx context.Context, token, claimedUser, courseID string) error {
	var materials []domain.CourseMaterial
	var uploads []domain.CourseMaterialUpload
	err := s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error {
		var err error
		materials, err = models.Materials.List(ctx, user.ID, courseID)
		if err == nil {
			uploads, err = models.Materials.ListUploads(ctx, user.ID, courseID)
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
	if err == nil {
		err = s.withUser(ctx, token, claimedUser, data.StandardTransaction, func(models data.Models, user domain.User) error { return models.Courses.Delete(ctx, user.ID, courseID) })
	}
	return err
}

func (s *CourseService) CleanupExpired(ctx context.Context, now time.Time, warn Warn) error {
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

func (s *CourseService) withUser(ctx context.Context, token, claimedUser string, mode data.TransactionMode, action func(data.Models, domain.User) error) error {
	return s.models.Transaction(ctx, mode, func(models data.Models) error {
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

func validUTF8(content io.Reader) bool {
	reader := bufio.NewReader(content)
	for {
		r, size, err := reader.ReadRune()
		if err == io.EOF {
			return true
		}
		if err != nil || (r == utf8.RuneError && size == 1) {
			return false
		}
	}
}
