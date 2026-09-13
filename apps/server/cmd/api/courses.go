package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
)

const (
	courseTitleMax       = 80
	courseTopicMax       = 240
	courseLabelMax       = 32
	sectionTitleMax      = 100
	sectionObjectiveMax  = 500
	conversationTitleMax = 100
)

var courseMotifs = map[string]bool{
	"code": true, "orbit": true, "geometry": true, "language": true,
	"nature": true, "history": true, "abstract": true,
}

var coursePalettes = map[string]bool{
	"sprout": true, "sunrise": true, "ocean": true, "berry": true, "clay": true,
}

func courseText(value, field string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > max {
		return "", bad(field + "无效")
	}
	return value, nil
}

func (a *application) listCourses(w http.ResponseWriter, r *http.Request) {
	var courses []data.Course
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		courses, err = m.Courses.List(r.Context(), u.ID)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"courses": courses})
}

func (a *application) createCourse(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title string `json:"title"`
		Topic string `json:"topic"`
		Cover struct {
			Motif   string `json:"motif"`
			Palette string `json:"palette"`
			Label   string `json:"label"`
		} `json:"cover"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	title, err := courseText(input.Title, "课程名称", courseTitleMax)
	if err != nil {
		a.respondError(w, err)
		return
	}
	topic, err := courseText(input.Topic, "课程主题", courseTopicMax)
	if err != nil {
		a.respondError(w, err)
		return
	}
	label, err := courseText(input.Cover.Label, "封面标识", courseLabelMax)
	if err != nil || !courseMotifs[input.Cover.Motif] || !coursePalettes[input.Cover.Palette] {
		a.respondError(w, bad("课程封面无效"))
		return
	}
	cover := data.CourseCover{Motif: input.Cover.Motif, Palette: input.Cover.Palette, Label: label}
	var course data.Course
	err = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		course, err = m.Courses.Create(r.Context(), u.ID, title, topic, cover)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"course": course})
}

func (a *application) getCourse(w http.ResponseWriter, r *http.Request) {
	var course data.Course
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		course, err = m.Courses.Get(r.Context(), u.ID, r.PathValue("id"))
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *application) updateCourse(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title *string `json:"title"`
		Topic *string `json:"topic"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	var course data.Course
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		current, err := m.Courses.Get(r.Context(), u.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		title, topic := current.Title, current.Topic
		if input.Title != nil {
			title, err = courseText(*input.Title, "课程名称", courseTitleMax)
			if err != nil {
				return err
			}
		}
		if input.Topic != nil {
			topic, err = courseText(*input.Topic, "课程主题", courseTopicMax)
			if err != nil {
				return err
			}
		}
		course, err = m.Courses.Update(r.Context(), u.ID, current.ID, title, topic)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *application) saveCourseConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConversationID string          `json:"conversationId"`
		State          json.RawMessage `json:"state"`
	}
	if err := a.readJSON(w, r, &input); err != nil || input.ConversationID == "" || len(input.State) == 0 || !json.Valid(input.State) {
		if err == nil {
			err = bad("课程对话无效")
		}
		a.respondError(w, err)
		return
	}
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		return m.Courses.SaveConversation(r.Context(), u.ID, r.PathValue("id"), input.ConversationID, input.State)
	})
	a.respondOK(w, err)
}

