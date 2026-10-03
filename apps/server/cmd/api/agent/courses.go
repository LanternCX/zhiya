package agent

import (
	"net/http"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/courses"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

func (a *requestHandler) createCourse(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title string `json:"title"`
		Topic string `json:"topic"`
		Cover struct {
			Motif   string `json:"motif"`
			Palette string `json:"palette"`
			Label   string `json:"label"`
		} `json:"cover"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	cover := domain.CourseCover{Motif: input.Cover.Motif, Palette: input.Cover.Palette, Label: input.Cover.Label}
	course, err := a.executionService().CreateCourse(r.Context(), a.grant, input.Title, input.Topic, cover)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusCreated, map[string]any{"course": course})
}

func (a *requestHandler) getCourse(w http.ResponseWriter, r *http.Request) {
	course, err := a.courseService().Get(r.Context(), a.grant.Authorize, r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *requestHandler) updateCourse(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title *string `json:"title"`
		Topic *string `json:"topic"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	course, err := a.courseService().Update(r.Context(), a.grant.Authorize, r.PathValue("id"), input.Title, input.Topic)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"course": course})
}

func (a *requestHandler) replaceCourseOutline(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Sections []struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Objective string `json:"objective"`
			Status    string `json:"status"`
		} `json:"sections"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	outline := make([]domain.OutlineSection, len(input.Sections))
	for index, section := range input.Sections {
		outline[index] = domain.OutlineSection{ID: section.ID, Title: section.Title, Objective: section.Objective, Status: section.Status}
	}
	result, err := a.courseService().ReplaceOutline(r.Context(), a.grant.Authorize, r.PathValue("id"), outline)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	if result.Reorganization != nil {
		transport.WriteJSON(w, http.StatusAccepted, map[string]any{"reorganization": result.Reorganization})
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"course": result.Course})
}

func (a *requestHandler) getCourseOutlineReorganization(w http.ResponseWriter, r *http.Request) {
	reorganization, err := a.courseService().GetOutlineReorganization(r.Context(), a.grant.Authorize, r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"reorganization": reorganization})
}

func (a *requestHandler) assignCourseOutlineConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SectionID             string `json:"sectionId"`
		ConversationUpdatedAt string `json:"conversationUpdatedAt"`
		Reason                string `json:"reason"`
		NewSection            *struct {
			Title     string `json:"title"`
			Objective string `json:"objective"`
		} `json:"newSection"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, input.ConversationUpdatedAt)
	if err != nil {
		a.http().RespondError(w, transport.Bad("课程对话分类无效"))
		return
	}
	var newSection *domain.OutlineSection
	if input.NewSection != nil {
		newSection = &domain.OutlineSection{Title: input.NewSection.Title, Objective: input.NewSection.Objective}
	}
	result, err := a.courseService().AssignOutlineConversation(r.Context(), a.grant.Authorize, r.PathValue("id"), r.PathValue("reorganizationId"), r.PathValue("conversationId"), input.SectionID, input.Reason, updatedAt, newSection)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	if result.Reorganization != nil {
		transport.WriteJSON(w, http.StatusAccepted, map[string]any{"reorganization": result.Reorganization})
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"course": result.Course})
}

func (a *requestHandler) createCourseConversation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Title string `json:"title"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	conversation, err := a.executionService().CreateConversation(r.Context(), a.grant, r.PathValue("id"), r.PathValue("sectionId"), input.Title)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusCreated, map[string]any{"conversation": conversation})
}

func (a *requestHandler) listCourseMaterials(w http.ResponseWriter, r *http.Request) {
	materials, err := a.courseService().ListMaterials(r.Context(), a.grant.Authorize, r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"materials": materials})
}

func (a *requestHandler) startCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name      string `json:"name"`
		SizeBytes int64  `json:"sizeBytes"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	upload, err := a.courseService().StartUpload(r.Context(), a.grant.Authorize, r.PathValue("id"), input.Name, input.SizeBytes, a.courseWarning(w))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusCreated, map[string]any{"upload": map[string]any{"id": upload.Record.ID, "url": upload.Request.URL, "headers": upload.Request.Headers, "expiresAt": upload.Record.ExpiresAt}})
}

func (a *requestHandler) completeCourseMaterialUpload(w http.ResponseWriter, r *http.Request) {
	material, err := a.courseService().CompleteUpload(r.Context(), a.grant.Authorize, r.PathValue("id"), r.PathValue("uploadId"), a.courseWarning(w))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusCreated, map[string]any{"material": material})
}

func (a *requestHandler) courseWarning(w http.ResponseWriter) courses.Warn {
	return func(message string, err error, values ...any) { a.http().WarnRequest(w, message, err, values...) }
}

func (a *requestHandler) downloadCourseMaterial(w http.ResponseWriter, r *http.Request) {
	material, request, err := a.courseService().Download(r.Context(), a.grant.Authorize, r.PathValue("id"), r.PathValue("materialId"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"material": material, "url": request.URL, "headers": request.Headers})
}

func (a *requestHandler) readCourseMaterial(w http.ResponseWriter, r *http.Request) {
	a.http().ReadMaterial(w, r, a.courseService(), a.grant.Authorize)
}
