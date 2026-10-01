package client

import (
	"context"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/transport"
	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
)

func (a *application) learningSocket(w http.ResponseWriter, r *http.Request) {
	user, err := a.accountService().ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	a.learningHub.ServeLearningSocket(w, r, a.http(), a.learningService(), user, func(ctx context.Context, user string, input learning.Action, requestID string) (domain.Conversation, any, error) {
		if input.Action != "answer" && input.Action != "end_correction" {
			return domain.Conversation{}, nil, transport.Failure{Status: 403, Message: "此操作仅供 Agent 执行"}
		}
		return a.learningService().ApplyAction(ctx, user, input, requestID)
	})
}

func (a *application) socketTicket(w http.ResponseWriter, r *http.Request) {
	ticket, err := a.accountService().NewSocketTicket(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	transport.WriteJSON(w, http.StatusOK, map[string]string{"ticket": ticket})
}
