export const voiceReconnectDelays = [250, 1000] as const;

export function nextVoiceReconnectDelay(attempt: number) {
  return voiceReconnectDelays[attempt] ?? null;
}
