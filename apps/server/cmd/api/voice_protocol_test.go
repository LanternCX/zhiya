package main

import "testing"

func TestDecodeVoiceClientMessage(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
		bad  bool
	}{
		{name: "start", raw: `{"type":"start-session","sessionId":"s1","turnId":0}`, want: "start-session"},
		{name: "audio", raw: `{"type":"audio","sessionId":"s1","turnId":1}`, want: "audio"},
		{name: "commit", raw: `{"type":"commit-turn","sessionId":"s1","turnId":1}`, want: "commit-turn"},
		{name: "cancel", raw: `{"type":"cancel-tts","sessionId":"s1","turnId":2}`, want: "cancel-tts"},
		{name: "end", raw: `{"type":"end-session","sessionId":"s1","turnId":2}`, want: "end-session"},
		{name: "missing session", raw: `{"type":"commit-turn","turnId":1}`, bad: true},
		{name: "negative turn", raw: `{"type":"commit-turn","sessionId":"s1","turnId":-1}`, bad: true},
		{name: "unsupported", raw: `{"type":"explode","sessionId":"s1","turnId":1}`, bad: true},
		{name: "oversized text", raw: `{"type":"commit-turn","sessionId":"s1","turnId":1,"text":"` + string(make([]byte, 8193)) + `"}`, bad: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := decodeVoiceClientMessage([]byte(tt.raw))
			if tt.bad {
				if err == nil {
					t.Fatalf("expected error, got %#v", msg)
				}
				return
			}
			if err != nil {
				t.Fatalf("decode failed: %v", err)
			}
			if msg.Type != tt.want {
				t.Fatalf("type = %q, want %q", msg.Type, tt.want)
			}
		})
	}
}

func TestVoiceServerEventScope(t *testing.T) {
	event := newVoiceServerEvent("session-ready", "s1", 0, nil)
	if event.SessionID != "s1" || event.TurnID != 0 || event.Type != "session-ready" {
		t.Fatalf("unexpected event: %#v", event)
	}
}
