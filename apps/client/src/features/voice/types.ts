export type VoiceStatus = "idle" | "connecting" | "ready" | "speaking" | "ended";
export type VoiceErrorKind = "connection" | "agent" | "tts" | "playback";

export type VoiceState = {
  status: VoiceStatus;
  sessionId: string | null;
  turnId: number;
  error: string | null;
  errorKind: VoiceErrorKind | null;
};
