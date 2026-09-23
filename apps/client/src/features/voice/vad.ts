export type VadConfig = {
  threshold: number;
  minSpeechFrames: number;
  endSilenceFrames: number;
  speechFrames: number;
  silenceFrames: number;
};

export type VadResult = {
  kind: "speech" | "silence" | "speech-start" | "speech-end";
  level: number;
  speechFrames: number;
  silenceFrames: number;
};

export function detectVoiceFrame(samples: Float32Array, config: VadConfig): VadResult {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const level = samples.length ? Math.sqrt(energy / samples.length) : 0;
  const speaking = level >= config.threshold;
  const speechFrames = speaking ? config.speechFrames + 1 : 0;
  const silenceFrames = speaking ? 0 : config.silenceFrames + 1;
  if (speaking && speechFrames === config.minSpeechFrames) {
    return { kind: "speech-start", level, speechFrames, silenceFrames };
  }
  if (!speaking && config.speechFrames >= config.minSpeechFrames && silenceFrames >= config.endSilenceFrames) {
    return { kind: "speech-end", level, speechFrames, silenceFrames };
  }
  return { kind: speaking ? "speech" : "silence", level, speechFrames, silenceFrames };
}
