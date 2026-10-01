package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestAgentSessionSurvivesClientDepartureAndRejectsOtherUsers(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("cloud-agent@example.com")
	other := a.register("other-agent@example.com")
	course, conversation := a.createCourseConversation(client)
	created := a.request(client, "POST", "/agent/sessions", map[string]any{
		"kind": "course", "courseId": course, "conversationId": conversation,
	}, http.StatusCreated)
	id := created["id"].(string)
	a.request(other, "GET", "/agent/sessions/"+id, nil, http.StatusNotFound)
	// A new HTTP connection can recover the same server-owned session.
	restored := a.request(client, "GET", "/agent/sessions/"+id, nil, http.StatusOK)
	if restored["id"] != id {
		t.Fatalf("lost session: %v", restored)
	}
	// A client's credentials never authorize the worker-only API.
	response, err := client.Get(a.server.URL + "/api/agent/internal/sessions/" + id)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("internal route exposed: %d", response.StatusCode)
	}
}

func TestConversationHistoryOnlyReordersWhenContentChanges(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("conversation-order@example.com")
	user := a.request(client, "GET", "/me", nil, 200)["id"].(string)
	older := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course"}, 201)
	newer := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course"}, 201)
	olderState := older["state"].(map[string]any)
	newerState := newer["state"].(map[string]any)
	olderID := olderState["conversationId"].(string)
	newerID := newerState["conversationId"].(string)
	lesson := map[string]any{
		"messages":              []any{map[string]any{"id": 1, "role": "user", "text": "认识 AI"}},
		"pages":                 []any{map[string]any{"id": "page-1", "kind": "slide"}, map[string]any{"id": "page-2", "kind": "slide"}},
		"presentations":         []any{map[string]any{"id": "first", "pageId": "page-1"}, map[string]any{"id": "second", "pageId": "page-2"}},
		"currentPresentationId": "second",
	}
	olderState["lesson"] = lesson
	newerState["lesson"] = map[string]any{"messages": []any{map[string]any{"id": 1, "role": "user", "text": "学习编程"}}, "pages": []any{}, "presentations": []any{}, "currentPresentationId": ""}
	save := func(session map[string]any, state map[string]any) {
		t.Helper()
		id := session["id"].(string)
		claimed, err := a.app.executionService().Claim(context.Background(), user, id)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(state)
		req, _ := http.NewRequest("POST", a.internal.URL+"/sessions/"+id+"/state", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
		req.Header.Set("X-Zhiya-Agent-Session", id)
		req.Header.Set("X-Zhiya-Execution", claimed.Grant)
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("save projection: %s", response.Status)
		}
	}
	history := func(first, second string) []any {
		t.Helper()
		items := a.request(client, "GET", "/conversations", nil, 200)["conversations"].([]any)
		if len(items) != 2 || items[0].(map[string]any)["id"] != first || items[1].(map[string]any)["id"] != second {
			t.Fatalf("unexpected conversation order: %v", items)
		}
		return items
	}
	save(older, olderState)
	save(newer, newerState)
	updatedAt := history(newerID, olderID)[1].(map[string]any)["updatedAt"]
	a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "conversationId": olderID}, 201)
	save(older, olderState)
	if history(newerID, olderID)[1].(map[string]any)["updatedAt"] != updatedAt {
		t.Fatal("opening or saving unchanged content updated conversation time")
	}
	lesson["currentPresentationId"] = "first"
	save(older, olderState)
	if history(newerID, olderID)[1].(map[string]any)["updatedAt"] != updatedAt {
		t.Fatal("browsing saved pages updated conversation time")
	}
	restored := a.request(client, "GET", "/agent/sessions/"+older["id"].(string), nil, 200)["state"].(map[string]any)["lesson"].(map[string]any)
	if restored["currentPresentationId"] != "first" {
		t.Fatal("browsing position was not saved")
	}
	lesson["messages"] = append(lesson["messages"].([]any), map[string]any{"id": 2, "role": "user", "text": "继续学习"})
	save(older, olderState)
	if history(olderID, newerID)[0].(map[string]any)["updatedAt"] == updatedAt {
		t.Fatal("new conversation content did not update conversation time")
	}
}

