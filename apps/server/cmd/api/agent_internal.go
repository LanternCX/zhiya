package main

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
)

// This handler is bound to a separate listener and is never mounted on /api.
func (a *application) agentInternalRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sessions/{id}/state", func(w http.ResponseWriter, r *http.Request) {
		var state json.RawMessage
		if err := a.readJSON(w, r, &state); err != nil {
			a.respondError(w, err)
			return
		}
		a.respondOK(w, a.agentService().Save(r.Context(), r.PathValue("id"), r.Header.Get("X-Zhiya-Execution"), state))
	})
	mux.HandleFunc("POST /sessions/{id}/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		a.respondOK(w, a.models.Agents.Heartbeat(r.Context(), r.PathValue("id"), r.Header.Get("X-Zhiya-Execution")))
	})
	mux.HandleFunc("GET /learning", func(w http.ResponseWriter, r *http.Request) {
		session, err := a.agentService().Authorize(r.Context(), r.Header.Get("X-Zhiya-Agent-Session"), r.Header.Get("X-Zhiya-Execution"))
		if err != nil {
			a.respondError(w, err)
			return
		}
		changes, unsubscribe := a.learningHub.watchAgent("learning:" + session.UserID)
		defer unsubscribe()
		state, err := a.learningService().Load(r.Context(), session.UserID)
		if err != nil {
			a.respondError(w, err)
			return
		}
		if after, parseErr := strconv.Atoi(r.URL.Query().Get("after")); parseErr == nil && state.Revision <= after {
			select {
			case <-r.Context().Done():
				return
			case <-changes:
			case <-time.After(20 * time.Second):
			}
			state, err = a.learningService().Load(r.Context(), session.UserID)
			if err != nil {
				a.respondError(w, err)
				return
			}
		}
		writeJSON(w, 200, state)
	})
	mux.HandleFunc("POST /learning/action", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			RequestID string         `json:"requestId"`
			Action    learningAction `json:"action"`
		}
		if err := a.readJSON(w, r, &input); err != nil {
			a.respondError(w, err)
			return
		}
		session, err := a.agentService().Authorize(r.Context(), r.Header.Get("X-Zhiya-Agent-Session"), r.Header.Get("X-Zhiya-Execution"))
		if err != nil {
			a.respondError(w, err)
			return
		}
		state, result, err := a.applyLearningActionForUser(r.Context(), session.UserID, input.Action, input.RequestID)
		if err != nil {
			a.respondError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"state": state, "data": result})
	})
	mux.HandleFunc("GET /learning/socket", a.learningSocket)
	mux.HandleFunc("POST /learning/model", a.modelProxy)
	mux.HandleFunc("POST /course/model", a.courseModelProxy)
	mux.HandleFunc("POST /courses", a.createCourse)
	mux.HandleFunc("GET /code/languages", a.codeLanguages)
	mux.HandleFunc("POST /courses/{id}/material-uploads", a.startCourseMaterialUpload)
	mux.HandleFunc("POST /courses/{id}/material-uploads/{uploadId}/complete", a.completeCourseMaterialUpload)
	mux.HandleFunc("GET /courses/{id}", a.getCourse)
	mux.HandleFunc("PATCH /courses/{id}", a.updateCourse)
	mux.HandleFunc("PUT /courses/{id}/outline", a.replaceCourseOutline)
	mux.HandleFunc("GET /courses/{id}/outline-reorganization", a.getCourseOutlineReorganization)
	mux.HandleFunc("PUT /courses/{id}/outline-reorganizations/{reorganizationId}/assignments/{conversationId}", a.assignCourseOutlineConversation)
	mux.HandleFunc("POST /courses/{id}/sections/{sectionId}/conversations", a.createCourseConversation)
	mux.HandleFunc("GET /courses/{id}/materials", a.listCourseMaterials)
	mux.HandleFunc("GET /courses/{id}/materials/{materialId}/download", a.downloadCourseMaterial)
	mux.HandleFunc("POST /courses/{id}/image-generations", a.createIllustration)
	mux.HandleFunc("GET /courses/{id}/image-generations/{generationId}", a.getIllustration)
	mux.HandleFunc("DELETE /courses/{id}/image-generations/{generationId}", a.cancelIllustration)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.config.Agent.Secret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+a.config.Agent.Secret)) != 1 {
			a.respondError(w, appservice.Unauthorized("内部服务认证失败"))
			return
		}
		id := r.Header.Get("X-Zhiya-Agent-Session")
		grant := r.Header.Get("X-Zhiya-Execution")
		session, err := a.agentService().Authorize(r.Context(), id, grant)
		if err != nil {
			a.respondError(w, err)
			return
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) > 1 && parts[0] == "sessions" && parts[1] != id {
			a.respondError(w, appservice.Unauthorized("执行范围无效"))
			return
		}
		if len(parts) > 1 && parts[0] == "courses" && (session.Kind != "course" || parts[1] != session.CourseID) {
			a.respondError(w, appservice.Unauthorized("课程不在执行范围内"))
			return
		}
		if r.URL.Path == "/courses" && (session.Kind != "course" || session.CourseID != "") {
			a.respondError(w, appservice.Unauthorized("执行不能创建课程"))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/learning") && session.Kind != "profile" {
			a.respondError(w, appservice.Unauthorized("建档不在执行范围内"))
			return
		}
		if (r.URL.Path == "/course/model" || r.URL.Path == "/code/languages") && session.Kind != "course" {
			a.respondError(w, appservice.Unauthorized("课堂不在执行范围内"))
			return
		}
		mux.ServeHTTP(w, r.WithContext(appservice.WithAgentExecution(r.Context(), id, grant)))
	})
}
