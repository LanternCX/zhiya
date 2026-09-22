export function createMockProvider({ transcript = "你好，欢迎来到知芽。", audioDurationMs = 320 } = {}) {
  return {
    async transcribe() {
      return {
        text: transcript,
        packets: [{ text: transcript.slice(0, 2) }, { text: transcript }],
      };
    },
    async synthesize() {
      return { audio: Buffer.alloc(audioDurationMs), sampleRate: 16000 };
    },
  };
}
