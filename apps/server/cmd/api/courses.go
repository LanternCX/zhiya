package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
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

func (a *application) uploadCourseMaterial(w http.ResponseWriter, r *http.Request) {
	if a.objects == nil {
		a.respondError(w, fmt.Errorf("object storage unavailable"))
		return
	}
	var filename string
	var content []byte
	var err error
	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "application/json") {
		var input struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if err := a.readJSON(w, r, &input); err != nil {
			a.respondError(w, err)
			return
		}
		filename, content = filepath.Base(input.Name), []byte(input.Content)
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, int64(a.config.Server.MaxBodyBytes))
		file, header, err := r.FormFile("file")
		if err != nil {
			a.respondError(w, bad("课程材料无效或过大"))
			return
		}
		defer file.Close()
		filename = filepath.Base(header.Filename)
		content, err = io.ReadAll(io.LimitReader(file, int64(a.config.Server.MaxBodyBytes)+1))
		if err != nil {
			a.respondError(w, bad("课程材料无效或过大"))
			return
		}
	}
	extension := strings.ToLower(filepath.Ext(filename))
	mediaType := map[string]string{".md": "text/markdown", ".txt": "text/plain"}[extension]
	if mediaType == "" {
		a.respondError(w, bad("目前仅支持 Markdown 和 TXT 文件"))
		return
	}
	if len(content) == 0 || len(content) > a.config.Server.MaxBodyBytes || !utf8.Valid(content) {
		a.respondError(w, bad("课程材料必须是有效的 UTF-8 文本且不能超过大小限制"))
		return
	}
	materialID := data.UUID()
	objectKey := "courses/" + r.PathValue("id") + "/materials/" + materialID + "/source" + extension
	if err := a.objects.Put(r.Context(), objectKey, content, mediaType); err != nil {
		a.respondError(w, err)
		return
	}
	var material data.CourseMaterial
	err = a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		material, err = m.Materials.Create(r.Context(), u.ID, r.PathValue("id"), filename, mediaType, objectKey, int64(len(content)))
		return err
	})
	if err != nil {
		_ = a.objects.Delete(r.Context(), objectKey)
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"material": material})
}

func (a *application) getCourseMaterial(w http.ResponseWriter, r *http.Request) {
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
	content, err := a.objects.Get(r.Context(), material.ObjectKey)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"material": material, "content": string(content)})
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
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var err error
		materials, err = m.Materials.List(r.Context(), u.ID, r.PathValue("id"))
		return err
	})
	if err == nil && a.objects != nil {
		for _, material := range materials {
			if err = a.objects.Delete(r.Context(), material.ObjectKey); err != nil {
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
