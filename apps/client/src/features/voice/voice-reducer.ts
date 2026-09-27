import type { VoiceErrorKind, VoiceState } from "./types";

export const initialVoiceState: VoiceState = { status: "idle", sessionId: null, turnId: 0, error: null, errorKind: null };

export type VoiceAction =
  | { type: "connect"; sessionId: string }
  | { type: "ready" }
  | { type: "agent-error"; message: string }
  | { type: "speaking" }
  | { type: "interrupted" }
  | { type: "tts-error"; message: string; kind?: "tts" | "playback" }
  | { type: "error"; message: string; kind?: VoiceErrorKind }
  | { type: "end" };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "connect": return { ...initialVoiceState, status: "connecting", sessionId: action.sessionId };
    case "ready": return { ...state, status: "ready", error: null, errorKind: null };
    case "agent-error": return { ...state, status: "ready", error: action.message, errorKind: "agent" };
    case "speaking": return { ...state, status: "speaking" };
    case "interrupted": return { ...state, status: "ready", turnId: state.turnId + 1, error: null, errorKind: null };
    case "tts-error": return { ...state, status: state.status === "speaking" ? "ready" : state.status, error: action.message, errorKind: action.kind ?? "tts" };
    case "error": return { ...state, status: "ended", error: action.message, errorKind: action.kind ?? "connection" };
    case "end": return { ...state, status: "ended" };
  }
}
