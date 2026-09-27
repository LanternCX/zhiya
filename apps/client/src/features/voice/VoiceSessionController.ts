import { PlaybackController } from "./PlaybackController";
import { nextVoiceReconnectDelay } from "./ReconnectPolicy";
import { connectVoiceSession, isVoiceServerEvent } from "../../transport/voice";
import { initialVoiceState, voiceReducer, type VoiceAction } from "./voice-reducer";
import type { VoiceErrorKind, VoiceState } from "./types";

export class VoiceSessionController {
  private socket: WebSocket | null = null;
  private sessionId = crypto.randomUUID();
  private turnId = 0;
  private state: VoiceState = initialVoiceState;
  private readonly listeners = new Set<(state: VoiceState) => void>();
  private readonly playback: PlaybackController;
  private speakerEnabled = true;
  private speechQueue: Array<{ text: string; onProgress: (text: string) => void; onPlayed: () => void }> = [];
  private speechInFlight = false;
  private speechPlaybackComplete: (() => void) | null = null;
  private speechProgress: ((text: string) => void) | null = null;
  private speechText = "";
  private speechAudioSeconds = 0;
  private readonly onInterruptAgent: () => void;
  private sessionReady: Promise<void> | null = null;
  private resolveSessionReady: (() => void) | null = null;
  private rejectSessionReady: ((reason: Error) => void) | null = null;

  constructor(onInterruptAgent: () => void = () => undefined) {
    this.onInterruptAgent = onInterruptAgent;
    this.playback = new PlaybackController(undefined, (error) => this.dispatch({ type: "tts-error", message: error.message, kind: "playback" }));
  }
  subscribe(listener: (state: VoiceState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getState() { return this.state; }
  reportAgentError(message: string) { this.dispatch({ type: "agent-error", message }); }

  async start() {
    this.playback.resume();
    this.dispatch({ type: "connect", sessionId: this.sessionId });
    let socket: WebSocket;
    let lastError: unknown;
    for (let attempt = 0; ; attempt += 1) {
      if (this.getState().status === "ended") throw new Error("语音会话已结束");
      try {
        socket = await connectVoiceSession();
        if (this.getState().status === "ended") {
          socket.close();
          throw new Error("语音会话已结束");
        }
        break;
      } catch (error) {
        lastError = error;
        if (this.getState().status === "ended") throw lastError;
        const delay = nextVoiceReconnectDelay(attempt);
        if (delay === null) throw lastError;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
    this.socket = socket;
    socket.onmessage = (message) => this.handleMessage(message.data);
    socket.onerror = () => this.dispatch({ type: "error", message: "语音连接失败", kind: "connection" });
    socket.onclose = () => this.handleConnectionClosed();
    this.sessionReady = new Promise<void>((resolve, reject) => {
      this.resolveSessionReady = resolve;
      this.rejectSessionReady = reject;
    });
    this.send({ type: "start-session", sessionId: this.sessionId, turnId: this.turnId });
    try {
      await this.sessionReady;
    } catch (error) {
      this.socket?.close();
      this.socket = null;
      throw error;
    } finally {
      this.sessionReady = null;
      this.resolveSessionReady = null;
      this.rejectSessionReady = null;
    }
    this.pumpSpeechQueue();
  }

  speakText(text: string, onPlayed: () => void = () => undefined, onProgress: (text: string) => void = () => undefined) {
    const normalized = text.trim();
    if (!normalized) return;
    this.speechQueue.push({ text: normalized, onProgress, onPlayed });
    this.pumpSpeechQueue();
  }
  setSpeaker(enabled: boolean) { this.speakerEnabled = enabled; if (!enabled) this.stopPlayback(); }
  interrupt() { this.onInterruptAgent(); this.speechQueue = []; this.speechPlaybackComplete = null; this.speechProgress = null; this.speechInFlight = false; this.send({ type: "cancel-tts", sessionId: this.sessionId, turnId: this.turnId }); this.stopPlayback(); this.turnId += 1; this.dispatch({ type: "interrupted" }); }
  end() { this.rejectSessionReady?.(new Error("语音会话已结束")); this.speechQueue = []; this.speechPlaybackComplete = null; this.speechInFlight = false; this.playback.dispose(); this.dispatch({ type: "end" }); this.send({ type: "end-session", sessionId: this.sessionId, turnId: this.turnId }); this.socket?.close(); this.socket = null; }
  handleVisibilityChange(hidden: boolean) { if (hidden) this.end(); }
  handleConnectionClosed() {
    if (this.state.status === "ended") return;
    this.rejectSessionReady?.(new Error("语音连接已断开"));
    this.speechQueue = [];
    this.speechPlaybackComplete = null;
    this.speechInFlight = false;
    this.stopPlayback();
    this.socket = null;
    this.dispatch({ type: "error", message: "语音连接已断开", kind: "connection" });
  }

  private handleMessage(raw: unknown) {
    let value: unknown;
    try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { this.dispatch({ type: "error", message: "语音服务返回了无效消息" }); return; }
    if (!isVoiceServerEvent(value)) return;
    const event = value;
    if (event.sessionId !== this.sessionId || event.turnId < this.turnId) return;
    if (event.type === "session-ready") { this.resolveSessionReady?.(); this.dispatch({ type: "ready" }); }
    if (event.type === "tts-audio") {
      this.dispatch({ type: "speaking" });
      if (this.speakerEnabled && event.data) {
        this.playback.enqueue(event.data, event.sampleRate ?? 24000, (duration) => {
          this.speechAudioSeconds += duration;
          const visibleLength = Math.min(this.speechText.length, Math.ceil(this.speechAudioSeconds / 0.18) + 2);
          this.speechProgress?.(this.speechText.slice(0, visibleLength));
        });
      }
    }
    if (event.type === "tts-complete") {
      const complete = this.speechPlaybackComplete;
      this.speechPlaybackComplete = null;
      if (!this.speakerEnabled) {
        this.speechInFlight = false;
        complete?.();
        this.pumpSpeechQueue();
      } else {
        this.playback.onCurrentAudioComplete(() => {
          this.speechInFlight = false;
          complete?.();
          this.pumpSpeechQueue();
        });
      }
    }
    if (event.type === "session-error") {
      const message = event.message ?? "语音会话失败";
      if (event.code === "tts_unavailable") {
        this.speechInFlight = false;
        this.dispatch({ type: "tts-error", message });
        this.pumpSpeechQueue();
      } else {
        this.rejectSessionReady?.(new Error(message));
        this.dispatch({ type: "error", message, kind: voiceErrorKind(event.code) });
      }
    }
    if (event.type === "session-ended") this.dispatch({ type: "end" });
  }
  private send(value: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private pumpSpeechQueue() {
    if (this.speechInFlight || !this.speechQueue.length || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const item = this.speechQueue.shift();
    if (!item) return;
    this.speechInFlight = true;
    this.speechPlaybackComplete = item.onPlayed;
    this.speechProgress = item.onProgress;
    this.speechText = item.text;
    this.speechAudioSeconds = 0;
    this.send({ type: "speak-text", sessionId: this.sessionId, turnId: this.turnId, text: item.text });
  }
  private dispatch(action: VoiceAction) { this.state = voiceReducer(this.state, action); this.listeners.forEach((listener) => listener(this.state)); }
  private stopPlayback() { this.playback.clear(); this.speechProgress = null; this.speechText = ""; this.speechAudioSeconds = 0; }
}

function voiceErrorKind(code?: string): VoiceErrorKind {
  if (code?.startsWith("tts_")) return "tts";
  if (code?.startsWith("playback_")) return "playback";
  return "connection";
}
