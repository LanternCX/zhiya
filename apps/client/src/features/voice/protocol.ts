export type VoiceClientMessageType =
  | "start-session"
  | "audio"
  | "commit-turn"
  | "cancel-tts"
  | "speak-text"
  | "mute"
  | "unmute"
  | "end-session";

export type VoiceClientMessage = {
  type: VoiceClientMessageType;
  sessionId: string;
  turnId: number;
};

export type VoiceServerEvent = {
  type:
    | "session-ready"
    | "speech-started"
    | "transcript-delta"
    | "transcript-final"
    | "tts-audio"
    | "tts-complete"
    | "session-error"
    | "session-ended";
  sessionId: string;
  turnId: number;
  text?: string;
  data?: string;
  code?: string;
  message?: string;
  sampleRate?: number;
};

const serverEventTypes = new Set<VoiceServerEvent["type"]>([
  "session-ready",
  "speech-started",
  "transcript-delta",
  "transcript-final",
  "tts-audio",
  "tts-complete",
  "session-error",
  "session-ended",
]);

export function isVoiceServerEvent(value: unknown): value is VoiceServerEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<VoiceServerEvent>;
  const turnId = event.turnId;
  return (
    typeof event.type === "string" &&
    serverEventTypes.has(event.type as VoiceServerEvent["type"]) &&
    typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    typeof turnId === "number" &&
    Number.isSafeInteger(turnId) &&
    turnId >= 0 &&
    (event.text === undefined || typeof event.text === "string") &&
    (event.data === undefined || typeof event.data === "string") &&
    (event.sampleRate === undefined || (Number.isInteger(event.sampleRate) && event.sampleRate > 0))
  );
}
