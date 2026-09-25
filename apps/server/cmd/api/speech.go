package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/providers"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/coder/websocket"
)

type speechCommand struct {
	Type  string `json:"type"`
	Text  string `json:"text,omitempty"`
	Voice string `json:"voice,omitempty"`
}

func (a *application) speechStream(w http.ResponseWriter, r *http.Request) {
	if err := a.withUser(r, data.StandardTransaction, func(_ data.Models, _ data.User) error { return nil }); err != nil {
		a.respondError(w, err)
		return
	}
	if a.config.Speech.Endpoint == "" || (a.config.Speech.ASRAPIKey == "" && a.config.Speech.TTSAPIKey == "") {
		a.respondError(w, failure{503, "语音服务尚未配置"})
		return
	}
	browser, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer browser.CloseNow()
	ctx := r.Context()
	var upstream *websocket.Conn
	var taskID string
	closeUpstream := func() {
		if upstream != nil {
			upstream.Close(websocket.StatusNormalClosure, "done")
			upstream = nil
		}
	}
	defer closeUpstream()
	send := func(value any) { _ = browser.Write(ctx, websocket.MessageText, mustJSON(value)) }
	for {
		typ, raw, readErr := browser.Read(ctx)
		if readErr != nil {
			return
		}
		if typ == websocket.MessageBinary {
			if upstream != nil {
				_ = upstream.Write(ctx, websocket.MessageBinary, raw)
			}
			continue
		}
		var command speechCommand
		if json.Unmarshal(raw, &command) != nil {
			send(map[string]string{"type": "error", "message": "语音控制消息无效"})
			continue
		}
		switch command.Type {
		case "start":
			if a.config.Speech.ASRAPIKey == "" {
				send(map[string]string{"type": "error", "message": "ASR API Key 尚未配置"})
				continue
			}
			closeUpstream()
			upstream, err = a.dialSpeech(ctx, a.config.Speech.ASRAPIKey)
			if err != nil {
				send(map[string]string{"type": "error", "message": fmt.Sprintf("无法连接语音服务：%v", err)})
				continue
			}
			taskID = data.UUID()
			task := map[string]any{"header": map[string]any{"action": "run-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"task_group": "audio", "task": "asr", "function": "recognition", "model": a.config.Speech.ASRModel, "parameters": map[string]any{"format": "pcm", "sample_rate": 16000}, "input": map[string]any{}}}
			_ = upstream.Write(ctx, websocket.MessageText, mustJSON(task))
			send(map[string]string{"type": "ready"})
			go a.forwardSpeech(ctx, upstream, browser, "asr", providers.QwenASR{})
		case "tts-start":
			if a.config.Speech.TTSAPIKey == "" {
				send(map[string]string{"type": "error", "message": "TTS API Key 尚未配置"})
				continue
			}
			closeUpstream()
			if strings.TrimSpace(command.Text) == "" {
				send(map[string]string{"type": "error", "message": "没有可朗读的文本"})
				continue
			}
			upstream, err = a.dialTTS(ctx, a.config.Speech.TTSAPIKey)
			if err != nil {
				send(map[string]string{"type": "error", "message": fmt.Sprintf("无法连接语音服务：%v", err)})
				continue
			}
			voice := command.Voice
			if voice == "" {
				voice = a.config.Speech.TTSVoice
			}
			setup := map[string]any{"type": "session.update", "session": map[string]any{"voice": voice, "response_format": "pcm", "sample_rate": 24000, "mode": "server_commit"}}
			_ = upstream.Write(ctx, websocket.MessageText, mustJSON(setup))
			_ = upstream.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"type": "input_text_buffer.append", "text": command.Text}))
			_ = upstream.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "input_text_buffer.commit"}))
			go a.forwardSpeech(ctx, upstream, browser, "tts", providers.QwenTTS{})
		case "stop":
			if upstream != nil {
				_ = upstream.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"header": map[string]any{"action": "finish-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"input": map[string]any{}}}))
			}
		case "tts-stop":
			closeUpstream()
			send(map[string]string{"type": "complete"})
		}
	}
}

func (a *application) dialSpeech(ctx context.Context, apiKey string) (*websocket.Conn, error) {
	conn, response, err := websocket.Dial(ctx, a.config.Speech.Endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + apiKey}}})
	return conn, wrapSpeechDialError(response, err)
}
func (a *application) dialTTS(ctx context.Context, apiKey string) (*websocket.Conn, error) {
	conn, response, err := websocket.Dial(ctx, realtimeTTSEndpoint(a.config.Speech.Endpoint, a.config.Speech.TTSModel), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + apiKey}}})
	return conn, wrapSpeechDialError(response, err)
}
func (a *application) forwardSpeech(ctx context.Context, upstream, browser *websocket.Conn, mode string, provider interface {
	Parse([]byte) (providers.VoiceEvent, error)
}) {
	for {
		typ, raw, err := upstream.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			continue
		}
		if mode == "tts" {
			event, err := provider.Parse(raw)
			if err != nil {
				continue
			}
			if event.Kind == "error" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "error", "message": event.Data}))
				return
			}
			if event.Kind == "audio" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"type": "audio", "data": event.Data, "sampleRate": 24000}))
				continue
			}
			if event.Kind == "done" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "complete"}))
				return
			}
		}
		if mode == "asr" {
			event, err := provider.Parse(raw)
			if err != nil {
				continue
			}
			if event.Kind == "transcript" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"type": "transcript", "text": event.Text, "final": event.Final}))
				continue
			}
			if event.Kind == "error" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "error", "message": event.Data}))
				return
			}
			var header struct {
				Event string `json:"event"`
			}
			var envelope struct {
				Header *struct {
					Event string `json:"event"`
				} `json:"header"`
			}
			if json.Unmarshal(raw, &envelope) == nil && envelope.Header != nil {
				header = struct {
					Event string `json:"event"`
				}(*envelope.Header)
			}
			if header.Event == "task-finished" {
				_ = browser.Write(ctx, websocket.MessageText, mustJSON(map[string]string{"type": "complete"}))
				return
			}
		}
	}
}
func mustJSON(value any) []byte { raw, _ := json.Marshal(value); return raw }
