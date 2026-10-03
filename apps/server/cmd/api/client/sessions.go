package client

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
)

func (a *application) commandAgentSession(w http.ResponseWriter, r *http.Request) {
	session, err := a.executionService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	var command struct {
		RequestID string            `json:"requestId"`
		Action    string            `json:"action"`
		Args      []json.RawMessage `json:"args"`
	}
	// Inline attachments include base64 overhead; the worker has the same 32 MiB envelope limit.
	if err = a.http().ReadJSONWithLimit(w, r, &command, 32<<20); err != nil {
		a.http().RespondError(w, err)
		return
	}
	if command.Action != "materials" {
		raw, marshalErr := json.Marshal(command)
		if marshalErr != nil || len(raw) > a.config.Server.MaxBodyBytes {
			a.http().RespondError(w, transport.Bad("提交内容无效或过大"))
			return
		}
	}
	if command.RequestID == "" || len(command.RequestID) > 128 {
		a.http().RespondError(w, transport.Bad("请求编号无效"))
		return
	}
	allowed := map[string]bool{"stop": true, "attach": true}
	if session.Kind == "profile" {
		allowed["run"] = true
		allowed["endCorrection"] = true
	} else {
		for _, action := range []string{"prompt", "materials", "selectPresentation", "selectDeliverable", "updateCodingExercise", "updateQuestion", "submitQuestion", "deferQuestion", "requestExerciseReview", "beginFromHandoff", "animationPlayback"} {
			allowed[action] = true
		}
	}
	if !allowed[command.Action] {
		a.http().RespondError(w, transport.Bad("此会话不支持该操作"))
		return
	}
	session, err = a.executionService().Claim(r.Context(), session.UserID, session.ID)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	learning, err := a.learningService().Load(r.Context(), session.UserID)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	body, err := json.Marshal(map[string]any{"userId": session.UserID, "session": session, "grant": session.Grant, "command": command, "memory": learning.Memory, "model": map[string]any{"id": a.config.Model.ID, "available": a.config.Model.Endpoint != ""}})
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	// Dispatch survives browser disconnection. The worker acknowledges before running the loop.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", a.config.Agent.Endpoint+"/commands", bytes.NewReader(body))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	request.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 1<<20))
}

func (a *application) openAgentSession(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Kind           string `json:"kind"`
		CourseID       string `json:"courseId"`
		ConversationID string `json:"conversationId"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	session, err := a.executionService().Open(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), input.Kind, input.CourseID, input.ConversationID)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusCreated, session)
}

func (a *application) getAgentSession(w http.ResponseWriter, r *http.Request) {
	session, err := a.executionService().Get(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), r.PathValue("id"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, session)
}

func (a *application) listConversations(w http.ResponseWriter, r *http.Request) {
	conversations, err := a.executionService().ListConversations(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, 200, map[string]any{"conversations": conversations})
}