func (a *application) replaceCourseOutline(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Sections []struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Objective string `json:"objective"`
			Status    string `json:"status"`
		} `json:"sections"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	if len(input.Sections) == 0 || len(input.Sections) > 100 {
		a.respondError(w, bad("课程大纲无效"))
		return
	}
	outline := make([]data.OutlineSection, len(input.Sections))
	seen := make(map[string]bool, len(input.Sections))
	for index, section := range input.Sections {
		if section.ID != "" && seen[section.ID] {
			a.respondError(w, bad("课程大纲包含重复的小节"))
			return
		}
		seen[section.ID] = true
		title, err := courseText(section.Title, "小节名称", sectionTitleMax)
		if err != nil {
			a.respondError(w, err)
			return
		}
		objective, err := courseText(section.Objective, "学习目标", sectionObjectiveMax)
		if err != nil {
			a.respondError(w, err)
			return
		}
		if section.Status != "" && section.Status != "planned" && section.Status != "active" && section.Status != "complete" {
			a.respondError(w, bad("小节状态无效"))
			return
		}
		outline[index] = data.OutlineSection{ID: section.ID, Title: title, Objective: objective, Status: section.Status}
	}
	var course data.Course
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		course, err = m.Courses.ReplaceOutline(r.Context(), u.ID, r.PathValue("id"), outline)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *application) createCourseConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title string `json:"title"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	title, err := courseText(input.Title, "对话名称", conversationTitleMax)
	if err != nil {
		a.respondError(w, err)
		return
	}
	var conversation data.CourseConversation
	err = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		conversation, err = m.Courses.CreateConversation(r.Context(), u.ID, r.PathValue("id"), r.PathValue("sectionId"), title)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"conversation": conversation})
}

func (a *application) deleteCourseConversation(w http.ResponseWriter, r *http.Request) {
	var course data.Course
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		course, err = m.Courses.DeleteConversation(r.Context(), u.ID, r.PathValue("id"), r.PathValue("sectionId"), r.PathValue("conversationId"))
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *application) listCourseMaterials(w http.ResponseWriter, r *http.Request) {
	var materials []data.CourseMaterial
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		materials, err = m.Materials.List(r.Context(), u.ID, r.PathValue("id"))
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"materials": materials})
}

