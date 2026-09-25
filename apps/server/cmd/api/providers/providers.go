package providers

type ASRProvider interface {
	Parse(raw []byte) (VoiceEvent, error)
}

type TTSProvider interface {
	Parse(raw []byte) (VoiceEvent, error)
}

type QwenASR struct{}

func (QwenASR) Parse(raw []byte) (VoiceEvent, error) {
	return ParseASREvent(raw)
}

type QwenTTS struct{}

func (QwenTTS) Parse(raw []byte) (VoiceEvent, error) {
	return ParseTTSEvent(raw)
}
