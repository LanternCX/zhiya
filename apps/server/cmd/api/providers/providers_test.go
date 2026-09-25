package providers

import "testing"

func TestQwenProvidersImplementVoiceProviderInterfaces(t *testing.T) {
	var asr ASRProvider = QwenASR{}
	var tts TTSProvider = QwenTTS{}
	if event, err := asr.Parse([]byte(`{"payload":{"output":{"sentence":{"text":"你好","sentence_end":true}}}}`)); err != nil || event.Kind != "transcript" || !event.Final {
		t.Fatalf("ASR provider returned %#v, %v", event, err)
	}
	if event, err := tts.Parse([]byte(`{"type":"response.audio.done"}`)); err != nil || event.Kind != "done" {
		t.Fatalf("TTS provider returned %#v, %v", event, err)
	}
}
