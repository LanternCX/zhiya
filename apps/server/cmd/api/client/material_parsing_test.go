package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
)

func TestMaterialUploadCompletesOnlyAfterParsing(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("blocking-material@example.com")
	course, _ := a.createCourseConversation(owner)
	started, release := make(chan struct{}), make(chan struct{})
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		io.WriteString(w, `{"pages":[{"text":"解析后的原文","source":{"page":1}}]}`)
	}))
	defer converter.Close()
	defer close(release)
	a.app.config.MaterialParser.Endpoint = converter.URL
	path, _ := a.stageMaterial(owner, course, "lesson.pdf", "%PDF sample", http.StatusCreated)
	done := make(chan *http.Response, 1)
	go func() {
		request, _ := http.NewRequest("POST", a.server.URL+"/api"+path, nil)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Zhiya-Request", "1")
		response, _ := owner.Do(request)
		done <- response
	}()
	select {
	case <-started:
	case response := <-done:
		if response != nil {
			response.Body.Close()
		}
		t.Fatal("upload completed before parsing started")
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not start parsing")
	}
	select {
	case response := <-done:
		if response != nil {
			response.Body.Close()
		}
		t.Fatal("upload completed while parsing was blocked")
	case <-time.After(100 * time.Millisecond):
	}
	release <- struct{}{}
	response := <-done
	if response == nil {
		t.Fatal("upload request failed")
	}
	defer response.Body.Close()
	var result map[string]any
	json.NewDecoder(response.Body).Decode(&result)
	if response.StatusCode != http.StatusCreated || result["material"].(map[string]any)["parseStatus"] != "ready" {
		t.Fatalf("upload did not return parsed material: %v", result)
	}
	materialID := result["material"].(map[string]any)["id"].(string)
	read := a.request(owner, "GET", "/courses/"+course+"/materials/"+materialID+"/content", nil, http.StatusOK)
	if !strings.Contains(fmt.Sprint(read), "解析后的原文") {
		t.Fatalf("parsed content unavailable: %v", read)
	}
}

func TestCancelledMaterialUploadCanResumeParsingImmediately(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("cancelled-material@example.com")
	course, _ := a.createCourseConversation(owner)
	started := make(chan struct{})
	var calls atomic.Int32
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			io.Copy(io.Discard, r.Body)
			close(started)
			<-r.Context().Done()
			return
		}
		io.WriteString(w, `{"pages":[{"text":"重试后的原文","source":{"page":1}}]}`)
	}))
	defer converter.Close()
	a.app.config.MaterialParser.Endpoint = converter.URL
	path, _ := a.stageMaterial(owner, course, "lesson.pdf", "%PDF sample", http.StatusCreated)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		request, _ := http.NewRequestWithContext(ctx, "POST", a.server.URL+"/api"+path, nil)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Zhiya-Request", "1")
		response, err := owner.Do(request)
		if response != nil {
			response.Body.Close()
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("parsing did not start")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("request did not cancel: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		listed := a.request(owner, "GET", "/courses/"+course+"/materials", nil, http.StatusOK)["materials"].([]any)
		if listed[0].(map[string]any)["parseStatus"] == "pending" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancelled parsing still holds its lease")
		}
		time.Sleep(10 * time.Millisecond)
	}
	result := a.request(owner, "POST", path, nil, http.StatusCreated)
	if result["material"].(map[string]any)["parseStatus"] != "ready" {
		t.Fatalf("retry did not parse: %v", result)
	}
}