func TestAgentStatusSocketStreamsOnlyOwnedTasks(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("task-feed@example.com")
	other := a.register("task-feed-other@example.com")
	course, conversation := a.createCourseConversation(client)
	opened := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, 201)
	id := opened["id"].(string)
	user := a.request(client, "GET", "/me", nil, 200)["id"].(string)
	claimed, err := a.app.executionService().Claim(context.Background(), user, id)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connect := func(client *http.Client) *websocket.Conn {
		t.Helper()
		ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, 200)["ticket"].(string)
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(a.server.URL, "http")+"/api/agent/socket?ticket="+ticket, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.CloseNow() })
		return conn
	}
	read := func(conn *websocket.Conn) []struct {
		ID      string `json:"id"`
		Running bool   `json:"running"`
	} {
		t.Helper()
		var feed struct {
			Sessions []struct {
				ID      string `json:"id"`
				Running bool   `json:"running"`
			} `json:"sessions"`
		}
		if err := wsjson.Read(ctx, conn, &feed); err != nil {
			t.Fatal(err)
		}
		return feed.Sessions
	}
	conn := connect(client)
	assertState := func(running bool) {
		t.Helper()
		statuses := read(conn)
		if len(statuses) != 1 || statuses[0].ID != id || statuses[0].Running != running {
			t.Fatalf("unexpected task feed: %+v", statuses)
		}
	}
	assertState(false)
	if statuses := read(connect(other)); len(statuses) != 0 {
		t.Fatalf("leaked another user's tasks: %+v", statuses)
	}
	state := opened["state"].(map[string]any)
	for _, running := range []bool{true, false} {
		state["busy"] = running
		raw, _ := json.Marshal(state)
		if err := a.app.executionService().Save(ctx, id, claimed.Grant, raw); err != nil {
			t.Fatal(err)
		}
		assertState(running)
		if running {
			_ = conn.CloseNow()
			conn = connect(client)
			assertState(true)
		}
	}
}

func TestAgentAPIBoundaries(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("agent-boundary@example.com")
	headers := a.workerHeaders(client, "course")
	for _, test := range []struct{ origin, method, path string }{
		{a.server.URL, "POST", "/api/sessions/" + headers.Get("X-Zhiya-Agent-Session") + "/heartbeat"},
		{a.server.URL, "POST", "/api/sessions/" + headers.Get("X-Zhiya-Agent-Session") + "/state"},
		{a.server.URL, "POST", "/api/learning/action"},
		{a.internal.URL, "POST", "/api/auth/login"},
		{a.internal.URL, "GET", "/api/me"},
		{a.internal.URL, "POST", "/api/socket-ticket"},
		{a.internal.URL, "POST", "/api/agent/sessions"},
	} {
		req, _ := http.NewRequest(test.method, test.origin+test.path, strings.NewReader(`{}`))
		req.Header = headers.Clone()
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Zhiya-Request", "1")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("unexpected API exposure: %s %s = %d", test.method, test.path, res.StatusCode)
		}
	}
	course, _ := a.createCourseConversation(client)
	// Agent headers never override the authenticated browser user's ownership.
	other := a.register("agent-boundary-other@example.com")
	publicRequest, _ := http.NewRequest("GET", a.server.URL+"/api/courses/"+course, nil)
	publicRequest.Header = headers.Clone()
	publicResponse, err := other.Do(publicRequest)
	if err != nil {
		t.Fatal(err)
	}
	publicResponse.Body.Close()
	if publicResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("Agent headers overrode browser ownership: %d", publicResponse.StatusCode)
	}
	// User credentials alone cannot enter the private tool API.
	req, _ := http.NewRequest("GET", a.internal.URL+"/courses/"+course, nil)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("private API accepted a user: %d", res.StatusCode)
	}
	// Even an authenticated worker cannot read arbitrary courses outside its grant.
	req, _ = http.NewRequest("GET", a.internal.URL+"/courses/"+course, nil)
	req.Header = headers
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unbound worker accessed a course: %d", res.StatusCode)
	}
	for _, path := range []string{"/api/learning/model", "/api/learning/course/model"} {
		req, _ = http.NewRequest("POST", a.server.URL+path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Zhiya-Request", "1")
		res, err = client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 405 && res.StatusCode != 404 {
			t.Fatalf("public model API exposed: %s %d", path, res.StatusCode)
		}
	}
	ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, 200)["ticket"].(string)
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(a.server.URL, "http")+"/api/learning/socket?ticket="+ticket, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	socketType(t, conn, "snapshot")
	_ = wsjson.Write(context.Background(), conn, map[string]any{"type": "action", "requestId": "forbidden-claim", "action": map[string]any{"action": "claim"}})
	result := socketResponse(t, conn, "forbidden-claim")
	if result["status"] != float64(403) {
		t.Fatalf("client claimed an execution: %v", result)
	}
}

