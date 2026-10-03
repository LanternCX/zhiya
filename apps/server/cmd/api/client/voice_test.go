package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/config"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestVoiceSocketsSkipRequestTimeout(t *testing.T) {
	for _, path := range []string{"/api/learning/socket", "/api/learning/model", "/api/speech/stream", "/api/voice/session", "/api/courses/course/material-uploads/upload/complete", "/api/courses/course/deliverables/import"} {
		if !isLongLivedAPIPath(path) {
			t.Fatalf("%s was not marked long-lived", path)
		}
	}
	if isLongLivedAPIPath("/api/courses") {
		t.Fatal("ordinary API path was marked long-lived")
	}
}

func TestVoiceSessionRelaysSynthesis(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("voice-relay@example.com")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("accept upstream: %v", err)
			return
		}
		defer conn.CloseNow()
		var request map[string]any
		switch r.URL.Path {
		case "/api-ws/v1/realtime":
			for range 3 {
				if err := wsjson.Read(r.Context(), conn, &request); err != nil {
					t.Errorf("TTS request: %v", err)
					return
				}
				if request["event_id"] == nil {
					t.Error("TTS request has no event ID")
					return
				}
			}
			_ = wsjson.Write(r.Context(), conn, map[string]any{"type": "response.audio.delta", "delta": "AAAAAA=="})
			_ = wsjson.Write(r.Context(), conn, map[string]any{"type": "response.audio.done"})
		default:
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()
	a.app.config.Speech = config.Speech{
		Endpoint:  "ws" + strings.TrimPrefix(upstream.URL, "http") + "/api-ws/v1/inference",
		TTSAPIKey: "test", TTSModel: "tts-test", TTSVoice: "Cherry",
	}
	ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, http.StatusOK)["ticket"].(string)
	url := "ws" + strings.TrimPrefix(a.server.URL, "http") + "/api/voice/session?ticket=" + ticket
	conn, response, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		t.Fatalf("connect voice socket: response=%v error=%v", response, err)
	}
	defer conn.CloseNow()
	if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "start-session", "sessionId": "test-session", "turnId": 0}); err != nil {
		t.Fatal(err)
	}
	if event := socketJSON(t, conn); event["type"] != "session-ready" {
		t.Fatalf("session start = %v", event)
	}
	if err := wsjson.Write(context.Background(), conn, map[string]any{"type": "speak-text", "sessionId": "test-session", "turnId": 0, "text": "你好。"}); err != nil {
		t.Fatal(err)
	}
	audio, complete := false, false
	for !audio || !complete {
		event := socketJSON(t, conn)
		switch event["type"] {
		case "tts-audio":
			audio = event["data"] == "AAAAAA=="
		case "tts-complete":
			complete = true
		case "session-error":
			t.Fatalf("voice session error: %v", event)
		}
	}
}

func TestDictationRelaysRecognition(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("dictation-relay@example.com")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("accept upstream: %v", err)
			return
		}
		defer conn.CloseNow()
		var request map[string]any
		if err := wsjson.Read(r.Context(), conn, &request); err != nil {
			t.Errorf("ASR start: %v", err)
			return
		}
		_ = wsjson.Write(r.Context(), conn, map[string]any{"payload": map[string]any{"output": map[string]any{"sentence": map[string]any{"text": "你好", "sentence_end": true}}}})
		if err := wsjson.Read(r.Context(), conn, &request); err != nil {
			t.Errorf("ASR finish: %v", err)
			return
		}
		_ = wsjson.Write(r.Context(), conn, map[string]any{"header": map[string]any{"event": "task-finished"}})
	}))
	defer upstream.Close()
	a.app.config.Speech = config.Speech{Endpoint: "ws" + strings.TrimPrefix(upstream.URL, "http") + "/api-ws/v1/inference", ASRAPIKey: "test", ASRModel: "asr-test"}
	ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, http.StatusOK)["ticket"].(string)
	url := "ws" + strings.TrimPrefix(a.server.URL, "http") + "/api/speech/stream?ticket=" + ticket
	conn, response, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		t.Fatalf("connect dictation socket: response=%v error=%v", response, err)
	}
	defer conn.CloseNow()
	if err := wsjson.Write(context.Background(), conn, map[string]string{"type": "start"}); err != nil {
		t.Fatal(err)
	}
	for {
		event := socketJSON(t, conn)
		if event["type"] == "transcript" {
			if event["text"] != "你好" || event["final"] != true {
				t.Fatalf("transcript = %v", event)
			}
			break
		}
		if event["type"] == "error" {
			t.Fatalf("dictation error: %v", event)
		}
	}
	if err := wsjson.Write(context.Background(), conn, map[string]string{"type": "stop"}); err != nil {
		t.Fatal(err)
	}
	if event := socketJSON(t, conn); event["type"] != "complete" {
		t.Fatalf("completion = %v", event)
	}
}

func TestVoiceSocketsConsumeOneTimeTicket(t *testing.T) {
	a := setupAccountTest(t)
	client := a.register("voice-ticket@example.com")
	a.app.config.Speech = config.Speech{Endpoint: "ws://127.0.0.1:1", ASRAPIKey: "test", TTSAPIKey: "test"}
	for _, path := range []string{"/api/voice/session", "/api/speech/stream"} {
		t.Run(path, func(t *testing.T) {
			base := "ws" + strings.TrimPrefix(a.server.URL, "http") + path
			_, response, err := websocket.Dial(context.Background(), base, &websocket.DialOptions{HTTPClient: client})
			if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("socket without ticket: response=%v error=%v", response, err)
			}
			ticket := a.request(client, "POST", "/socket-ticket", map[string]any{}, http.StatusOK)["ticket"].(string)
			url := base + "?ticket=" + ticket
			conn, response, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPClient: client})
			if err != nil {
				t.Fatalf("socket with ticket: response=%v error=%v", response, err)
			}
			_ = conn.CloseNow()
			_, response, err = websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPClient: client})
			if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("reused ticket: response=%v error=%v", response, err)
			}
		})
	}
}
