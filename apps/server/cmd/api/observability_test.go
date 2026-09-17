package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/coder/websocket"
)

func decodeApplicationLogs(t *testing.T, output string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("invalid JSON log %q: %v", line, err)
		}
		records = append(records, record)
	}
	return records
}

func TestServiceFailuresKeepPrivateCauseInCorrelatedLogs(t *testing.T) {
	var output bytes.Buffer
	app := &application{logger: slog.New(slog.NewJSONHandler(&output, nil))}
	handler := logging.HTTPMiddleware(app.logger, func(w http.ResponseWriter) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "服务暂时不可用，请稍后重试"})
	})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		app.respondError(w, operationalFailure(http.StatusServiceUnavailable, "邮件发送失败，请稍后重新获取", errors.New("smtp dial refused")))
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/register/start", nil))

	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "smtp dial refused") {
		t.Fatalf("response exposed private cause: %d %q", response.Code, response.Body.String())
	}
	records := decodeApplicationLogs(t, output.String())
	if len(records) != 2 {
		t.Fatalf("logs = %v; want an error and completion record", records)
	}
	requestID := response.Header().Get("X-Request-ID")
	if records[0]["msg"] != "request failed" || records[0]["request_id"] != requestID || !strings.Contains(records[0]["error"].(string), "smtp dial refused") {
		t.Fatalf("service failure was not logged with its cause: %v", records[0])
	}
	if records[1]["status"] != float64(http.StatusServiceUnavailable) || records[1]["request_id"] != requestID {
		t.Fatalf("completion log was not correlated: %v", records[1])
	}
}

func TestInterruptedModelStreamProducesCorrelatedFailureLog(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
	}))
	defer upstream.Close()

	var output bytes.Buffer
	app := &application{logger: slog.New(slog.NewJSONHandler(&output, nil))}
	app.config.Model.Endpoint = upstream.URL
	app.config.Model.ID = "test-model"
	handler := logging.HTTPMiddleware(app.logger, func(w http.ResponseWriter) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "服务暂时不可用，请稍后重试"})
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app.streamModel(r.Context(), w, r, map[string]any{"messages": []any{}}, "teacher", nil)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/learning/course/model", nil))

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "模型连接中断") {
		t.Fatalf("stream response = %d %q", response.Code, response.Body.String())
	}
	records := decodeApplicationLogs(t, output.String())
	if len(records) != 2 {
		t.Fatalf("logs = %v; want a model failure and completion record", records)
	}
	requestID := response.Header().Get("X-Request-ID")
	if records[0]["msg"] != "model stream failed" || records[0]["request_id"] != requestID || records[0]["agent"] != "teacher" || records[0]["phase"] != "read" {
		t.Fatalf("model failure was not correlated: %v", records[0])
	}
	if records[1]["status"] != float64(http.StatusOK) || records[1]["request_id"] != requestID {
		t.Fatalf("completion log did not preserve the streaming status: %v", records[1])
	}
}

func TestLearningActionFailureProducesClientAndServerCorrelation(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "socket-request")
	message := learningActionError(logger, "client-action", errors.New("database unavailable"))

	if message.Type != "error" || message.RequestID != "client-action" || message.Status != http.StatusInternalServerError || message.Error != "服务暂时不可用，请稍后重试" {
		t.Fatalf("socket error = %#v", message)
	}
	records := decodeApplicationLogs(t, output.String())
	if len(records) != 1 || records[0]["msg"] != "learning action failed" || records[0]["request_id"] != "socket-request" || records[0]["client_request_id"] != "client-action" || records[0]["error"] != "database unavailable" {
		t.Fatalf("learning action failure was not correlated: %v", records)
	}
}

func TestLearningSocketLogsOnlyUnexpectedInterruptions(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil)).With("request_id", "socket-request")
	logLearningSocketEnd(context.Background(), logger, "read", websocket.CloseError{Code: websocket.StatusNormalClosure})
	logLearningSocketEnd(context.Background(), logger, "ping", errors.New("connection reset"))

	records := decodeApplicationLogs(t, output.String())
	if len(records) != 1 || records[0]["msg"] != "learning socket interrupted" || records[0]["operation"] != "ping" || records[0]["error"] != "connection reset" {
		t.Fatalf("unexpected socket interruption logs: %v", records)
	}
}
