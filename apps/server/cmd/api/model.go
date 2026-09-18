package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/logging"
)

func (a *application) modelInfo(w http.ResponseWriter, r *http.Request) {
	_, err := a.accountService().Authenticate(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"))
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": a.config.Model.ID, "available": a.config.Model.Endpoint != ""})
}

func (a *application) modelProxy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RunID   string         `json:"runId"`
		Payload map[string]any `json:"payload"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	user, err := a.learningService().ClaimModelRun(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), input.RunID, a.config.Model.Endpoint != "")
	if err != nil {
		a.respondError(w, err)
		return
	}
	requestLogger := logging.ForResponse(w, a.applicationLogger())
	var finished sync.Once
	completed := false
	finish := func() {
		finished.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			finishErr := a.learningService().FinishModelRun(ctx, user, input.RunID, completed)
			if finishErr != nil {
				requestLogger.Error("model session cleanup failed", "run_id", input.RunID, "completed", completed, "error", finishErr)
			}
		})
	}
	defer finish()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	unregister := a.learningHub.registerExecution(user, input.RunID, cancel)
	defer unregister()
	if current, snapshotErr := a.learningService().Snapshot(ctx, user, 1<<30); snapshotErr != nil || current.RunID != input.RunID {
		if snapshotErr != nil {
			requestLogger.ErrorContext(ctx, "model session verification failed", "run_id", input.RunID, "error", snapshotErr)
		} else {
			requestLogger.InfoContext(ctx, "model session superseded", "run_id", input.RunID)
		}
		cancel()
	}
	completed = a.streamModel(ctx, w, r, input.Payload, "", func() {
		completed = true
		finish()
	})
	return
}

func (a *application) courseModelProxy(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Agent   string         `json:"agent"`
		Payload map[string]any `json:"payload"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	if input.Agent != "teacher" && input.Agent != "slides" && input.Agent != "outline-classifier" {
		a.respondError(w, bad("课堂 Agent 无效"))
		return
	}
	if err := a.learningService().AuthorizeModel(r.Context(), sessionToken(r), r.Header.Get("X-Zhiya-User"), a.config.Model.Endpoint != ""); err != nil {
		a.respondError(w, err)
		return
	}
	a.streamModel(r.Context(), w, r, input.Payload, input.Agent, nil)
}

func (a *application) streamModel(ctx context.Context, w http.ResponseWriter, r *http.Request, payload map[string]any, agent string, onDone func()) bool {
	if payload == nil {
		a.respondError(w, bad("模型请求无效"))
		return false
	}
	requestLogger := logging.ForResponse(w, a.applicationLogger())
	streamStarted := false
	writeStream := func(value string) bool {
		if streamStarted {
			if _, err := io.WriteString(w, value); err != nil {
				return false
			}
			_ = http.NewResponseController(w).Flush()
			return true
		}
		streamStarted = true
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("X-Accel-Buffering", "no")
		if _, err := io.WriteString(w, value); err != nil {
			return false
		}
		_ = http.NewResponseController(w).Flush()
		return true
	}
	completed, failure := a.modelClient().Stream(ctx, payload, agent, requestLogger, writeStream, onDone)
	if failure == nil {
		return completed
	}
	if !streamStarted {
		a.respondError(w, operationalFailure(http.StatusBadGateway, failure.Message, failure.Cause))
		return false
	}
	fields := []any{"phase", failure.Phase, "error", failure.Cause}
	if agent != "" {
		fields = append([]any{"agent", agent}, fields...)
	}
	requestLogger.ErrorContext(ctx, "model stream failed", append(fields, failure.Values...)...)
	rawError, _ := json.Marshal(map[string]any{"error": map[string]string{"message": failure.Message, "type": "upstream_connection_error"}})
	_ = writeStream("data: " + string(rawError) + "\n\n")
	return false
}
