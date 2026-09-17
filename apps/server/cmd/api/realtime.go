package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type socketMessage struct {
	Type      string             `json:"type"`
	RequestID string             `json:"requestId,omitempty"`
	Action    *learningAction    `json:"action,omitempty"`
	State     *data.Conversation `json:"state,omitempty"`
	Data      any                `json:"data,omitempty"`
	Status    int                `json:"status,omitempty"`
	Error     string             `json:"error,omitempty"`
}

type learningConnection struct {
	user            string
	messageSequence int
	revision        int
	active          bool
	conn            *websocket.Conn
	send            chan socketMessage
}

type learningHub struct {
	mu          sync.RWMutex
	connections map[string]map[*learningConnection]struct{}
	executions  map[string]*learningExecution
	latest      map[string]int
}

type learningExecution struct {
	runID  string
	cancel context.CancelFunc
}

func learningActionError(logger *slog.Logger, requestID string, err error) socketMessage {
	status, message := errorResponse(err)
	if status >= http.StatusInternalServerError {
		logger.Error("learning action failed", "client_request_id", requestID, "error", err)
	}
	return socketMessage{Type: "error", RequestID: requestID, Status: status, Error: message}
}

func logLearningSocketEnd(ctx context.Context, logger *slog.Logger, operation string, err error) {
	if err == nil {
		return
	}
	status := websocket.CloseStatus(err)
	if ctx.Err() != nil || status == websocket.StatusNormalClosure || status == websocket.StatusGoingAway {
		logger.DebugContext(ctx, "learning socket closed", "operation", operation, "close_status", status)
		return
	}
	if status != -1 {
		logger.WarnContext(ctx, "learning socket interrupted", "operation", operation, "close_status", status)
		return
	}
	logger.WarnContext(ctx, "learning socket interrupted", "operation", operation, "error", err)
}

func newLearningHub() *learningHub {
	return &learningHub{connections: make(map[string]map[*learningConnection]struct{}), executions: make(map[string]*learningExecution), latest: make(map[string]int)}
}

func (h *learningHub) add(c *learningConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connections[c.user] == nil {
		h.connections[c.user] = make(map[*learningConnection]struct{})
	}
	h.connections[c.user][c] = struct{}{}
}

func (h *learningHub) remove(c *learningConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.connections[c.user], c)
	if len(h.connections[c.user]) == 0 {
		delete(h.connections, c.user)
		if h.executions[c.user] == nil {
			delete(h.latest, c.user)
		}
	}
}

func (h *learningHub) cursor(user string, revision int) (int, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	connections := h.connections[user]
	_, running := h.executions[user]
	if len(connections) == 0 && !running {
		return 0, false
	}
	if revision > h.latest[user] {
		h.latest[user] = revision
	}
	if len(connections) == 0 {
		return 0, true
	}
	minimum := -1
	for c := range connections {
		if !c.active {
			continue
		}
		if minimum == -1 || c.messageSequence < minimum {
			minimum = c.messageSequence
		}
	}
	if minimum == -1 {
		minimum = 0
	}
	return minimum, true
}

func (h *learningHub) activate(c *learningConnection, state data.Conversation) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.latest[c.user] > state.Revision {
		return false
	}
	c.messageSequence = state.MessageSequence
	c.revision = state.Revision
	c.active = true
	c.send <- socketMessage{Type: "snapshot", State: &state}
	return true
}

func (h *learningHub) users() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := make([]string, 0, len(h.connections)+len(h.executions))
	seen := make(map[string]bool)
	for user := range h.connections {
		seen[user] = true
		users = append(users, user)
	}
	for user := range h.executions {
		if !seen[user] {
			users = append(users, user)
		}
	}
	return users
}

func (h *learningHub) registerExecution(user, runID string, cancel context.CancelFunc) func() {
	h.mu.Lock()
	execution := &learningExecution{runID: runID, cancel: cancel}
	if previous := h.executions[user]; previous != nil {
		previous.cancel()
	}
	h.executions[user] = execution
	h.mu.Unlock()
	return func() {
		h.mu.Lock()
		if h.executions[user] == execution {
			delete(h.executions, user)
			if len(h.connections[user]) == 0 {
				delete(h.latest, user)
			}
		}
		h.mu.Unlock()
	}
}

func (h *learningHub) reconcileExecution(user string, state data.Conversation) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if execution := h.executions[user]; execution != nil && execution.runID != state.RunID {
		execution.cancel()
	}
}

func (h *learningHub) publish(user string, state data.Conversation, afterSequence int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.connections[user] {
		if !c.active {
			continue
		}
		if state.Revision <= c.revision {
			continue
		}
		offset := c.messageSequence - afterSequence
		if offset < 0 || offset > len(state.Messages) {
			c.conn.CloseNow()
			continue
		}
		delta := state
		delta.Messages = append([]json.RawMessage{}, state.Messages[offset:]...)
		c.messageSequence = state.MessageSequence
		c.revision = state.Revision
		select {
		case c.send <- socketMessage{Type: "sync", State: &delta}:
		default:
			c.conn.CloseNow()
		}
	}
}

