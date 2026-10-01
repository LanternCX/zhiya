package client

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// The workspace watches compact statuses independently of the open conversation.
func (a *application) agentStatusSocket(w http.ResponseWriter, r *http.Request) {
	user, err := a.accountService().ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx := conn.CloseRead(context.Background())
	changes, unsubscribe := a.learningHub.WatchAgent("user:" + user)
	defer unsubscribe()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	previous := ""
	for {
		sessions, err := a.models.Agents.ListStatuses(ctx, user)
		if err != nil {
			return
		}
		conversations, err := a.models.Conversations.List(ctx, user)
		if err != nil {
			return
		}
		payload, err := json.Marshal(map[string]any{"sessions": sessions, "conversations": conversations})
		if err != nil {
			return
		}
		if string(payload) != previous {
			write, cancel := context.WithTimeout(ctx, 10*time.Second)
			err = conn.Write(write, websocket.MessageText, payload)
			cancel()
			if err != nil {
				return
			}
			previous = string(payload)
		}
		select {
		case <-ctx.Done():
			return
		case <-changes:
		case <-ticker.C:
		}
	}
}

func (a *application) agentSocket(w http.ResponseWriter, r *http.Request) {
	user, err := a.accountService().ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket"))
	if err != nil {
		a.http().RespondError(w, err)
		return
	}
	id := r.PathValue("id")
	if _, err = a.models.Agents.Get(r.Context(), user, id); err != nil {
		a.http().RespondError(w, err)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx := conn.CloseRead(context.Background())
	changes, unsubscribe := a.learningHub.WatchAgent(id)
	defer unsubscribe()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	revision := 0
	for {
		state, err := a.models.Agents.Get(ctx, user, id)
		if err != nil {
			return
		}
		if state.Revision > revision {
			write, cancel := context.WithTimeout(ctx, 10*time.Second)
			err = wsjson.Write(write, conn, state)
			cancel()
			if err != nil {
				return
			}
			revision = state.Revision
		}
		select {
		case <-ctx.Done():
			return
		case <-changes:
		case <-ticker.C:
		}
	}
}
