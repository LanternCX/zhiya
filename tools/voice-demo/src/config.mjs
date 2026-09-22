const providers = new Set(["mock", "qwen", "volcengine", "tencent"]);
const modes = new Set(["asr", "tts", "roundtrip"]);

export function readConfig(env = process.env) {
  const provider = (env.VOICE_PROVIDER || "mock").toLowerCase();
  const mode = (env.VOICE_MODE || "asr").toLowerCase();
  if (!providers.has(provider)) throw new Error(`Unsupported provider: ${provider}`);
  if (!modes.has(mode)) throw new Error(`Unsupported mode: ${mode}`);
  return {
    provider,
    mode,
    audioPath: env.VOICE_AUDIO || "",
    outputPath: env.VOICE_OUTPUT || "tools/voice-demo/output.wav",
    text: env.VOICE_TEXT || env.VOICE_REFERENCE || "你好，欢迎来到知芽。",
    reference: env.VOICE_REFERENCE || env.VOICE_TEXT || "",
    apiKey: env.VOICE_API_KEY || env.DASHSCOPE_API_KEY || "",
    endpoint: env.VOICE_ENDPOINT || "",
    model: env.VOICE_MODEL || "",
  };
}
