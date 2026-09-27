import { api } from "../api";

export type VoiceServerEvent = {
  type:
    | "session-ready"
    | "tts-audio"
    | "tts-complete"
    | "session-error"
    | "session-ended";
  sessionId: string;
  turnId: number;
  data?: string;
  code?: string;
  message?: string;
  sampleRate?: number;
};

const serverEventTypes = new Set<VoiceServerEvent["type"]>([
  "session-ready",
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
    (event.data === undefined || typeof event.data === "string") &&
    (event.sampleRate === undefined || (Number.isInteger(event.sampleRate) && event.sampleRate > 0))
  );
}

export async function speechSocketURL(path: "/api/voice/session" | "/api/speech/stream"): Promise<URL> {
  const { ticket } = await api<{ ticket: string }>("/socket-ticket", "POST", {});
  const url = new URL(__ZHIYA_CLIENT_CONFIG__.apiOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.searchParams.set("ticket", ticket);
  return url;
}

export async function connectVoiceSession(): Promise<WebSocket> {
  const url = await speechSocketURL("/api/voice/session");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error("语音连接超时，请检查后端服务和 TTS API Key"));
    }, 10_000);
    socket.onopen = () => { window.clearTimeout(timeout); resolve(socket); };
    socket.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("语音连接失败，请检查后端服务和 TTS API Key"));
    }, { once: true });
  });
}
