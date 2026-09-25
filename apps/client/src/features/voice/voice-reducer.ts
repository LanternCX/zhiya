import type { VoiceErrorKind, VoiceState } from "./types";

export const initialVoiceState: VoiceState = { status: "idle", sessionId: null, turnId: 0, transcript: "", assistantText: "", error: null, errorKind: null, inputLevel: 0 };

export type VoiceAction =
  | { type: "connect"; sessionId: string }
  | { type: "ready" }
  | { type: "speech-started" }
  | { type: "level"; value: number }
  | { type: "commit" }
  | { type: "transcript"; turnId: number; text: string; final: boolean }
  | { type: "thinking" }
  | { type: "speaking" }
  | { type: "tts-error"; message: string; kind?: "tts" | "playback" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "error"; message: string; kind?: VoiceErrorKind }
  | { type: "end" };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "connect": return { ...initialVoiceState, status: "connecting", sessionId: action.sessionId };
    case "ready": return { ...state, status: "listening", error: null, errorKind: null };
    case "speech-started": return { ...state, status: "listening" };
    case "level": return { ...state, inputLevel: Math.max(0, Math.min(1, action.value)) };
    case "commit": return { ...state, status: "committing", transcript: "" };
    case "transcript":
      if (action.turnId !== state.turnId) return state;
      return { ...state, transcript: action.text, status: action.final ? "thinking" : "committing" };
    case "thinking": return { ...state, status: "thinking" };
    case "speaking": return { ...state, status: "speaking" };
    case "tts-error": return { ...state, status: state.status === "speaking" ? "listening" : state.status, error: action.message, errorKind: action.kind ?? "tts" };
    case "mute": return { ...state, status: "muted" };
    case "unmute": return { ...state, status: "listening" };
    case "error": return { ...state, status: "ended", error: action.message, errorKind: action.kind ?? "connection" };
    case "end": return { ...state, status: "ended" };
  }
}
