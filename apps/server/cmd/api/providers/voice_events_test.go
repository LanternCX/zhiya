package providers

import "testing"

func TestParseTTSEvent(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		kind string
		data string
	}{
		{name: "audio delta", raw: `{"type":"response.audio.delta","delta":"AQI="}`, kind: "audio", data: "AQI="},
		{name: "audio done", raw: `{"type":"response.audio.done"}`, kind: "done"},
		{name: "response done", raw: `{"type":"response.done"}`, kind: "done"},
		{name: "provider error", raw: `{"type":"error","error":{"message":"quota exceeded"}}`, kind: "error", data: "quota exceeded"},
		{name: "unknown event", raw: `{"type":"response.created"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event, err := ParseTTSEvent([]byte(tt.raw))
			if err != nil {
				t.Fatalf("parse failed: %v", err)
			}
			if event.Kind != tt.kind || event.Data != tt.data {
				t.Fatalf("event = %#v, want kind %q data %q", event, tt.kind, tt.data)
			}
		})
	}
}

func TestParseASREventRejectsMalformedJSON(t *testing.T) {
	if _, err := ParseASREvent([]byte("{")); err == nil {
		t.Fatal("expected malformed JSON to fail")
	}
}

func TestParseASREventReadsSentence(t *testing.T) {
	event, err := ParseASREvent([]byte(`{"payload":{"output":{"sentence":{"text":"你好","sentence_end":true}}}}`))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if event.Kind != "transcript" || event.Text != "你好" || !event.Final {
		t.Fatalf("event = %#v", event)
	}
}

func TestParseASREventReadsProviderError(t *testing.T) {
	event, err := ParseASREvent([]byte(`{"header":{"event":"task-failed","status_message":"upstream failed"}}`))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if event.Kind != "error" || event.Data != "upstream failed" {
		t.Fatalf("event = %#v", event)
	}
}
