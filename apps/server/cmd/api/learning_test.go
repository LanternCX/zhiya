package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestModelStreamsHaveNoAbsoluteDeadline(t *testing.T) {
	a := &application{config: config.Config{Server: config.Server{
		RequestTimeoutSeconds: 1,
	}}}
	handler := a.protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, limited := r.Context().Deadline(); limited {
			http.Error(w, "unexpected deadline", http.StatusGatewayTimeout)
			return
		}
		_, _ = io.WriteString(w, "complete")
	}))

	for _, path := range []string{"/api/learning/model", "/api/learning/course/model"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		handler.ServeHTTP(response, request)

		if response.Code != http.StatusOK || response.Body.String() != "complete" {
			t.Fatalf("model stream %s: %d %q", path, response.Code, response.Body.String())
		}
	}
}

func learningSocket(t *testing.T, a *testApp, c *http.Client) *websocket.Conn {
	t.Helper()
	ticket := a.request(c, "POST", "/learning/socket-ticket", map[string]any{}, 200)["ticket"].(string)
	url := "ws" + strings.TrimPrefix(a.server.URL, "http") + "/api/learning/socket?ticket=" + ticket
	conn, response, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPClient: c})
	if err != nil {
		if response != nil {
			t.Fatalf("connect learning socket: %v (%s)", err, response.Status)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

func TestLearningSocketTicketCanBeUsedOnlyOnce(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-ticket@example.com")
	ticket := a.request(c, "POST", "/learning/socket-ticket", map[string]any{}, 200)["ticket"].(string)
	url := "ws" + strings.TrimPrefix(a.server.URL, "http") + "/api/learning/socket?ticket=" + ticket
	conn, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	socketType(t, conn, "snapshot")
	second, response, err := websocket.Dial(context.Background(), url, nil)
	if second != nil {
		second.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused ticket response=%v error=%v", response, err)
	}
}

func socketJSON(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var value map[string]any
	if err := wsjson.Read(ctx, conn, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func socketType(t *testing.T, conn *websocket.Conn, kind string) map[string]any {
	t.Helper()
	for {
		message := socketJSON(t, conn)
		if message["type"] == kind {
			return message
		}
	}
}

func socketResponse(t *testing.T, conn *websocket.Conn, requestID string) map[string]any {
	t.Helper()
	for {
		message := socketJSON(t, conn)
		if message["requestId"] == requestID && (message["type"] == "response" || message["type"] == "error") {
			return message
		}
	}
}

func (a *testApp) learningRequest(c *http.Client, method, path string, body any, status int) map[string]any {
	a.t.Helper()
	conn := learningSocket(a.t, a, c)
	snapshot := socketType(a.t, conn, "snapshot")
	if method == "GET" && path == "/learning" {
		if status != http.StatusOK {
			a.t.Fatalf("GET /learning = 200; want %d", status)
		}
		return snapshot["state"].(map[string]any)
	}
	requestID := identifier.New()
	if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "action", "requestId": requestID, "action": body}); err != nil {
		a.t.Fatal(err)
	}
	response := socketResponse(a.t, conn, requestID)
	actual := http.StatusOK
	if response["type"] == "error" {
		actual = int(response["status"].(float64))
	}
	if actual != status {
		a.t.Fatalf("%s %s = %d %v; want %d", method, path, actual, response, status)
	}
	if response["type"] == "error" {
		return map[string]any{"error": response["error"]}
	}
	if value, ok := response["data"].(map[string]any); ok {
		return value
	}
	return a.learningRequest(c, "GET", "/learning", nil, http.StatusOK)
}

func TestLearningSocketSendsSnapshotAndCommittedChangesToEveryDevice(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-sync@example.com")
	first := learningSocket(t, a, c)
	second := learningSocket(t, a, c)
	for _, conn := range []*websocket.Conn{first, second} {
		message := socketJSON(t, conn)
		if message["type"] != "snapshot" || message["state"].(map[string]any)["status"] != "idle" {
			t.Fatalf("unexpected initial message: %v", message)
		}
	}
	request := map[string]any{"type": "action", "requestId": "claim-once", "action": map[string]any{"action": "claim"}}
	if err := wsjson.Write(context.Background(), first, request); err != nil {
		t.Fatal(err)
	}
	response := socketType(t, first, "response")
	if response["type"] != "response" || response["requestId"] != "claim-once" || response["data"].(map[string]any)["runId"] == "" {
		t.Fatalf("unexpected action response: %v", response)
	}
	change := socketType(t, second, "sync")
	if change["type"] != "sync" || change["state"].(map[string]any)["status"] != "running" {
		t.Fatalf("unexpected synchronized state: %v", change)
	}
}

func TestLearningSocketSendsCommittedChangesAcrossServerInstances(t *testing.T) {
	firstServer := setupAccountTest(t)
	secondServer := firstServer.anotherInstance()
	c := firstServer.register("socket-instances@example.com")
	first := learningSocket(t, firstServer, c)
	second := learningSocket(t, secondServer, c)
	socketType(t, first, "snapshot")
	socketType(t, second, "snapshot")
	if err := wsjson.Write(context.Background(), first, map[string]any{"type": "action", "requestId": "cross-instance", "action": map[string]any{"action": "claim"}}); err != nil {
		t.Fatal(err)
	}
	socketResponse(t, first, "cross-instance")
	change := socketType(t, second, "sync")
	if change["state"].(map[string]any)["status"] != "running" {
		t.Fatalf("other instance received %v", change)
	}
}

func TestLearningSocketRetriesReturnTheSavedResultOnce(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-retry@example.com")
	conn := learningSocket(t, a, c)
	initial := socketType(t, conn, "snapshot")["state"].(map[string]any)
	request := map[string]any{"type": "action", "requestId": "stable-request", "action": map[string]any{"action": "claim"}}
	if err := wsjson.Write(context.Background(), conn, request); err != nil {
		t.Fatal(err)
	}
	first := socketResponse(t, conn, "stable-request")
	if err := wsjson.Write(context.Background(), conn, request); err != nil {
		t.Fatal(err)
	}
	second := socketResponse(t, conn, "stable-request")
	if first["type"] != "response" || second["type"] != "response" || first["data"].(map[string]any)["runId"] != second["data"].(map[string]any)["runId"] {
		t.Fatalf("retry changed result: first=%v second=%v", first, second)
	}
	latest := a.request(c, "GET", "/learning", nil, 200)
	if latest["revision"] != initial["revision"].(float64)+1 {
		t.Fatalf("retry changed conversation twice: initial=%v latest=%v", initial["revision"], latest["revision"])
	}
}

func TestLearningSocketAcceptsOnlyOneConcurrentAnswer(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-answer-race@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": run, "message": toolMessage("race-question", "ask_student", map[string]any{"text": "选一个", "kind": "single", "options": []string{"A", "B"}})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "race-question"}, 200)
	first := learningSocket(t, a, c)
	second := learningSocket(t, a, c)
	socketType(t, first, "snapshot")
	socketType(t, second, "snapshot")
	answer := func(conn *websocket.Conn, requestID, selected string) {
		t.Helper()
		if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "action", "requestId": requestID, "action": map[string]any{"action": "answer", "toolCallId": "race-question", "answer": map[string]any{"selected": []string{selected}, "text": "", "skipped": false}}}); err != nil {
			t.Fatal(err)
		}
	}
	answer(first, "answer-a", "A")
	answer(second, "answer-b", "B")
	responses := []map[string]any{socketResponse(t, first, "answer-a"), socketResponse(t, second, "answer-b")}
	succeeded := 0
	conflicted := 0
	for _, response := range responses {
		if response["type"] == "response" {
			succeeded++
		} else if response["status"] == float64(http.StatusConflict) {
			conflicted++
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent answers = %v", responses)
	}
}

func TestLearningSocketRejectsAnActionInsteadOfWaitingForTheConversationLock(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-lock@example.com")
	conn := learningSocket(t, a, c)
	snapshot := socketType(t, conn, "snapshot")["state"].(map[string]any)
	tx, err := a.db.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(context.Background(), `SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, snapshot["id"]); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "action", "requestId": "locked", "action": map[string]any{"action": "claim"}}); err != nil {
		t.Fatal(err)
	}
	response := socketResponse(t, conn, "locked")
	if response["type"] != "error" || response["status"] != float64(http.StatusConflict) {
		t.Fatalf("locked action was not rejected: %v", response)
	}
}

func TestLearningSocketRejectsOversizedRequestID(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-request-id@example.com")
	conn := learningSocket(t, a, c)
	socketType(t, conn, "snapshot")
	requestID := strings.Repeat("x", 129)
	if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "action", "requestId": requestID, "action": map[string]any{"action": "claim"}}); err != nil {
		t.Fatal(err)
	}
	response := socketResponse(t, conn, requestID)
	if response["type"] != "error" || response["status"] != float64(http.StatusBadRequest) {
		t.Fatalf("oversized request ID was not rejected: %v", response)
	}
}

func TestLearningSocketSynchronizesOnlyNewlyCommittedMessages(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("socket-messages@example.com")
	writer := learningSocket(t, a, c)
	reader := learningSocket(t, a, c)
	socketType(t, writer, "snapshot")
	socketType(t, reader, "snapshot")
	if err := wsjson.Write(context.Background(), writer, map[string]any{"type": "action", "requestId": "claim", "action": map[string]any{"action": "claim"}}); err != nil {
		t.Fatal(err)
	}
	claimed := socketType(t, writer, "response")
	runID := claimed["data"].(map[string]any)["runId"].(string)
	socketType(t, reader, "sync")
	message := map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "我想学习编程"}}, "timestamp": 1}
	if err := wsjson.Write(context.Background(), writer, map[string]any{"type": "action", "requestId": "message", "action": map[string]any{"action": "message", "runId": runID, "message": message}}); err != nil {
		t.Fatal(err)
	}
	socketType(t, writer, "response")
	added := socketType(t, reader, "sync")["state"].(map[string]any)
	if len(added["messages"].([]any)) != 1 || added["messageSequence"] != float64(1) {
		t.Fatalf("message delta = %v", added)
	}
	if err := wsjson.Write(context.Background(), writer, map[string]any{"type": "action", "requestId": "heartbeat", "action": map[string]any{"action": "heartbeat", "runId": runID}}); err != nil {
		t.Fatal(err)
	}
	socketType(t, writer, "response")
	heartbeat := socketType(t, reader, "sync")["state"].(map[string]any)
	if len(heartbeat["messages"].([]any)) != 0 || heartbeat["messageSequence"] != float64(1) {
		t.Fatalf("heartbeat resent history: %v", heartbeat)
	}
}

func TestModelProxyUsesServerCredentialsAndRequiresExecution(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer server-secret" {
			t.Error("missing server credential")
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload["model"] != "configured-model" {
			t.Error("client selected model")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "configured-model")
	t.Setenv("ZHIYA_SERVER_MODEL_API_KEY", "server-secret")
	a := setupAccountTest(t)
	c := a.register("proxy@example.com")
	a.request(c, "POST", "/learning/model", map[string]any{"runId": "invalid", "payload": map[string]any{}}, 409)
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{
		"action": "message",
		"runId":  run,
		"message": map[string]any{
			"role": "user", "content": []any{map[string]string{"type": "text", "text": "请开始认识我"}}, "timestamp": time.Now().UnixMilli(),
		},
	}, http.StatusOK)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"model": "client-model", "messages": []any{}, "stream": true}})
	req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || string(raw) != "data: [DONE]\n\n" {
		t.Fatalf("proxy: %d %s", res.StatusCode, raw)
	}
	state := a.request(c, "GET", "/learning", nil, http.StatusOK)
	if state["status"] != "running" || state["inference"] != false {
		t.Fatalf("completed model stream released execution: %v", state)
	}
	a.request(c, "POST", "/learning/action", map[string]any{
		"action": "message",
		"runId":  run,
		"message": toolMessage("next-question", "ask_student", map[string]any{
			"text": "你喜欢怎样学习？", "kind": "text", "options": []string{},
		}),
	}, http.StatusOK)
}

func TestModelProxyRetriesTransientUpstreamFailures(t *testing.T) {
	attempts := 0
	idempotencyKey := ""
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			idempotencyKey = r.Header.Get("Idempotency-Key")
		} else if r.Header.Get("Idempotency-Key") != idempotencyKey {
			t.Errorf("idempotency key changed between attempts")
		}
		if attempts < 3 {
			w.Header().Set("Retry-After", "0")
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "retry-model")
	t.Setenv("ZHIYA_SERVER_MODEL_API_KEY", "server-secret")
	a := setupAccountTest(t)
	c := a.register("proxy-retry@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.HasSuffix(string(raw), "data: [DONE]\n\n") {
		t.Fatalf("proxy: %d %s", res.StatusCode, raw)
	}
	if attempts != 3 {
		t.Fatalf("upstream attempts = %d; want 3", attempts)
	}
	if idempotencyKey == "" {
		t.Fatal("missing upstream idempotency key")
	}
}

func TestModelProxySendsDeepSeekCompatibleCompletionFields(t *testing.T) {
	var upstreamPayload map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&upstreamPayload); err != nil {
			t.Errorf("decode upstream payload: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "deepseek-flash")
	t.Setenv("ZHIYA_SERVER_MODEL_API_KEY", "server-secret")
	a := setupAccountTest(t)
	c := a.register("deepseek-fields@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	body, _ := json.Marshal(map[string]any{
		"runId": run,
		"payload": map[string]any{
			"messages":   []any{map[string]any{"role": "user", "content": "hello"}},
			"max_tokens": 8192,
		},
	})
	req, _ := http.NewRequest(http.MethodPost, a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	_, _ = io.ReadAll(res.Body)

	if upstreamPayload["max_tokens"] != float64(8192) {
		t.Fatalf("max_tokens = %v; want 8192", upstreamPayload["max_tokens"])
	}
	for _, field := range []string{"max_completion_tokens", "store", "parallel_tool_calls"} {
		if value, ok := upstreamPayload[field]; ok {
			t.Fatalf("unsupported field %q forwarded with value %v", field, value)
		}
	}
}

func TestModelProxyStopsAfterFiveRetriesAndReleasesExecution(t *testing.T) {
	attempts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.Header().Set("Retry-After", "0")
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "retry-model")
	a := setupAccountTest(t)
	c := a.register("proxy-retry-exhausted@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if attempts != 6 {
		t.Fatalf("upstream attempts = %d; want initial request plus 5 retries", attempts)
	}
	if strings.Count(string(raw), ": zhiya-retry ") != 5 || !strings.Contains(string(raw), "upstream_connection_error") {
		t.Fatalf("retry stream = %s", raw)
	}
	if next := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string); next == "" || next == run {
		t.Fatalf("new execution was not released: previous=%q next=%q", run, next)
	}
}

func TestModelProxyDoesNotReplayAnInterruptedPartialStream(t *testing.T) {
	attempts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"已经收到的内容\"}}]}\n\n")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "partial-model")
	a := setupAccountTest(t)
	c := a.register("proxy-partial@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if attempts != 1 || strings.Contains(string(raw), ": zhiya-retry ") {
		t.Fatalf("partial stream was replayed: attempts=%d body=%s", attempts, raw)
	}
	if !strings.Contains(string(raw), "已经收到的内容") || !strings.Contains(string(raw), "upstream_connection_error") {
		t.Fatalf("partial stream did not end with an explicit interruption: %s", raw)
	}
}

func TestModelProxyDoesNotRetryPermanentUpstreamErrors(t *testing.T) {
	attempts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		http.Error(w, "invalid request", http.StatusBadRequest)
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "invalid-model")
	a := setupAccountTest(t)
	c := a.register("proxy-permanent-error@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	result := a.request(c, "POST", "/learning/model", map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}}, http.StatusBadGateway)
	if attempts != 1 {
		t.Fatalf("permanent error attempts = %d; want 1", attempts)
	}
	if result["error"] != "模型服务暂时不可用，请稍后重试" {
		t.Fatalf("error = %v", result)
	}
}

func TestModelProxyStopsRetryingWhenTheClientCancels(t *testing.T) {
	attempts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.Header().Set("Retry-After", "60")
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "cancelled-model")
	a := setupAccountTest(t)
	c := a.register("proxy-cancelled@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "POST", a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(res.Body)
	line, err := reader.ReadString('\n')
	if err != nil || !strings.HasPrefix(line, ": zhiya-retry ") {
		t.Fatalf("first retry notification = %q, %v", line, err)
	}
	cancel()
	_, _ = io.ReadAll(reader)
	_ = res.Body.Close()
	if attempts != 1 {
		t.Fatalf("cancelled request attempts = %d; want 1", attempts)
	}
	if next := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, http.StatusOK)["runId"].(string); next == "" || next == run {
		t.Fatalf("cancelled execution was not released: previous=%q next=%q", run, next)
	}
}

func TestCourseModelProxyAllowsTeachingAgentsToStreamConcurrently(t *testing.T) {
	started := make(chan string, 4)
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload["model"] != "course-model" {
			t.Errorf("model = %v", payload["model"])
		}
		started <- r.Header.Get("X-Zhiya-Agent")
		<-release
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "course-model")
	t.Setenv("ZHIYA_SERVER_MODEL_API_KEY", "course-secret")
	a := setupAccountTest(t)
	c := a.register("course-streams@example.com")

	request := func(agent string) <-chan int {
		result := make(chan int, 1)
		go func() {
			body, _ := json.Marshal(map[string]any{"agent": agent, "payload": map[string]any{"model": "client-model", "messages": []any{}}})
			req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/course/model", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Zhiya-Request", "1")
			for _, cookie := range c.Jar.Cookies(req.URL) {
				req.AddCookie(cookie)
			}
			res, err := c.Do(req)
			if err != nil {
				result <- 0
				return
			}
			defer res.Body.Close()
			_, _ = io.ReadAll(res.Body)
			result <- res.StatusCode
		}()
		return result
	}

	teacher := request("teacher")
	slides := request("slides")
	animation := request("animation")
	classifier := request("outline-classifier")
	roles := map[string]bool{}
	for range 4 {
		select {
		case role := <-started:
			roles[role] = true
		case <-time.After(2 * time.Second):
			close(release)
			t.Fatalf("concurrent course streams did not reach upstream: %v", roles)
		}
	}
	if !roles["teacher"] || !roles["slides"] || !roles["animation"] || !roles["outline-classifier"] {
		t.Fatalf("upstream roles = %v", roles)
	}
	close(release)
	if <-teacher != http.StatusOK || <-slides != http.StatusOK || <-animation != http.StatusOK || <-classifier != http.StatusOK {
		t.Fatal("course model streams did not complete")
	}
	a.request(c, "POST", "/learning/course/model", map[string]any{"agent": "other", "payload": map[string]any{}}, http.StatusBadRequest)
}

func toolMessage(id, name string, arguments any) map[string]any {
	return map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "toolCall", "id": id, "name": name, "arguments": arguments}}, "stopReason": "toolUse", "timestamp": 1}
}

func TestOnboardingAnswersResumeAndToolsAreIdempotent(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("tools@example.com")
	other := a.client()
	a.request(other, "POST", "/auth/login", map[string]string{"email": "tools@example.com", "password": testPassword}, 200)
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(other, "POST", "/learning/action", map[string]any{"action": "claim"}, 409)
	action := func(kind string, extra map[string]any) map[string]any {
		extra["action"] = kind
		extra["runId"] = run
		return a.request(c, "POST", "/learning/action", extra, 200)
	}
	action("message", map[string]any{"message": toolMessage("ask-1", "ask_student", map[string]any{"text": "你用过 Scratch 吗？", "kind": "single", "options": []string{"用过", "没用过"}})})
	action("tool", map[string]any{"toolCallId": "ask-1"})
	state := a.request(other, "GET", "/learning", nil, 200)
	if state["status"] != "waiting" {
		t.Fatal(state)
	}
	answer := map[string]any{"action": "answer", "toolCallId": "ask-1", "answer": map[string]any{"selected": []string{"用过"}, "text": "做过小游戏", "skipped": false}}
	a.request(other, "POST", "/learning/action", answer, 200)
	a.request(c, "POST", "/learning/action", answer, 409)
	action("tool", map[string]any{"toolCallId": "ask-1"})
	action("message", map[string]any{"message": toolMessage("save-1", "update_memory", map[string]any{"content": "学过 Scratch，做过小游戏。", "version": 0})})
	action("tool", map[string]any{"toolCallId": "save-1"})
	action("tool", map[string]any{"toolCallId": "save-1"})
	action("release", map[string]any{})
	state = a.request(other, "GET", "/learning", nil, 200)
	if state["memoryVersion"] != float64(1) || state["memory"] != "学过 Scratch，做过小游戏。" {
		t.Fatal(state)
	}
	if state["completed"] != false {
		t.Fatal("final response must not complete onboarding")
	}
	run = a.request(other, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	action("message", map[string]any{"message": toolMessage("done-1", "complete_onboarding", map[string]any{})})
	action("tool", map[string]any{"toolCallId": "done-1"})
	state = a.request(other, "GET", "/learning", nil, 200)
	if state["completed"] != true {
		t.Fatal(state)
	}
	raw, _ := json.Marshal(state["messages"])
	if len(raw) == 0 || state["question"] != nil {
		t.Fatal(state)
	}
}

func TestOnboardingIsPersistentAndPrivate(t *testing.T) {
	a := setupAccountTest(t)
	alice := a.register("alice-learning@example.com")
	first := a.request(alice, "GET", "/learning", nil, http.StatusOK)
	if first["purpose"] != "onboarding" || first["completed"] != false {
		t.Fatalf("unexpected onboarding: %v", first)
	}
	id, ok := first["id"].(string)
	if !ok || len(id) != 36 {
		t.Fatalf("expected UUID, got %v", first["id"])
	}
	second := a.request(alice, "GET", "/learning", nil, http.StatusOK)
	if second["id"] != id {
		t.Fatal("loading created a second onboarding")
	}
	bob := a.register("bob-learning@example.com")
	other := a.request(bob, "GET", "/learning", nil, http.StatusOK)
	if other["id"] == id {
		t.Fatal("students share a conversation")
	}
	a.request(a.client(), "POST", "/learning/socket-ticket", map[string]any{}, http.StatusUnauthorized)
}

func TestInterruptedQuestionRestoresWithoutExecutingItTwice(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("restore@example.com")
	old := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": old, "message": toolMessage("restore-q", "ask_student", map[string]any{"text": "你试过自己写程序吗？", "kind": "text", "options": []string{}})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": old, "toolCallId": "restore-q"}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "release", "runId": old}, 200)
	next := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "release", "runId": old}, 409)
	result := a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": next, "toolCallId": "restore-q"}, 200)
	if result["waiting"] != true {
		t.Fatal(result)
	}
	state := a.request(c, "GET", "/learning", nil, 200)
	if len(state["messages"].([]any)) != 1 {
		t.Fatalf("resuming fabricated a result: %v", state)
	}
}

func TestEndingCorrectionDiscardsQuestionAndRejectsLateWork(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("end-correction@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "end_correction"}, 409)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": run, "message": toolMessage("saved", "update_memory", map[string]any{"content": "原有档案", "version": 0})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "saved"}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": run, "message": toolMessage("done", "complete_onboarding", map[string]any{})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "done"}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": run, "message": toolMessage("pending", "ask_student", map[string]any{"text": "需要怎样调整？", "kind": "single", "options": []string{"示例", "练习"}})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "pending"}, 200)
	before := a.request(c, "GET", "/learning", nil, 200)
	state := a.request(c, "POST", "/learning/action", map[string]any{"action": "end_correction"}, 200)
	if state["question"] != nil || state["status"] != "idle" || state["correctionEnded"] != true || state["memory"] != "原有档案" {
		t.Fatal(state)
	}
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "pending"}, 409)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 409)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "claim", "correctionText": "迟到的请求", "revision": before["revision"]}, 409)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "answer", "toolCallId": "pending", "answer": map[string]any{"selected": []string{"示例"}}}, 409)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "claim", "correctionText": "新的一次修改", "revision": state["revision"]}, 200)
	next := a.request(c, "GET", "/learning", nil, 200)
	if next["correctionEnded"] != false || next["question"] != nil {
		t.Fatal(next)
	}
}

func TestEndingCorrectionCancelsUpstreamGenerationAcrossInstances(t *testing.T) {
	started, canceled := make(chan struct{}), make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
			close(canceled)
		case <-time.After(10 * time.Second):
		}
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "test-model")
	a := setupAccountTest(t)
	other := a.anotherInstance()
	c := a.register("cancel-upstream@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "message", "runId": run, "message": toolMessage("done", "complete_onboarding", map[string]any{})}, 200)
	a.request(c, "POST", "/learning/action", map[string]any{"action": "tool", "runId": run, "toolCallId": "done"}, 200)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	done := make(chan struct{})
	go func() {
		defer close(done)
		req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Zhiya-Request", "1")
		res, err := c.Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("generation did not start")
	}
	other.request(c, "POST", "/learning/action", map[string]any{"action": "end_correction"}, 200)
	select {
	case <-canceled:
	case <-time.After(3 * time.Second):
		t.Error("ended correction left upstream running")
	}
	<-done
}

func TestInterruptedModelStreamReleasesExecution(t *testing.T) {
	attempts := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
	}))
	defer upstream.Close()
	t.Setenv("ZHIYA_SERVER_MODEL_ENDPOINT", upstream.URL)
	t.Setenv("ZHIYA_SERVER_MODEL_ID", "test-model")
	a := setupAccountTest(t)
	c := a.register("interrupted-model@example.com")
	run := a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)["runId"].(string)
	body, _ := json.Marshal(map[string]any{"runId": run, "payload": map[string]any{"messages": []any{}}})
	req, _ := http.NewRequest("POST", a.server.URL+"/api/learning/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	_ = res.Body.Close()
	if attempts != 1 {
		t.Fatalf("partial stream attempts = %d; want no replay", attempts)
	}
	state := a.request(c, "GET", "/learning", nil, 200)
	if state["status"] != "idle" || state["inference"] != false {
		t.Fatalf("interrupted stream retained execution: %v", state)
	}
	a.request(c, "POST", "/learning/action", map[string]any{"action": "claim"}, 200)
}
