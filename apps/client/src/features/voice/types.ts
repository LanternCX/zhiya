export type VoiceStatus = "idle" | "connecting" | "listening" | "committing" | "thinking" | "speaking" | "muted" | "recovering" | "ended";

export type VoiceState = {
  status: VoiceStatus;
  sessionId: string | null;
  turnId: number;
  transcript: string;
  assistantText: string;
  error: string | null;
};
