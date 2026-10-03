package agent

import (
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/internal/application/execution"
)

func (a *application) Routes() http.Handler {
	mux := http.NewServeMux()
	handle := func(pattern string, fn func(*requestHandler, http.ResponseWriter, *http.Request)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			handler := &requestHandler{application: a, grant: execution.Grant{ID: r.Header.Get("X-Zhiya-Agent-Session"), Value: r.Header.Get("X-Zhiya-Execution")}}
			fn(handler, w, r)
		})
	}
	handle("POST /sessions/{id}/state", (*requestHandler).saveState)
	handle("POST /sessions/{id}/heartbeat", (*requestHandler).heartbeat)
	handle("GET /learning", (*requestHandler).getLearning)
	handle("POST /learning/action", (*requestHandler).applyLearningAction)
	handle("GET /learning/socket", (*requestHandler).learningSocket)
	handle("POST /learning/model", (*requestHandler).modelProxy)
	handle("POST /course/model", (*requestHandler).courseModelProxy)
	handle("POST /courses", (*requestHandler).createCourse)
	handle("GET /code/languages", (*requestHandler).codeLanguages)
	handle("POST /courses/{id}/material-uploads", (*requestHandler).startCourseMaterialUpload)
	handle("POST /courses/{id}/material-uploads/{uploadId}/complete", (*requestHandler).completeCourseMaterialUpload)
	handle("GET /courses/{id}", (*requestHandler).getCourse)
	handle("PATCH /courses/{id}", (*requestHandler).updateCourse)
	handle("PUT /courses/{id}/outline", (*requestHandler).replaceCourseOutline)
	handle("GET /courses/{id}/outline-reorganization", (*requestHandler).getCourseOutlineReorganization)
	handle("PUT /courses/{id}/outline-reorganizations/{reorganizationId}/assignments/{conversationId}", (*requestHandler).assignCourseOutlineConversation)
	handle("POST /courses/{id}/sections/{sectionId}/conversations", (*requestHandler).createCourseConversation)
	handle("GET /courses/{id}/materials", (*requestHandler).listCourseMaterials)
	handle("GET /courses/{id}/materials/{materialId}/content", (*requestHandler).readCourseMaterial)
	handle("GET /courses/{id}/materials/{materialId}/download", (*requestHandler).downloadCourseMaterial)
	handle("POST /courses/{id}/image-generations", (*requestHandler).createIllustration)
	handle("GET /courses/{id}/image-generations/{generationId}", (*requestHandler).getIllustration)
	handle("DELETE /courses/{id}/image-generations/{generationId}", (*requestHandler).cancelIllustration)
	return a.protect(mux)
}