func TestAgentProjectionKeepsCurrentCourseMetadata(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("agent-course-metadata@example.com")
	course, conversation := a.createCourseConversation(client)
	opened := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, 201)
	id := opened["id"].(string)
	user := a.request(client, "GET", "/me", nil, 200)["id"].(string)
	claimed, err := a.app.executionService().Claim(context.Background(), user, id)
	if err != nil {
		t.Fatal(err)
	}
	a.request(client, "PATCH", "/courses/"+course, map[string]any{"title": "重命名后的课程"}, 200)
	raw, _ := json.Marshal(opened["state"])
	req, _ := http.NewRequest("POST", a.internal.URL+"/sessions/"+id+"/state", strings.NewReader(string(raw)))
	req.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
	req.Header.Set("X-Zhiya-Agent-Session", id)
	req.Header.Set("X-Zhiya-Execution", claimed.Grant)
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("save projection: %s", response.Status)
	}
	state := a.request(client, "GET", "/agent/sessions/"+id, nil, 200)["state"].(map[string]any)
	projected := state["course"].(map[string]any)
	if projected["title"] != "重命名后的课程" {
		t.Fatalf("stale course metadata: %v", projected)
	}
}

func TestAgentLoopCompletesAfterSocketCloseAndLogout(t *testing.T) {
	a := setupAccountTest(t)
	release := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(release) }) }
	started := make(chan struct{}, 1)
	continued := make(chan struct{})
	var continueOnce sync.Once
	continueStream := func() { continueOnce.Do(func() { close(continued) }) }
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, `data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"第一段"},"finish_reason":null}]}`+"\n\n")
		w.(http.Flusher).Flush()
		started <- struct{}{}
		select {
		case <-continued:
		case <-r.Context().Done():
			return
		}
		_, _ = io.WriteString(w, `data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"，实时同步"},"finish_reason":null}]}`+"\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		_, _ = fmt.Fprint(w, `data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"退出后依然完成"},"finish_reason":null}]}`+"\n\n"+`data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`+"\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	t.Cleanup(finish)
	t.Cleanup(continueStream)
	a.app.config.Model.Endpoint = upstream.URL
	a.app.config.Model.ID = "test"
	startAgentWorker(t, a)
	client := a.register("background-loop@example.com")
	course, conversation := a.createCourseConversation(client)
	session := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, 201)
	id := session["id"].(string)
	ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, 200)["ticket"].(string)
	socket, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(a.server.URL, "http")+"/api/agent/sessions/"+id+"/socket?ticket="+ticket, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var snapshot map[string]any
	if err = wsjson.Read(ctx, socket, &snapshot); err != nil {
		t.Fatal(err)
	}
	a.request(client, "POST", "/agent/sessions/"+id+"/commands", map[string]any{"requestId": "background-request", "action": "prompt", "args": []any{"继续解释"}}, 202)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("model did not start")
	}
	_ = socket.CloseNow()
	a.request(client, "POST", "/auth/logout", map[string]any{}, 200)
	a.request(client, "POST", "/auth/login", map[string]string{"email": "background-loop@example.com", "password": testPassword}, 200)
	ticket = a.request(client, "POST", "/socket-ticket", map[string]any{}, 200)["ticket"].(string)
	socket, _, err = websocket.Dial(ctx, "ws"+strings.TrimPrefix(a.server.URL, "http")+"/api/agent/sessions/"+id+"/socket?ticket="+ticket, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer socket.CloseNow()
	readUntil := func(text string) {
		t.Helper()
		for {
			if err := wsjson.Read(ctx, socket, &snapshot); err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(snapshot["state"])
			if strings.Contains(string(raw), text) {
				if snapshot["state"].(map[string]any)["busy"] != true {
					t.Fatalf("lost running state: %s", raw)
				}
				return
			}
		}
	}
	readUntil("第一段")
	continueStream()
	readUntil("实时同步")
	finish()
	for {
		snapshot = a.request(client, "GET", "/agent/sessions/"+id, nil, 200)
		raw, _ := json.Marshal(snapshot["state"])
		if strings.Contains(string(raw), "退出后依然完成") && strings.Contains(string(raw), `"status":"complete"`) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("execution did not finish: %s", raw)
		case <-time.After(25 * time.Millisecond):
		}
	}
	saved := a.request(client, "GET", "/courses/"+course, nil, 200)
	raw, _ := json.Marshal(saved)
	if !strings.Contains(string(raw), "退出后依然完成") {
		t.Fatalf("result not persisted to course: %s", raw)
	}
}

