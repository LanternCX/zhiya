package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/cmd/api/providers"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/coder/websocket"
)

// voiceSession owns one browser socket and independent upstream ASR/TTS sockets.
// The two upstreams deliberately use separate credentials and lifecycles.
type voiceSession struct {
	app       *application
	browser   *websocket.Conn
	ctx       context.Context
	sessionID string

	mu            sync.Mutex
	asr           *websocket.Conn
	tts           *websocket.Conn
	ttsGeneration uint64
	asrTaskID     string
	asrTurnID     int64
}

func (a *application) voiceSessionHandler(w http.ResponseWriter, r *http.Request) {
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
	session := &voiceSession{app: a, browser: browser, ctx: r.Context()}
	session.run()
}

func (s *voiceSession) run() {
	defer s.close()
	for {
		typ, raw, err := s.browser.Read(s.ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			s.mu.Lock()
			asr := s.asr
			s.mu.Unlock()
			if asr != nil {
				_ = asr.Write(s.ctx, websocket.MessageBinary, raw)
			}
			continue
		}
		msg, err := decodeVoiceClientMessage(raw)
		if err != nil {
			s.send(newVoiceServerEvent("session-error", s.sessionID, 0, &voiceServerEvent{Code: "invalid_message", Message: "语音控制消息无效"}))
			continue
		}
		if s.sessionID != "" && msg.SessionID != s.sessionID {
			s.send(newVoiceServerEvent("session-error", s.sessionID, msg.TurnID, &voiceServerEvent{Code: "session_mismatch", Message: "语音会话不匹配"}))
			continue
		}
		switch msg.Type {
		case "start-session":
			if s.sessionID == "" {
				s.sessionID = msg.SessionID
			}
			if err := s.startASR(msg.TurnID); err != nil {
				message := fmt.Sprintf("无法连接语音识别服务：%v", err)
				if err.Error() == "ASR API Key 未配置" {
					message = err.Error()
				}
				s.send(newVoiceServerEvent("session-error", s.sessionID, msg.TurnID, &voiceServerEvent{Code: "asr_unavailable", Message: message}))
				continue
			}
			s.send(newVoiceServerEvent("session-ready", s.sessionID, msg.TurnID, nil))
		case "commit-turn":
			s.commitASR(msg.TurnID)
		case "cancel-tts":
			s.cancelTTS(msg.TurnID)
		case "speak-text":
			if err := s.startTTS(msg.TurnID, msg.Text); err != nil {
				message := fmt.Sprintf("无法连接语音合成服务：%v", err)
				if err == errInvalidVoiceMessage {
					message = "TTS API Key 未配置或文本为空"
				}
				s.send(newVoiceServerEvent("session-error", s.sessionID, msg.TurnID, &voiceServerEvent{Code: "tts_unavailable", Message: message}))
			}
		case "mute", "unmute":
			// Audio continues to be accepted only when unmuted on the client.
		case "end-session":
			s.send(newVoiceServerEvent("session-ended", s.sessionID, msg.TurnID, nil))
			return
		}
	}
}

