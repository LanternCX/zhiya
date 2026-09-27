package logging

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

func TestConsoleLogsAreCompactAndStructured(t *testing.T) {
	var output bytes.Buffer
	handler := newConsoleHandler(&output, slog.LevelDebug, false)
	logger := slog.New(handler.WithAttrs([]slog.Attr{slog.String("service", "api")}))
	record := slog.NewRecord(time.Date(2026, 9, 17, 15, 32, 10, 0, time.Local), slog.LevelInfo, "server listening", 0)
	record.Add("address", "127.0.0.1:8080", slog.Group("request", "method", "GET", "route", "/health check"))
	if err := logger.Handler().Handle(t.Context(), record); err != nil {
		t.Fatal(err)
	}

	want := "15:32:10 INFO  server listening service=api address=127.0.0.1:8080 request.method=GET request.route=\"/health check\"\n"
	if output.String() != want {
		t.Fatalf("console log = %q; want %q", output.String(), want)
	}
	if handler.Enabled(t.Context(), slog.LevelDebug-1) || !handler.Enabled(t.Context(), slog.LevelDebug) {
		t.Fatal("console handler did not apply the configured level")
	}
}

func TestConsoleLoggerPreservesAttributeGroupScope(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(newConsoleHandler(&output, slog.LevelInfo, false)).
		WithGroup("request").
		With("method", "GET").
		WithGroup("response")
	logger.Info("completed", "status", 200)

	if !strings.Contains(output.String(), "request.method=GET request.response.status=200") {
		t.Fatalf("attribute groups were not preserved: %q", output.String())
	}
}

func TestConsoleColorsAreOptionalAndJSONFormatIsUnchanged(t *testing.T) {
	var colored bytes.Buffer
	record := slog.NewRecord(time.Time{}, slog.LevelError, "request failed", 0)
	if err := newConsoleHandler(&colored, slog.LevelInfo, true).Handle(t.Context(), record); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(colored.String(), "\x1b[") {
		t.Fatalf("colored console log does not contain ANSI styling: %q", colored.String())
	}

	var machine bytes.Buffer
	logger := New(&machine, config.Logging{Level: "info", Format: "json"})
	logger.Info("configuration is valid")
	var recordJSON map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(machine.Bytes()), &recordJSON); err != nil {
		t.Fatal(err)
	}
	if recordJSON["level"] != "INFO" || recordJSON["msg"] != "configuration is valid" {
		t.Fatalf("JSON logging changed unexpectedly: %v", recordJSON)
	}
}

func TestNoColorDisablesTerminalStyling(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	if consoleColors(os.Stderr) {
		t.Fatal("NO_COLOR did not disable terminal styling")
	}
}

func decodeLogs(t *testing.T, output string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("invalid JSON log %q: %v", line, err)
		}
		records = append(records, record)
	}
	return records
}

func panicResponse(w http.ResponseWriter) {
	http.Error(w, "service unavailable", http.StatusInternalServerError)
}

func TestHTTPRequestsHaveCorrelatedPrivacySafeLogs(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /things/{id}", func(w http.ResponseWriter, _ *http.Request) {
		ForResponse(w, logger).Error("request failed", "error", errors.New("database unavailable"))
		http.Error(w, "service unavailable", http.StatusInternalServerError)
	})

	req := httptest.NewRequest(http.MethodPost, "/things/private-resource?token=query-secret", strings.NewReader(`{"email":"body-secret@example.com"}`))
	req.Header.Set("Authorization", "Bearer header-secret")
	req.AddCookie(&http.Cookie{Name: "session", Value: "cookie-secret"})
	response := httptest.NewRecorder()
	HTTPMiddleware(logger, panicResponse)(mux).ServeHTTP(response, req)

	requestID := response.Header().Get("X-Request-ID")
	if requestID == "" {
		t.Fatal("response does not contain a request ID")
	}
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d; want 500", response.Code)
	}
	records := decodeLogs(t, output.String())
	if len(records) != 2 {
		t.Fatalf("logs = %v; want an error and completion record", records)
	}
	if records[0]["msg"] != "request failed" || records[0]["request_id"] != requestID || records[0]["error"] != "database unavailable" {
		t.Fatalf("uncorrelated error log: %v", records[0])
	}
	if records[1]["msg"] != "http request completed" || records[1]["request_id"] != requestID || records[1]["method"] != "POST" || records[1]["route"] != "POST /things/{id}" || records[1]["status"] != float64(500) {
		t.Fatalf("unexpected completion log: %v", records[1])
	}
	if _, ok := records[1]["duration_ms"]; !ok {
		t.Fatal("completion log does not contain duration_ms")
	}
	for _, secret := range []string{"private-resource", "query-secret", "body-secret@example.com", "header-secret", "cookie-secret"} {
		if strings.Contains(output.String(), secret) {
			t.Fatalf("logs contain sensitive request data %q: %s", secret, output.String())
		}
	}
}

func TestHTTPPanicsAreLoggedAndReturnGenericError(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /panic", func(http.ResponseWriter, *http.Request) { panic("boom") })
	response := httptest.NewRecorder()

	HTTPMiddleware(logger, panicResponse)(mux).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/panic", nil))

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "service unavailable") {
		t.Fatalf("panic response = %d %q", response.Code, response.Body.String())
	}
	records := decodeLogs(t, output.String())
	if len(records) != 2 || records[0]["msg"] != "request panicked" || records[0]["panic"] != "boom" || records[0]["stack"] == "" {
		t.Fatalf("panic was not logged with a stack: %v", records)
	}
	if records[0]["request_id"] != response.Header().Get("X-Request-ID") || records[1]["status"] != float64(500) {
		t.Fatalf("panic logs are not correlated with the response: %v", records)
	}
}