func TestUnassignedConversationSurvivesWithoutCourseTool(t *testing.T) {
	a := setupAccountTest(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, `data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"先聊聊你的问题"},"finish_reason":null}]}`+"\n\n"+`data: {"id":"answer","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`+"\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	a.app.config.Model.Endpoint = upstream.URL
	a.app.config.Model.ID = "test"
	startAgentWorker(t, a)
	client := a.register("unassigned-dialogue@example.com")
	opened := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course"}, 201)
	id := opened["id"].(string)
	conversationID := opened["conversationId"].(string)
	if conversationID == "" {
		t.Fatal("a new dialogue must have a durable ID before any course tool runs")
	}
	a.request(client, "POST", "/agent/sessions/"+id+"/commands", map[string]any{"requestId": "first-message", "action": "prompt", "args": []any{"为什么天空是蓝色的"}}, 202)
	deadline := time.Now().Add(10 * time.Second)
	for {
		state := a.request(client, "GET", "/agent/sessions/"+id, nil, 200)["state"].(map[string]any)
		raw, _ := json.Marshal(state)
		if strings.Contains(string(raw), "先聊聊你的问题") && state["busy"] == false {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("reply never completed: %s", raw)
		}
		time.Sleep(25 * time.Millisecond)
	}
	listed := a.request(client, "GET", "/conversations", nil, 200)["conversations"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["id"] != conversationID {
		t.Fatalf("unassigned dialogue missing from history: %v", listed)
	}
	if listed[0].(map[string]any)["title"] != "为什么天空是蓝色的" {
		t.Fatalf("missing user-facing title: %v", listed)
	}
	restored := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "conversationId": conversationID}, 201)
	if restored["id"] != id {
		t.Fatalf("reopened a different execution: %v", restored)
	}
	raw, _ := json.Marshal(restored["state"])
	if !strings.Contains(string(raw), "先聊聊你的问题") || !strings.Contains(string(raw), "为什么天空是蓝色的") {
		t.Fatalf("lost dialogue: %s", raw)
	}
	other := a.register("unassigned-other@example.com")
	a.request(other, "POST", "/agent/sessions", map[string]any{"kind": "course", "conversationId": conversationID}, 404)
}

func TestCourseAssignmentKeepsOriginalDialogue(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("assign-existing-dialogue@example.com")
	opened := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course"}, 201)
	id := opened["id"].(string)
	conversationID := opened["conversationId"].(string)
	user := a.request(client, "GET", "/me", nil, 200)["id"].(string)
	claimed, err := a.app.executionService().Claim(context.Background(), user, id)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path string, body any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, a.internal.URL+path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
		req.Header.Set("X-Zhiya-Agent-Session", id)
		req.Header.Set("X-Zhiya-Execution", claimed.Grant)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			raw, _ := io.ReadAll(res.Body)
			t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, raw)
		}
		var result map[string]any
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	state := opened["state"].(map[string]any)
	state["lesson"] = map[string]any{"messages": []any{map[string]any{"id": 1, "role": "user", "text": "认识循环"}}, "pages": []any{}, "presentations": []any{}, "currentPresentationId": ""}
	request("POST", "/sessions/"+id+"/state", state)
	created := request("POST", "/courses", map[string]any{"title": "编程入门", "topic": "循环", "cover": map[string]any{"motif": "code", "palette": "sprout", "label": "CODE"}})["course"].(map[string]any)
	courseID := created["id"].(string)
	outline := request("PUT", "/courses/"+courseID+"/outline", map[string]any{"sections": []any{map[string]any{"title": "循环", "objective": "理解重复", "status": "active"}}})["course"].(map[string]any)
	section := outline["sections"].([]any)[0].(map[string]any)["id"].(string)
	assigned := request("POST", "/courses/"+courseID+"/sections/"+section+"/conversations", map[string]any{"title": "认识循环"})["conversation"].(map[string]any)
	if assigned["id"] != conversationID {
		t.Fatalf("assignment replaced dialogue ID: %v", assigned)
	}
	raw, _ := json.Marshal(assigned["state"])
	if !strings.Contains(string(raw), "认识循环") {
		t.Fatalf("assignment lost prior message: %s", raw)
	}
	state["course"] = outline
	request("POST", "/sessions/"+id+"/state", state)
	listed := a.request(client, "GET", "/conversations", nil, 200)["conversations"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["id"] != conversationID || listed[0].(map[string]any)["courseId"] != courseID {
		t.Fatalf("duplicate or missing dialogue: %v", listed)
	}
	restored := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "course", "conversationId": conversationID}, 201)
	if restored["id"] != id || restored["courseId"] != courseID {
		t.Fatalf("lost execution identity: %v", restored)
	}
}

