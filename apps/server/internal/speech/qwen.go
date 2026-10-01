package speech

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/identifier"
	"github.com/coder/websocket"
)

const ttsReadLimit = 4 << 20

func dialASR(ctx context.Context, settings config.Speech) (*websocket.Conn, error) {
	conn, response, err := websocket.Dial(ctx, settings.Endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + settings.ASRAPIKey}}})
	return conn, wrapSpeechDialError(response, err)
}

func dialTTS(ctx context.Context, settings config.Speech) (*websocket.Conn, error) {
	conn, response, err := websocket.Dial(ctx, realtimeTTSEndpoint(settings.Endpoint, settings.TTSModel), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + settings.TTSAPIKey}}})
	if err == nil {
		conn.SetReadLimit(ttsReadLimit)
	}
	return conn, wrapSpeechDialError(response, err)
}

func startASR(ctx context.Context, conn *websocket.Conn, model, taskID string) error {
	task := map[string]any{"header": map[string]any{"action": "run-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"task_group": "audio", "task": "asr", "function": "recognition", "model": model, "parameters": map[string]any{"format": "pcm", "sample_rate": 16000}, "input": map[string]any{}}}
	return conn.Write(ctx, websocket.MessageText, mustJSON(task))
}

func finishASR(ctx context.Context, conn *websocket.Conn, taskID string) error {
	return conn.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"header": map[string]any{"action": "finish-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"input": map[string]any{}}}))
}

func startTTS(ctx context.Context, conn *websocket.Conn, voice, text string) error {
	events := []map[string]any{
		ttsClientEvent("session.update", map[string]any{"session": map[string]any{"voice": voice, "response_format": "pcm", "sample_rate": 24000, "mode": "server_commit"}}),
		ttsClientEvent("input_text_buffer.append", map[string]any{"text": text}),
		ttsClientEvent("input_text_buffer.commit", nil),
	}
	for _, event := range events {
		if err := conn.Write(ctx, websocket.MessageText, mustJSON(event)); err != nil {
			return err
		}
	}
	return nil
}

func ttsClientEvent(eventType string, fields map[string]any) map[string]any {
	event := map[string]any{"event_id": identifier.New(), "type": eventType}
	for key, value := range fields {
		event[key] = value
	}
	return event
}

func wrapSpeechDialError(response *http.Response, err error) error {
	if err == nil {
		return nil
	}
	if response != nil {
		return fmt.Errorf("上游 HTTP %s: %w", response.Status, err)
	}
	return err
}

func realtimeTTSEndpoint(rawEndpoint, model string) string {
	parsed, err := url.Parse(rawEndpoint)
	if err != nil {
		return rawEndpoint
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/api-ws/v1/inference") + "/api-ws/v1/realtime"
	query := parsed.Query()
	query.Set("model", model)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
