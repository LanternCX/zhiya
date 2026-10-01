package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

func (a *requestHandler) saveState(w http.ResponseWriter, r *http.Request) {
	var state json.RawMessage
	if err := a.http().ReadJSON(w, r, &state); err != nil {
		a.http().RespondError(w, err)
		return
	}
	a.http().RespondOK(w, a.executionService().Save(r.Context(), a.grant.ID, a.grant.Value, state))
}
func (a *requestHandler) heartbeat(w http.ResponseWriter, r *http.Request) {
	a.http().RespondOK(w, a.executionService().Heartbeat(r.Context(), a.grant))
}
func (a *requestHandler) getLearning(w http.ResponseWriter, r *http.Request) {
	session, err := a.session(r)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	changes, unsubscribe := a.Hub.WatchAgent("learning:" + session.UserID)
	defer unsubscribe()
	state, err := a.learningService().Load(r.Context(), session.UserID)
	if err != nil {
		a.http().RespondError(w, err)
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
			a.http().RespondError(w, err)
			return
		}
	}
	transport.WriteJSON(w, http.StatusOK, state)
}
func (a *requestHandler) applyLearningAction(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RequestID string          `json:"requestId"`
		Action    learning.Action `json:"action"`
	}
	if err := a.http().ReadJSON(w, r, &input); err != nil {
		a.http().RespondError(w, err)
		return
	}
	session, err := a.session(r)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	state, result, err := a.executionService().ApplyLearningAction(r.Context(), a.grant, session.UserID, input.Action, input.RequestID)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]any{"state": state, "data": result})
}
func (a *requestHandler) learningSocket(w http.ResponseWriter, r *http.Request) {
	session, err := a.session(r)
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	a.Hub.ServeLearningSocket(w, r, a.http(), a.learningService(), session.UserID, func(ctx context.Context, user string, input learning.Action, requestID string) (domain.Conversation, any, error) {
		return a.executionService().ApplyLearningAction(ctx, a.grant, user, input, requestID)
	})
}