func TestMaterialParsingProvidesPrivateVersionedLineRanges(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("parsed-owner@example.com")
	other := a.register("parsed-other@example.com")
	course, _ := a.createCourseConversation(owner)
	upload := a.uploadMaterial(owner, course, "课本.md", "第一行\r\n第二行\n第三行", http.StatusCreated)["material"].(map[string]any)
	path := "/courses/" + course + "/materials/" + upload["id"].(string)
	a.request(owner, "GET", path+"/content", nil, http.StatusOK)
	a.request(other, "GET", path+"/content", nil, http.StatusNotFound)
	read := a.request(owner, "GET", path+"/content?startLine=2&endLine=2", nil, http.StatusOK)
	excerpt := read["excerpt"].(map[string]any)
	lines := excerpt["lines"].([]any)
	if read["revision"] != float64(1) || excerpt["nextLine"] != float64(3) || lines[0].(map[string]any)["text"] != "第二行" || lines[0].(map[string]any)["number"] != float64(2) {
		t.Fatalf("unexpected read: %v", read)
	}
	a.request(owner, "GET", path+"/content?startLine=2&endLine=1", nil, http.StatusBadRequest)
	a.request(owner, "GET", path+"/content?startLine=no", nil, http.StatusBadRequest)
	a.request(other, "POST", path+"/parse", nil, http.StatusNotFound)
	a.request(owner, "POST", path+"/parse", nil, http.StatusAccepted)
	a.request(owner, "GET", path+"/content", nil, http.StatusConflict)
	a.request(owner, "GET", path+"/content?revision=1", nil, http.StatusOK)
	worked, err := a.app.courseService().ProcessNextMaterial(context.Background(), materialparse.New("", "", "", "", nil))
	if err != nil || !worked {
		t.Fatalf("reparse: %v %v", worked, err)
	}
	current := a.request(owner, "GET", path+"/content", nil, http.StatusOK)
	if current["revision"] != float64(2) {
		t.Fatalf("revision did not advance: %v", current)
	}
	a.request(owner, "DELETE", path, nil, http.StatusOK)
	a.request(owner, "GET", path+"/content?revision=1", nil, http.StatusNotFound)
}

func TestAgentReadsParsedLinesOnlyWithinItsCourseGrant(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("agent-material@example.com")
	course, conversation := a.createCourseConversation(owner)
	otherCourse, _ := a.createCourseConversation(owner)
	upload := a.uploadMaterial(owner, course, "课本.txt", "第一行\n第二行", http.StatusCreated)["material"].(map[string]any)
	other := a.uploadMaterial(owner, otherCourse, "其他.txt", "其他课程的内容", http.StatusCreated)["material"].(map[string]any)
	opened := a.request(owner, "POST", "/agent/sessions", map[string]any{"kind": "course", "courseId": course, "conversationId": conversation}, http.StatusCreated)
	user := a.request(owner, "GET", "/me", nil, http.StatusOK)["id"].(string)
	session, err := a.app.executionService().Claim(context.Background(), user, opened["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		course, id string
		status     int
	}{
		{course, upload["id"].(string), http.StatusOK},
		{otherCourse, other["id"].(string), http.StatusUnauthorized},
		{course, other["id"].(string), http.StatusNotFound},
	} {
		req, _ := http.NewRequest("GET", a.internal.URL+"/courses/"+tc.course+"/materials/"+tc.id+"/content?startLine=2&endLine=2", nil)
		req.Header.Set("Authorization", "Bearer "+a.config.Agent.Secret)
		req.Header.Set("X-Zhiya-Agent-Session", session.ID)
		req.Header.Set("X-Zhiya-Execution", session.Grant)
		response, err := owner.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Fatalf("read status %d want %d: %s", response.StatusCode, tc.status, raw)
		}
		if tc.status == http.StatusOK && (!bytes.Contains(raw, []byte("第二行")) || bytes.Contains(raw, []byte("第一行"))) {
			t.Fatalf("range not respected: %s", raw)
		}
	}
}

