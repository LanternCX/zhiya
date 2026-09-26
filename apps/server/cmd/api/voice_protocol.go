package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

const maxVoiceControlBytes = 4096

var errInvalidVoiceMessage = errors.New("invalid voice control message")

type voiceClientMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	TurnID    int64  `json:"turnId"`
	Capture   bool   `json:"capture,omitempty"`
	Text      string `json:"text,omitempty"`
}

type voiceServerEvent struct {
	Type       string `json:"type"`
	SessionID  string `json:"sessionId"`
	TurnID     int64  `json:"turnId"`
	Text       string `json:"text,omitempty"`
	Data       string `json:"data,omitempty"`
	Code       string `json:"code,omitempty"`
	Message    string `json:"message,omitempty"`
	SampleRate int    `json:"sampleRate,omitempty"`
}

func decodeVoiceClientMessage(raw []byte) (voiceClientMessage, error) {
	var msg voiceClientMessage
	if len(raw) == 0 || len(raw) > maxVoiceControlBytes {
		return msg, errInvalidVoiceMessage
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&msg); err != nil {
		return voiceClientMessage{}, errInvalidVoiceMessage
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return voiceClientMessage{}, errInvalidVoiceMessage
	}
	if msg.SessionID == "" || len(msg.SessionID) > 128 || strings.TrimSpace(msg.SessionID) != msg.SessionID || msg.TurnID < 0 {
		return voiceClientMessage{}, errInvalidVoiceMessage
	}
	switch msg.Type {
	case "start-session", "audio", "commit-turn", "cancel-tts", "speak-text", "mute", "unmute", "end-session":
	default:
		return voiceClientMessage{}, errInvalidVoiceMessage
	}
	if len(msg.Text) > 8192 {
		return voiceClientMessage{}, errInvalidVoiceMessage
	}
	return msg, nil
}

func newVoiceServerEvent(eventType, sessionID string, turnID int64, detail *voiceServerEvent) voiceServerEvent {
	event := voiceServerEvent{Type: eventType, SessionID: sessionID, TurnID: turnID}
	if detail != nil {
		event.Text = detail.Text
		event.Data = detail.Data
		event.Code = detail.Code
		event.Message = detail.Message
		event.SampleRate = detail.SampleRate
	}
	return event
}