func (h *learningHub) delta(c *learningConnection, state data.Conversation) *data.Conversation {
	h.mu.Lock()
	defer h.mu.Unlock()
	if state.Revision <= c.revision {
		return nil
	}
	if c.messageSequence > len(state.Messages) {
		c.conn.CloseNow()
		return nil
	}
	delta := state
	delta.Messages = append([]json.RawMessage{}, state.Messages[c.messageSequence:]...)
	c.messageSequence = state.MessageSequence
	c.revision = state.Revision
	return &delta
}

func (a *application) startLearningEvents(ctx context.Context) error {
	ready := make(chan error, 1)
	synchronize := func(user string) {
		after, subscribed := a.learningHub.cursor(user, 0)
		if !subscribed {
			return
		}
		state, err := a.models.Learning.Snapshot(ctx, user, after)
		if err != nil {
			a.applicationLogger().ErrorContext(ctx, "learning synchronization failed", "user_id", user, "error", err)
			return
		}
		a.learningHub.reconcileExecution(user, state)
		state.RunID = ""
		a.learningHub.publish(user, state, after)
	}
	go a.models.ListenConversationChanges(ctx, ready, func(err error) {
		if ctx.Err() == nil {
			a.applicationLogger().ErrorContext(ctx, "learning notification listener failed", "error", err)
		}
	}, func() {
		a.applicationLogger().InfoContext(ctx, "learning notification listener reconnected")
		for _, user := range a.learningHub.users() {
			synchronize(user)
		}
	}, func(change data.ConversationChange) {
		_, subscribed := a.learningHub.cursor(change.User, change.Revision)
		if !subscribed {
			return
		}
		synchronize(change.User)
	})
	return <-ready
}

func (a *application) learningSocket(w http.ResponseWriter, r *http.Request) {
	requestLogger := logging.ForResponse(w, a.applicationLogger())
	var user string
	err := a.models.Transaction(r.Context(), data.StandardTransaction, func(m data.Models) error {
		var consumeErr error
		user, consumeErr = m.Tokens.ConsumeSocketTicket(r.Context(), r.URL.Query().Get("ticket"))
		return consumeErr
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(int64(a.config.Server.MaxBodyBytes))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := &learningConnection{user: user, conn: conn, send: make(chan socketMessage, 16)}
	a.learningHub.add(c)
	defer a.learningHub.remove(c)
	var state data.Conversation
	err = a.models.Transaction(ctx, data.StandardTransaction, func(m data.Models) error {
		var loadErr error
		state, loadErr = m.Learning.Load(ctx, user)
		return loadErr
	})
	if err != nil {
		requestLogger.ErrorContext(r.Context(), "learning socket initialization failed", "user_id", user, "error", err)
		_ = conn.Close(websocket.StatusPolicyViolation, "authentication failed")
		return
	}
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case message := <-c.send:
				if err := wsjson.Write(ctx, conn, message); err != nil {
					logLearningSocketEnd(ctx, requestLogger, "write", err)
					conn.CloseNow()
					return
				}
			case <-ticker.C:
				pingContext, stopPing := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pingContext)
				stopPing()
				if err != nil {
					logLearningSocketEnd(ctx, requestLogger, "ping", err)
					conn.CloseNow()
					return
				}
			}
		}
	}()
	for !a.learningHub.activate(c, state) {
		state, err = a.models.Learning.Snapshot(ctx, user, 0)
		if err != nil {
			requestLogger.ErrorContext(ctx, "learning socket synchronization failed", "user_id", user, "error", err)
			return
		}
		state.RunID = ""
	}
	for {
		var incoming socketMessage
		if err := wsjson.Read(ctx, conn, &incoming); err != nil {
			logLearningSocketEnd(ctx, requestLogger, "read", err)
			return
		}
		if incoming.Type != "action" || incoming.RequestID == "" || len(incoming.RequestID) > 128 || incoming.Action == nil {
			c.send <- socketMessage{Type: "error", RequestID: incoming.RequestID, Status: http.StatusBadRequest, Error: "会话请求无效"}
			continue
		}
		state, output, err := a.applyLearningActionForUser(ctx, user, *incoming.Action, incoming.RequestID)
		if err != nil {
			c.send <- learningActionError(requestLogger, incoming.RequestID, err)
			continue
		}
		c.send <- socketMessage{Type: "response", RequestID: incoming.RequestID, Data: output, State: a.learningHub.delta(c, state)}
	}
}

func (a *application) learningSocketTicket(w http.ResponseWriter, r *http.Request) {
	var ticket string
	err := a.withUser(r, data.StandardTransaction, func(m data.Models, u data.User) error {
		var issueErr error
		ticket, issueErr = m.Tokens.NewSocketTicket(r.Context(), sessionToken(r), u.ID)
		return issueErr
	})
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ticket": ticket})
}