func startAgentWorker(t *testing.T, a *testApp) {
	t.Helper()
	build := exec.Command("node", "build.mjs")
	build.Dir = "../../../../agent"
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build agent: %v %s", err, output)
	}
	worker := exec.Command("node", "dist/server.mjs")
	worker.Dir = "../../../../agent"
	worker.Env = append(os.Environ(), "ZHIYA_AGENT_WORKSPACES="+t.TempDir(), "ZHIYA_AGENT_SECRET="+a.config.Agent.Secret, "ZHIYA_AGENT_API="+a.internal.URL, "ZHIYA_AGENT_LISTEN=127.0.0.1:0")
	stdout, err := worker.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	worker.Stderr = os.Stderr
	if err = worker.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = worker.Process.Kill(); _ = worker.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("agent did not start")
	}
	a.app.config.Agent.Endpoint = "http://" + strings.TrimPrefix(scanner.Text(), "Agent service listening on ")
}

func TestProfileAgentWaitsForAnswerAcrossClientDeparture(t *testing.T) {
	a := setupAccountTest(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Role string `json:"role"`
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		count := 0
		for _, message := range payload.Messages {
			if message.Role == "tool" {
				count++
			}
		}
		calls := []map[string]any{
			{"name": "ask_student", "arguments": `{"text":"怎样学习？","kind":"single","options":["先看例子","先尝试"]}`},
			{"name": "update_memory", "arguments": `{"content":"喜欢先看例子。","version":0}`},
			{"name": "complete_onboarding", "arguments": `{}`},
		}
		delta := map[string]any{"role": "assistant", "content": "完成"}
		reason := "stop"
		if count < len(calls) {
			delta = map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("call-%d", count), "type": "function", "function": calls[count]}}}
			reason = "tool_calls"
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, choice := range []map[string]any{{"index": 0, "delta": delta, "finish_reason": nil}, {"index": 0, "delta": map[string]any{}, "finish_reason": reason}} {
			chunk, _ := json.Marshal(map[string]any{"id": "profile", "object": "chat.completion.chunk", "created": 1, "model": "test", "choices": []any{choice}})
			fmt.Fprintf(w, "data: %s\n\n", chunk)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	a.app.config.Model.Endpoint = upstream.URL
	a.app.config.Model.ID = "test"
	startAgentWorker(t, a)
	client := a.register("profile-background@example.com")
	session := a.request(client, "POST", "/agent/sessions", map[string]any{"kind": "profile"}, 201)
	id := session["id"].(string)
	a.request(client, "POST", "/agent/sessions/"+id+"/commands", map[string]any{"requestId": "profile-run", "action": "run", "args": []any{}}, 202)
	a.request(client, "POST", "/auth/logout", map[string]any{}, 200)
	a.request(client, "POST", "/auth/login", map[string]string{"email": "profile-background@example.com", "password": testPassword}, 200)
	deadline := time.Now().Add(10 * time.Second)
	for {
		state := a.request(client, "GET", "/learning", nil, 200)
		if state["question"] != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("question missing: %v; agent: %v", state, a.request(client, "GET", "/agent/sessions/"+id, nil, 200))
		}
		time.Sleep(25 * time.Millisecond)
	}
	a.request(client, "POST", "/learning/action", map[string]any{"action": "answer", "toolCallId": "call-0", "answer": map[string]any{"selected": []string{"先看例子"}, "text": "", "skipped": false}}, 200)
	for {
		state := a.request(client, "GET", "/learning", nil, 200)
		if state["completed"] == true {
			if state["memory"] != "喜欢先看例子。" {
				t.Fatalf("memory missing: %v", state)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("loop did not resume: %v; agent: %v", state, a.request(client, "GET", "/agent/sessions/"+id, nil, 200))
		}
		time.Sleep(25 * time.Millisecond)
	}
}
