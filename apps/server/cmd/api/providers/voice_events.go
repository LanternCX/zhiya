package providers

import "encoding/json"

// VoiceEvent is the provider-neutral subset of ASR/TTS events consumed by a session.
type VoiceEvent struct {
	Kind  string
	Text  string
	Data  string
	Final bool
}

func ParseTTSEvent(raw []byte) (VoiceEvent, error) {
	var payload struct {
		Type  string `json:"type"`
		Delta string `json:"delta"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return VoiceEvent{}, err
	}
	switch payload.Type {
	case "response.audio.delta":
		if payload.Delta == "" {
			return VoiceEvent{}, nil
		}
		return VoiceEvent{Kind: "audio", Data: payload.Delta}, nil
	case "response.audio.done":
		return VoiceEvent{Kind: "done"}, nil
	default:
		return VoiceEvent{}, nil
	}
}

func ParseASREvent(raw []byte) (VoiceEvent, error) {
	var payload struct {
		Payload struct {
			Output struct {
				Sentence struct {
					Text        string `json:"text"`
					SentenceEnd bool   `json:"sentence_end"`
				} `json:"sentence"`
			} `json:"output"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return VoiceEvent{}, err
	}
	sentence := payload.Payload.Output.Sentence
	if sentence.Text == "" {
		return VoiceEvent{}, nil
	}
	return VoiceEvent{Kind: "transcript", Text: sentence.Text, Final: sentence.SentenceEnd}, nil
}
