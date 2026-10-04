package agent

import (
	"context"
	"net/http"

	fault "github.com/LanternCX/zhiya/apps/server/internal/application"
	"github.com/LanternCX/zhiya/apps/server/internal/application/deliverables"
	"github.com/LanternCX/zhiya/apps/server/internal/application/execution"
	"github.com/LanternCX/zhiya/apps/server/internal/application/identity"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

func (a *application) Routes() http.Handler {
	mux := http.NewServeMux()
	a.http().Deliverables(mux, "", deliverables.New(a.Models, a.Objects), func(r *http.Request) identity.Authorize {
		return func(ctx context.Context, models data.Models) (domain.User, error) {
			session, err := models.Agents.Authorize(ctx, r.Header.Get("X-Zhiya-Agent-Session"), r.Header.Get("X-Zhiya-Execution"))
			if err != nil {
				return domain.User{}, err
			}
			if session.CourseID != r.PathValue("id") {
				return domain.User{}, fault.Unauthorized("产物不在当前执行范围内")
			}
			return domain.User{ID: session.UserID}, nil
		}
	})
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