func TestImageUploadThroughConverterAndVisionBecomesReadable(t *testing.T) {
	endpoint := os.Getenv("ZHIYA_TEST_MATERIAL_PARSER")
	if endpoint == "" {
		t.Skip("set ZHIYA_TEST_MATERIAL_PARSER to the running conversion service")
	}
	a := setupAccountTest(t)
	owner := a.register("image-material@example.com")
	course, _ := a.createCourseConversation(owner)
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 100, 100))); err != nil {
		t.Fatal(err)
	}
	vision := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if len(request.Messages) != 2 || !bytes.Contains(request.Messages[1].Content, []byte("data:image/jpeg;base64,")) {
			t.Error("converter did not supply an image")
		}
		io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{\"transcription\":\"输入 → 输出\",\"description\":\"箭头从输入指向输出\",\"uncertainties\":[]}"}}]}`)
	}))
	defer vision.Close()
	a.app.config.MaterialParser.Endpoint = endpoint
	a.app.config.VisionModel.Endpoint = vision.URL
	a.app.config.VisionModel.ID = "qwen3-vl-plus"
	a.app.config.VisionModel.APIKey = "test-key"
	upload := a.uploadMaterial(owner, course, "图解.png", imageBytes.String(), http.StatusCreated)["material"].(map[string]any)
	read := a.request(owner, "GET", "/courses/"+course+"/materials/"+upload["id"].(string)+"/content", nil, http.StatusOK)
	excerpt := read["excerpt"].(map[string]any)
	lines := excerpt["lines"].([]any)
	if excerpt["status"] != "ready" || len(lines) != 2 || lines[1].(map[string]any)["kind"] != "description" {
		t.Fatalf("unexpected image result: %v", read)
	}
}

func TestFailedParsingKeepsOriginalAndCanBeRetried(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("parse-failure@example.com")
	course, _ := a.createCourseConversation(owner)
	a.app.config.MaterialParser.Endpoint = ""
	completePath, _ := a.stageMaterial(owner, course, "scan.pdf", "%PDF sample", http.StatusCreated)
	a.request(owner, "POST", completePath, nil, http.StatusConflict)
	a.request(owner, "POST", completePath, nil, http.StatusConflict)
	listed := a.request(owner, "GET", "/courses/"+course+"/materials", nil, http.StatusOK)["materials"].([]any)
	path := "/courses/" + course + "/materials/" + listed[0].(map[string]any)["id"].(string)
	if listed[0].(map[string]any)["parseStatus"] != "failed" {
		t.Fatalf("failed parse hidden: %v", listed)
	}
	a.request(owner, "GET", path+"/content", nil, http.StatusConflict)
	download := a.request(owner, "GET", path+"/download", nil, http.StatusOK)
	response, err := owner.Get(download["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if string(raw) != "%PDF sample" {
		t.Fatal("source was lost")
	}
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"pages": []any{map[string]any{"text": "可以读取的原文", "image": "data:image/png;base64,aGVsbG8=", "source": map[string]int{"page": 1}}}})
	}))
	defer converter.Close()
	a.request(owner, "POST", path+"/parse", nil, http.StatusAccepted)
	worked, err := a.app.courseService().ProcessNextMaterial(context.Background(), materialparse.New(converter.URL, "", "", "", nil))
	if err != nil || !worked {
		t.Fatalf("retry: %v %v", worked, err)
	}
	read := a.request(owner, "GET", path+"/content", nil, http.StatusOK)
	excerpt := read["excerpt"].(map[string]any)
	if excerpt["status"] != "partial" || len(excerpt["warnings"].([]any)) != 1 {
		t.Fatalf("missing image hidden: %v", read)
	}
	if !strings.Contains(excerpt["warnings"].([]any)[0].(string), "视觉解析失败") {
		t.Fatalf("missing failure context: %v", read)
	}
}

func TestConcurrentWorkersDoNotDuplicateOrResurrectDeletedMaterials(t *testing.T) {
	a := setupAccountTest(t)
	owner := a.register("parse-concurrent@example.com")
	course, _ := a.createCourseConversation(owner)
	started, release := make(chan struct{}), make(chan struct{})
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		io.WriteString(w, `{"pages":[{"text":"page","source":{"page":1}}]}`)
	}))
	defer converter.Close()
	defer close(release)
	a.app.config.MaterialParser.Endpoint = converter.URL
	completePath, _ := a.stageMaterial(owner, course, "lesson.pdf", "%PDF sample", http.StatusCreated)
	parser := materialparse.New(converter.URL, "", "", "", nil)
	done := make(chan struct{})
	go func() { a.request(owner, "POST", completePath, nil, http.StatusNotFound); close(done) }()
	<-started
	listed := a.request(owner, "GET", "/courses/"+course+"/materials", nil, http.StatusOK)["materials"].([]any)
	path := "/courses/" + course + "/materials/" + listed[0].(map[string]any)["id"].(string)
	worked, err := a.app.courseService().ProcessNextMaterial(context.Background(), parser)
	if worked || err != nil {
		t.Fatalf("duplicate work: %v %v", worked, err)
	}
	a.request(owner, "DELETE", path, nil, http.StatusOK)
	// Release before checking the late result without closing the gate twice.
	release <- struct{}{}
	<-done
	a.request(owner, "GET", path+"/content", nil, http.StatusNotFound)
}
