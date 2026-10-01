package transport

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/application/learning"
	"github.com/LanternCX/zhiya/apps/server/internal/domain"
	"github.com/LanternCX/zhiya/apps/server/internal/logging"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type socketMessage struct {
	Type      string               `json:"type"`
	RequestID string               `json:"requestId,omitempty"`
	Action    *learning.Action     `json:"action,omitempty"`
	State     *domain.Conversation `json:"state,omitempty"`
	Data      any                  `json:"data,omitempty"`
	Status    int                  `json:"status,omitempty"`
	Error     string               `json:"error,omitempty"`
}

type learningConnection struct {
	user            string
	messageSequence int
	revision        int
	active          bool
	conn            *websocket.Conn
	send            chan socketMessage
}

type Hub struct {
	agents      map[string]map[chan struct{}]struct{}
	mu          sync.RWMutex
	connections map[string]map[*learningConnection]struct{}
	executions  map[string]*learningExecution
	latest      map[string]int
}

type learningExecution struct {
	runID  string
	cancel context.CancelFunc
}

func LearningActionError(logger *slog.Logger, requestID string, err error) socketMessage {
	status, message := ErrorResponse(err)
	if status >= http.StatusInternalServerError {
		logger.Error("learning action failed", "client_request_id", requestID, "error", err)
	}
	return socketMessage{Type: "error", RequestID: requestID, Status: status, Error: message}
}

func LogLearningSocketEnd(ctx context.Context, logger *slog.Logger, operation string, err error) {
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

func NewHub() *Hub {
	return &Hub{connections: make(map[string]map[*learningConnection]struct{}), executions: make(map[string]*learningExecution), latest: make(map[string]int)}
}

func (h *Hub) add(c *learningConnection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connections[c.user] == nil {
		h.connections[c.user] = make(map[*learningConnection]struct{})
	}
	h.connections[c.user][c] = struct{}{}
}

func (h *Hub) remove(c *learningConnection) {
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

func (h *Hub) cursor(user string, revision int) (int, bool) {
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

func (h *Hub) activate(c *learningConnection, state domain.Conversation) bool {
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

func (h *Hub) users() []string {
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

func (h *Hub) RegisterExecution(user, runID string, cancel context.CancelFunc) func() {
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

func (h *Hub) reconcileExecution(user string, state domain.Conversation) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if execution := h.executions[user]; execution != nil && execution.runID != state.RunID {
		execution.cancel()
	}
}

func (h *Hub) publish(user string, state domain.Conversation, afterSequence int) {
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

func (h *Hub) delta(c *learningConnection, state domain.Conversation) *domain.Conversation {
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

func (h *Hub) Start(ctx context.Context, service *learning.Service, logger *slog.Logger) error {
	ready := make(chan error, 1)
	synchronize := func(user string) {
		after, subscribed := h.cursor(user, 0)
		if !subscribed {
			return
		}
		state, err := service.Snapshot(ctx, user, after)
		if err != nil {
			logger.ErrorContext(ctx, "learning synchronization failed", "user_id", user, "error", err)
			return
		}
		h.reconcileExecution(user, state)
		state.RunID = ""
		h.publish(user, state, after)
	}
	go service.ListenChanges(ctx, ready, func(err error) {
		if ctx.Err() == nil {
			logger.ErrorContext(ctx, "learning notification listener failed", "error", err)
		}
	}, func() {
		h.NotifyAgent("")
		logger.InfoContext(ctx, "learning notification listener reconnected")
		for _, user := range h.users() {
			synchronize(user)
		}
	}, func(change domain.ConversationChange) {
		if change.AgentSessionID != "" {
			h.NotifyAgent("user:" + change.User)
			h.NotifyAgent(change.AgentSessionID)
			return
		}
		h.NotifyAgent("learning:" + change.User)
		_, subscribed := h.cursor(change.User, change.Revision)
		if !subscribed {
			return
		}
		synchronize(change.User)
	})
	return <-ready
}

// ServeLearningSocket shares framing and delivery; each API supplies its own authorized action entry point.
func (h *Hub) ServeLearningSocket(w http.ResponseWriter, r *http.Request, response Responder, service *learning.Service, user string, apply func(context.Context, string, learning.Action, string) (domain.Conversation, any, error)) {
	requestLogger := logging.ForResponse(w, response.Logger())
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(int64(response.Config.Server.MaxBodyBytes))
	ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
	defer cancel()
	c := &learningConnection{user: user, conn: conn, send: make(chan socketMessage, 16)}
	h.add(c)
	defer h.remove(c)
	state, err := service.Load(ctx, user)
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
					LogLearningSocketEnd(ctx, requestLogger, "write", err)
					conn.CloseNow()
					return
				}
			case <-ticker.C:
				pingContext, stopPing := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pingContext)
				stopPing()
				if err != nil {
					LogLearningSocketEnd(ctx, requestLogger, "ping", err)
					conn.CloseNow()
					return
				}
			}
		}
	}()
	for !h.activate(c, state) {
		state, err = service.Snapshot(ctx, user, 0)
		if err != nil {
			requestLogger.ErrorContext(ctx, "learning socket synchronization failed", "user_id", user, "error", err)
			return
		}
		state.RunID = ""
	}
	for {
		var incoming socketMessage
		if err := wsjson.Read(ctx, conn, &incoming); err != nil {
			LogLearningSocketEnd(ctx, requestLogger, "read", err)
			return
		}
		if incoming.Type != "action" || incoming.RequestID == "" || len(incoming.RequestID) > 128 || incoming.Action == nil {
			c.send <- socketMessage{Type: "error", RequestID: incoming.RequestID, Status: http.StatusBadRequest, Error: "会话请求无效"}
			continue
		}
		state, output, err := apply(ctx, user, *incoming.Action, incoming.RequestID)
		if err != nil {
			c.send <- LearningActionError(requestLogger, incoming.RequestID, err)
			continue
		}
		c.send <- socketMessage{Type: "response", RequestID: incoming.RequestID, Data: output, State: h.delta(c, state)}
	}
}

func (h *Hub) WatchAgent(id string) (<-chan struct{}, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.agents == nil {
		h.agents = make(map[string]map[chan struct{}]struct{})
	}
	if h.agents[id] == nil {
		h.agents[id] = make(map[chan struct{}]struct{})
	}
	ch := make(chan struct{}, 1)
	h.agents[id][ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.agents[id], ch)
		if len(h.agents[id]) == 0 {
			delete(h.agents, id)
		}
	}
}
func (h *Hub) NotifyAgent(id string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for key, listeners := range h.agents {
		if id != "" && key != id {
			continue
		}
		for ch := range listeners {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	}
}
