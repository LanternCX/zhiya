package main

import (
	"encoding/json"
	"net/http"
	"time"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

func (a *application) listCourses(w http.ResponseWriter, r *http.Request) {
	courses, err := a.courseService().List(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
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
	cover := domain.CourseCover{Motif: input.Cover.Motif, Palette: input.Cover.Palette, Label: input.Cover.Label}
	course, err := a.courseService().Create(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), input.Title, input.Topic, cover)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"course": course})
}

func (a *application) getCourse(w http.ResponseWriter, r *http.Request) {
	course, err := a.courseService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
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
	course, err := a.courseService().Update(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), input.Title, input.Topic)
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
	err := a.courseService().SaveConversation(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), input.ConversationID, input.State)
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
	outline := make([]domain.OutlineSection, len(input.Sections))
	for index, section := range input.Sections {
		outline[index] = domain.OutlineSection{ID: section.ID, Title: section.Title, Objective: section.Objective, Status: section.Status}
	}
	result, err := a.courseService().ReplaceOutline(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), outline)
	if err != nil {
		a.respondError(w, err)
		return
	}
	if result.Reorganization != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{"reorganization": result.Reorganization})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": result.Course})
}

func (a *application) getCourseOutlineReorganization(w http.ResponseWriter, r *http.Request) {
	reorganization, err := a.courseService().GetOutlineReorganization(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reorganization": reorganization})
}

func (a *application) assignCourseOutlineConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SectionID             string `json:"sectionId"`
		ConversationUpdatedAt string `json:"conversationUpdatedAt"`
		Reason                string `json:"reason"`
		NewSection            *struct {
			Title     string `json:"title"`
			Objective string `json:"objective"`
		} `json:"newSection"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, input.ConversationUpdatedAt)
	if err != nil {
		a.respondError(w, bad("课程对话分类无效"))
		return
	}
	var newSection *domain.OutlineSection
	if input.NewSection != nil {
		newSection = &domain.OutlineSection{Title: input.NewSection.Title, Objective: input.NewSection.Objective}
	}
	result, err := a.courseService().AssignOutlineConversation(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("reorganizationId"), r.PathValue("conversationId"), input.SectionID, input.Reason, updatedAt, newSection)
	if err != nil {
		a.respondError(w, err)
		return
	}
	if result.Reorganization != nil {
		writeJSON(w, http.StatusAccepted, map[string]any{"reorganization": result.Reorganization})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": result.Course})
}

func (a *application) createCourseConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title string `json:"title"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	conversation, err := a.courseService().CreateConversation(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("sectionId"), input.Title)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"conversation": conversation})
}

func (a *application) deleteCourseConversation(w http.ResponseWriter, r *http.Request) {
	course, err := a.courseService().DeleteConversation(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("sectionId"), r.PathValue("conversationId"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *application) listCourseMaterials(w http.ResponseWriter, r *http.Request) {
	materials, err := a.courseService().ListMaterials(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"materials": materials})
}

func (a *application) startCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name      string `json:"name"`
		SizeBytes int64  `json:"sizeBytes"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	upload, err := a.courseService().StartUpload(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), input.Name, input.SizeBytes, a.courseWarning(w))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"upload": map[string]any{"id": upload.Record.ID, "url": upload.Request.URL, "headers": upload.Request.Headers, "expiresAt": upload.Record.ExpiresAt}})
}

func (a *application) completeCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	material, err := a.courseService().CompleteUpload(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("uploadId"), a.courseWarning(w))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"material": material})
}

func (a *application) courseWarning(w http.ResponseWriter) appservice.Warn {
	return func(message string, err error, values ...any) { a.warnRequest(w, message, err, values...) }
}

func (a *application) downloadCourseMaterial(w http.ResponseWriter, r *http.Request) {
	material, request, err := a.courseService().Download(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("materialId"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"material": material, "url": request.URL, "headers": request.Headers})
}

func (a *application) deleteCourseMaterial(w http.ResponseWriter, r *http.Request) {
	err := a.courseService().DeleteMaterial(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"), r.PathValue("materialId"))
	a.respondOK(w, err)
}

func (a *application) deleteCourse(w http.ResponseWriter, r *http.Request) {
	err := a.courseService().Delete(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	a.respondOK(w, err)
}
