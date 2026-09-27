package speech

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/coder/websocket"
)

// session owns one browser socket and the active upstream TTS socket.
type session struct {
	settings  config.Speech
	browser   *websocket.Conn
	ctx       context.Context
	sessionID string

	mu            sync.Mutex
	tts           *websocket.Conn
	ttsGeneration uint64
}

const voiceSessionTimeout = 30 * time.Minute

func voiceSessionContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, timeout)
}

func RunSession(ctx context.Context, browser *websocket.Conn, settings config.Speech) {
	sessionContext, cancel := voiceSessionContext(ctx, voiceSessionTimeout)
	defer cancel()
	current := &session{settings: settings, browser: browser, ctx: sessionContext}
	current.run()
}

type Registry struct {
	mu     sync.Mutex
	active map[string]struct{}
}

func (r *Registry) Acquire(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active == nil {
		r.active = make(map[string]struct{})
	}
	if _, exists := r.active[userID]; exists {
		return false
	}
	r.active[userID] = struct{}{}
	return true
}

func (r *Registry) Release(userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.active, userID)
}

func (s *session) run() {
	defer s.close()
	for {
		typ, raw, err := s.browser.Read(s.ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
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
			s.send(newVoiceServerEvent("session-ready", s.sessionID, msg.TurnID, nil))
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
		case "end-session":
			s.send(newVoiceServerEvent("session-ended", s.sessionID, msg.TurnID, nil))
			return
		}
	}
}

func (s *session) startTTS(turnID int64, text string) error {
	if text == "" || s.settings.TTSAPIKey == "" {
		return errInvalidVoiceMessage
	}
	s.cancelTTS(turnID)
	dialContext, cancel := context.WithTimeout(s.ctx, 8*time.Second)
	defer cancel()
	conn, err := dialTTS(dialContext, s.settings)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.tts = conn
	generation := s.ttsGeneration
	s.mu.Unlock()
	if err := startTTS(s.ctx, conn, s.settings.TTSVoice, text); err != nil {
		conn.CloseNow()
		s.mu.Lock()
		if s.tts == conn {
			s.tts = nil
		}
		s.mu.Unlock()
		return err
	}
	go s.forwardTTS(conn, turnID, generation)
	return nil
}

func (s *session) cancelTTS(_ int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ttsGeneration++
	if s.tts != nil {
		_ = s.tts.Close(websocket.StatusNormalClosure, "cancelled")
		s.tts = nil
	}
}

func (s *session) forwardTTS(conn *websocket.Conn, turnID int64, generation uint64) {
	for {
		typ, raw, err := conn.Read(s.ctx)
		if err != nil {
			if s.ttsEventCurrent(conn, generation) && s.ctx.Err() == nil {
				s.send(newVoiceServerEvent("session-error", s.sessionID, turnID, &voiceServerEvent{Code: "tts_upstream", Message: fmt.Sprintf("TTS 上游连接已断开：%v", err)}))
			}
			return
		}
		if typ == websocket.MessageBinary {
			continue
		}
		if !s.ttsEventCurrent(conn, generation) {
			return
		}
		event, err := ParseTTSEvent(raw)
		if err != nil {
			continue
		}
		if event.Kind == "error" {
			s.send(newVoiceServerEvent("session-error", s.sessionID, turnID, &voiceServerEvent{Code: "tts_upstream", Message: event.Data}))
			return
		}
		if event.Kind == "audio" {
			s.send(newVoiceServerEvent("tts-audio", s.sessionID, turnID, &voiceServerEvent{Data: event.Data, SampleRate: 24000}))
		}
		if event.Kind == "done" {
			s.send(newVoiceServerEvent("tts-complete", s.sessionID, turnID, nil))
			return
		}
	}
}

func (s *session) ttsEventCurrent(conn *websocket.Conn, generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tts == conn && s.ttsGeneration == generation
}

func (s *session) send(event voiceServerEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.browser.Write(s.ctx, websocket.MessageText, mustJSON(event))
}

func (s *session) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tts != nil {
		_ = s.tts.Close(websocket.StatusNormalClosure, "done")
		s.tts = nil
	}
}
