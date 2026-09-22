export function createVolcProvider({ endpoint = "", apiKey = "" } = {}) {
  return {
    async transcribe() {
      throw new Error("Volcengine ASR adapter needs VOICE_VOLC_ASR_ENDPOINT and account-specific resource headers; use mock or Qwen until those are configured.");
    },
    async synthesize() {
      throw new Error(`Volcengine TTS adapter is intentionally gated until the account endpoint is configured${endpoint || apiKey ? " correctly" : ""}.`);
    },
  };
}