func (s *voiceSession) startASR(turnID int64) error {
	if s.app.config.Speech.ASRAPIKey == "" {
		return errors.New("ASR API Key 未配置")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.asr != nil {
		return nil
	}
	dialContext, cancel := context.WithTimeout(s.ctx, 8*time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(dialContext, s.app.config.Speech.Endpoint, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + s.app.config.Speech.ASRAPIKey}}})
	if err != nil {
		return wrapSpeechDialError(response, err)
	}
	s.asr = conn
	taskID := data.UUID()
	s.asrTaskID = taskID
	s.asrTurnID = turnID
	task := map[string]any{"header": map[string]any{"action": "run-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"task_group": "audio", "task": "asr", "function": "recognition", "model": s.app.config.Speech.ASRModel, "parameters": map[string]any{"format": "pcm", "sample_rate": 16000}, "input": map[string]any{}}}
	if err := conn.Write(s.ctx, websocket.MessageText, mustJSON(task)); err != nil {
		conn.CloseNow()
		s.asr = nil
		return err
	}
	go s.forwardUpstream(conn, "asr", turnID, 0)
	return nil
}

func (s *voiceSession) commitASR(turnID int64) {
	s.mu.Lock()
	conn := s.asr
	s.asrTurnID = turnID
	s.mu.Unlock()
	if conn == nil {
		return
	}
	s.mu.Lock()
	taskID := s.asrTaskID
	s.mu.Unlock()
	_ = conn.Write(s.ctx, websocket.MessageText, mustJSON(map[string]any{"header": map[string]any{"action": "finish-task", "task_id": taskID, "streaming": "duplex"}, "payload": map[string]any{"input": map[string]any{}}}))
}

func (s *voiceSession) startTTS(turnID int64, text string) error {
	if text == "" || s.app.config.Speech.TTSAPIKey == "" {
		return errInvalidVoiceMessage
	}
	s.cancelTTS(turnID)
	dialContext, cancel := context.WithTimeout(s.ctx, 8*time.Second)
	defer cancel()
	conn, response, err := websocket.Dial(dialContext, realtimeTTSEndpoint(s.app.config.Speech.Endpoint, s.app.config.Speech.TTSModel), &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + s.app.config.Speech.TTSAPIKey}}})
	if err != nil {
		return wrapSpeechDialError(response, err)
	}
	s.mu.Lock()
	s.tts = conn
	generation := s.ttsGeneration
	s.mu.Unlock()
	voice := s.app.config.Speech.TTSVoice
	setup := map[string]any{"type": "session.update", "session": map[string]any{"voice": voice, "response_format": "pcm", "sample_rate": 24000, "mode": "server_commit"}}
	if err := conn.Write(s.ctx, websocket.MessageText, mustJSON(setup)); err != nil {
		conn.CloseNow()
		return err
	}
	_ = conn.Write(s.ctx, websocket.MessageText, mustJSON(map[string]any{"type": "input_text_buffer.append", "text": text}))
	_ = conn.Write(s.ctx, websocket.MessageText, mustJSON(map[string]string{"type": "input_text_buffer.commit"}))
	go s.forwardUpstream(conn, "tts", turnID, generation)
	return nil
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

func (s *voiceSession) cancelTTS(_ int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ttsGeneration++
	if s.tts != nil {
		_ = s.tts.Close(websocket.StatusNormalClosure, "cancelled")
		s.tts = nil
	}
}

func (s *voiceSession) forwardUpstream(conn *websocket.Conn, mode string, turnID int64, generation uint64) {
	for {
		typ, raw, err := conn.Read(s.ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			continue
		}
		if mode == "tts" {
			if !s.ttsEventCurrent(conn, generation) {
				return
			}
			event, err := providers.ParseTTSEvent(raw)
			if err != nil {
				continue
			}
			if event.Kind == "audio" {
				s.send(newVoiceServerEvent("tts-audio", s.sessionID, turnID, &voiceServerEvent{Data: event.Data, SampleRate: 24000}))
			}
			if event.Kind == "done" {
				s.send(newVoiceServerEvent("tts-complete", s.sessionID, turnID, nil))
				return
			}
		}
		if mode == "asr" {
			turnID = s.currentASRTurn()
			event, err := providers.ParseASREvent(raw)
			if err != nil || event.Kind != "transcript" {
				continue
			}
			typeName := "transcript-delta"
			if event.Final {
				typeName = "transcript-final"
			}
			s.send(newVoiceServerEvent(typeName, s.sessionID, turnID, &voiceServerEvent{Text: event.Text}))
		}
	}
}

func (s *voiceSession) ttsEventCurrent(conn *websocket.Conn, generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tts == conn && s.ttsGeneration == generation
}

func (s *voiceSession) currentASRTurn() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.asrTurnID
}

func (s *voiceSession) send(event voiceServerEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.browser.Write(s.ctx, websocket.MessageText, mustJSON(event))
}

func (s *voiceSession) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.asr != nil {
		_ = s.asr.Close(websocket.StatusNormalClosure, "done")
		s.asr = nil
	}
	if s.tts != nil {
		_ = s.tts.Close(websocket.StatusNormalClosure, "done")
		s.tts = nil
	}
}