func (a *application) startCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	if a.objects == nil {
		a.respondError(w, fmt.Errorf("object storage unavailable"))
		return
	}
	var input struct {
		Name      string `json:"name"`
		SizeBytes int64  `json:"sizeBytes"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	filename := filepath.Base(input.Name)
	extension := strings.ToLower(filepath.Ext(filename))
	mediaType := map[string]string{".md": "text/markdown", ".txt": "text/plain"}[extension]
	if mediaType == "" {
		a.respondError(w, bad("目前仅支持 Markdown 和 TXT 文件"))
		return
	}
	if filename == "." || input.SizeBytes <= 0 || input.SizeBytes > int64(a.config.Server.MaxBodyBytes) {
		a.respondError(w, bad("课程材料不能为空且不能超过大小限制"))
		return
	}
	expiresAt := time.Now().Add(time.Duration(a.config.Storage.URLTTLSeconds) * time.Second)
	objectKey := "uploads/courses/" + r.PathValue("id") + "/" + data.UUID() + "/source" + extension
	var upload data.CourseMaterialUpload
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		upload, err = m.Materials.StartUpload(r.Context(), u.ID, r.PathValue("id"), filename, mediaType, objectKey, input.SizeBytes, expiresAt)
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	request, err := a.objects.PresignUpload(r.Context(), upload.ObjectKey, upload.MediaType, upload.SizeBytes, time.Until(upload.ExpiresAt))
	if err != nil {
		_ = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
			return m.Materials.CancelUpload(r.Context(), u.ID, r.PathValue("id"), upload.ID)
		})
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"upload": map[string]any{"id": upload.ID, "url": request.URL, "headers": request.Headers, "expiresAt": upload.ExpiresAt}})
}

func (a *application) completeCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	if a.objects == nil {
		a.respondError(w, fmt.Errorf("object storage unavailable"))
		return
	}
	var upload data.CourseMaterialUpload
	var material data.CourseMaterial
	var completionFailure error
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		upload, err = m.Materials.GetUpload(r.Context(), u.ID, r.PathValue("id"), r.PathValue("uploadId"))
		if err != nil {
			return err
		}
		if time.Now().After(upload.ExpiresAt) {
			_ = a.objects.Delete(r.Context(), upload.ObjectKey)
			if err = m.Materials.CancelUpload(r.Context(), u.ID, r.PathValue("id"), upload.ID); err != nil {
				return err
			}
			completionFailure = bad("课程材料上传已过期，请重新上传")
			return nil
		}
		content, metadata, err := a.objects.Open(r.Context(), upload.ObjectKey)
		if err != nil {
			return bad("课程材料尚未上传完成")
		}
		valid := metadata.SizeBytes == upload.SizeBytes && validUTF8Stream(content)
		_ = content.Close()
		if !valid {
			_ = a.objects.Delete(r.Context(), upload.ObjectKey)
			if err = m.Materials.CancelUpload(r.Context(), u.ID, r.PathValue("id"), upload.ID); err != nil {
				return err
			}
			completionFailure = bad("课程材料必须是有效的 UTF-8 文本且大小必须与上传申请一致")
			return nil
		}
		extension := strings.ToLower(filepath.Ext(upload.Name))
		finalKey := "courses/" + upload.CourseID + "/materials/" + upload.ID + "/source" + extension
		if err = a.objects.Copy(r.Context(), upload.ObjectKey, finalKey); err != nil {
			return err
		}
		material, err = m.Materials.CompleteUpload(r.Context(), u.ID, r.PathValue("id"), upload.ID, finalKey)
		return err
	})
	if err != nil {
		if errors.Is(err, data.ErrMaterialUploadNotFound) {
			existingErr := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
				var getErr error
				material, getErr = m.Materials.Get(r.Context(), u.ID, r.PathValue("id"), r.PathValue("uploadId"))
				return getErr
			})
			if existingErr == nil {
				writeJSON(w, http.StatusCreated, map[string]any{"material": material})
				return
			}
		}
		a.respondError(w, err)
		return
	}
	if completionFailure != nil {
		a.respondError(w, completionFailure)
		return
	}
	_ = a.objects.Delete(r.Context(), upload.ObjectKey)
	writeJSON(w, http.StatusCreated, map[string]any{"material": material})
}

func validUTF8Stream(content io.Reader) bool {
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

func (a *application) downloadCourseMaterial(w http.ResponseWriter, r *http.Request) {
	if a.objects == nil {
		a.respondError(w, fmt.Errorf("object storage unavailable"))
		return
	}
	var material data.CourseMaterial
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		material, err = m.Materials.Get(r.Context(), u.ID, r.PathValue("id"), r.PathValue("materialId"))
		return err
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	request, err := a.objects.PresignDownload(r.Context(), material.ObjectKey, time.Duration(a.config.Storage.URLTTLSeconds)*time.Second)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"material": material, "url": request.URL, "headers": request.Headers})
}

func (a *application) deleteCourseMaterial(w http.ResponseWriter, r *http.Request) {
	if a.objects == nil {
		a.respondError(w, fmt.Errorf("object storage unavailable"))
		return
	}
	var material data.CourseMaterial
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		material, err = m.Materials.Get(r.Context(), u.ID, r.PathValue("id"), r.PathValue("materialId"))
		return err
	})
	if err == nil {
		err = a.objects.Delete(r.Context(), material.ObjectKey)
	}
	if err == nil {
		err = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
			return m.Materials.Delete(r.Context(), u.ID, r.PathValue("id"), r.PathValue("materialId"))
		})
	}
	a.respondOK(w, err)
}

func (a *application) deleteCourse(w http.ResponseWriter, r *http.Request) {
	var materials []data.CourseMaterial
	var uploads []data.CourseMaterialUpload
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		materials, err = m.Materials.List(r.Context(), u.ID, r.PathValue("id"))
		if err == nil {
			uploads, err = m.Materials.ListUploads(r.Context(), u.ID, r.PathValue("id"))
		}
		return err
	})
	if err == nil && a.objects != nil {
		for _, material := range materials {
			if err = a.objects.Delete(r.Context(), material.ObjectKey); err != nil {
				break
			}
		}
		for _, upload := range uploads {
			if err = a.objects.Delete(r.Context(), upload.ObjectKey); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
			return m.Courses.Delete(r.Context(), u.ID, r.PathValue("id"))
		})
	}
	a.respondOK(w, err)
}
