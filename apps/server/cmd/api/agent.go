package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	appservice "github.com/LanternCX/zhiya/apps/server/internal/application"
)

func (a *application) commandAgentSession(w http.ResponseWriter, r *http.Request) {
	session, err := a.agentService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	var command struct {
		RequestID string            `json:"requestId"`
		Action    string            `json:"action"`
		Args      []json.RawMessage `json:"args"`
	}
	if err = a.readJSON(w, r, &command); err != nil {
		a.respondError(w, err)
		return
	}
	if command.RequestID == "" || len(command.RequestID) > 128 {
		a.respondError(w, bad("请求编号无效"))
		return
	}
	allowed := map[string]bool{"stop": true, "attach": true}
	if session.Kind == "profile" {
		allowed["run"] = true
		allowed["endCorrection"] = true
	} else {
		for _, action := range []string{"prompt", "materials", "selectPresentation", "updateCodingExercise", "updateQuestion", "submitQuestion", "deferQuestion", "requestExerciseReview", "beginFromHandoff", "animationPlayback"} {
			allowed[action] = true
		}
	}
	if !allowed[command.Action] {
		a.respondError(w, bad("此会话不支持该操作"))
		return
	}
	session, err = a.agentService().Claim(r.Context(), session.UserID, session.ID)
	if err != nil {
		a.respondError(w, err)
		return
	}
	learning, err := a.learningService().Load(r.Context(), session.UserID)
	if err != nil {
		a.respondError(w, err)
		return
	}
	body, err := json.Marshal(map[string]any{"session": session, "grant": session.Grant, "command": command, "memory": learning.Memory, "model": map[string]any{"id": a.config.Model.ID, "available": a.config.Model.Endpoint != ""}})
	if err != nil {
		a.respondError(w, err)
		return
	}
	// Dispatch survives browser disconnection. The worker acknowledges before running the loop.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", a.config.Agent.Endpoint+"/commands", bytes.NewReader(body))
	if err != nil {
		a.respondError(w, err)
		return
	}
	request.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		a.respondError(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 1<<20))
}

func (a *application) agentService() *appservice.AgentService {
	return appservice.NewAgentService(a.models)
}

func (a *application) openAgentSession(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind           string `json:"kind"`
		CourseID       string `json:"courseId"`
		ConversationID string `json:"conversationId"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	session, err := a.agentService().Open(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), input.Kind, input.CourseID, input.ConversationID)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (a *application) getAgentSession(w http.ResponseWriter, r *http.Request) {
	session, err := a.agentService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (a *application) listConversations(w http.ResponseWriter, r *http.Request) {
	conversations, err := a.agentService().ListConversations(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"conversations": conversations})
}
