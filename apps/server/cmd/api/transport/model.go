package transport

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/LanternCX/zhiya/apps/server/internal/logging"
	"github.com/LanternCX/zhiya/apps/server/internal/modelproxy"
)

func (a Responder) StreamModel(ctx context.Context, w http.ResponseWriter, r *http.Request, payload map[string]any, agent string, onDone func(), model *modelproxy.Client) bool {
	if payload == nil {
		a.RespondError(w, Bad("模型请求无效"))
		return false
	}
	requestLogger := logging.ForResponse(w, a.Logger())
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
	completed, failure := model.Stream(ctx, payload, agent, requestLogger, writeStream, onDone)
	if failure == nil {
		return completed
	}
	if !streamStarted {
		a.RespondError(w, OperationalFailure(http.StatusBadGateway, failure.Message, failure.Cause))
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
