import { APIError, api } from "../../api";
import type { Conversation, ConversationStore } from "../../pi";
import type { Answer } from "../../domain/learning";

type Pending = {
  action: object;
  resolve: (value: unknown) => void;
  reject: (error: APIError) => void;
};

type ServerMessage = {
  type: "snapshot" | "sync" | "response" | "error";
  requestId?: string;
  state?: Conversation;
  data?: unknown;
  status?: number;
  error?: string;
};

export class ConversationChannel implements ConversationStore {
  private socket: WebSocket | null = null;
  private connecting: Promise<Conversation> | null = null;
  private latest: Conversation | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(state: Conversation) => void>();
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  subscribe(listener: (state: Conversation) => void) {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }

  claim(correction?: { correctionText: string; revision: number }) {
    return this.action<{ runId: string }>({ action: "claim", ...correction });
  }

  answer(toolCallId: string, answer: Answer) {
    return this.action<Conversation>({ action: "answer", toolCallId, answer });
  }

  endCorrection() {
    return this.action<Conversation>({ action: "end_correction" });
  }

  release(runId: string) {
    return this.action({ action: "release", runId });
  }

  heartbeat(runId: string) {
    return this.action({ action: "heartbeat", runId });
  }

  saveMessage(runId: string, message: Conversation["messages"][number]) {
    return this.action({ action: "message", runId, message });
  }

  executeTool(runId: string, toolCallId: string) {
    return this.action<Awaited<ReturnType<ConversationStore["executeTool"]>>>({
      action: "tool",
      runId,
      toolCallId,
    });
  }

  recordToolError(runId: string, toolCallId: string) {
    return this.action({ action: "tool_error", runId, toolCallId });
  }

  open(): Promise<Conversation> {
    if (this.latest && this.socket?.readyState === WebSocket.OPEN)
      return Promise.resolve(this.latest);
    if (!this.connecting) this.connecting = this.connect();
    return this.connecting;
  }

  current(): Promise<Conversation> {
    return this.latest ? Promise.resolve(this.latest) : this.open();
  }

  waitForChange(revision: number): Promise<Conversation> {
    if (this.latest && this.latest.revision > revision)
      return Promise.resolve(this.latest);
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((state) => {
        if (state.revision > revision) {
          unsubscribe();
          resolve(state);
        }
      });
    });
  }

  private action<T>(action: object): Promise<T> {
    if (this.socket?.readyState === WebSocket.OPEN)
      return this.enqueue<T>(action);
    return this.open().then(() => this.enqueue<T>(action));
  }

  private enqueue<T>(action: object): Promise<T> {
    if (this.stopped) throw new APIError(0, "会话已离开");
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        action,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.send(requestId, action);
    });
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close(1000, "view closed");
    this.socket = null;
    for (const request of this.pending.values())
      request.reject(new APIError(0, "会话已离开"));
    this.pending.clear();
  }

  private async connect(): Promise<Conversation> {
    try {
      const { ticket } = await api<{ ticket: string }>(
        "/learning/socket-ticket",
        "POST",
        {},
      );
      if (this.stopped) throw new APIError(0, "会话已离开");
      const origin = new URL(__ZHIYA_CLIENT_CONFIG__.apiOrigin);
      origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
      origin.pathname = "/api/learning/socket";
      origin.searchParams.set("ticket", ticket);
      const socket = new WebSocket(origin);
      this.socket = socket;
      return await new Promise<Conversation>((resolve, reject) => {
        let opened = false;
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as ServerMessage;
            const state = this.receive(message);
            if (!opened && state) {
              opened = true;
              for (const [id, request] of this.pending)
                this.send(id, request.action);
              resolve(state);
            }
          } catch {
            socket.close(1002, "invalid server message");
          }
        };
        socket.onerror = () => {
          if (!opened)
            reject(new APIError(0, "暂时无法连接，请检查网络后重试"));
        };
        socket.onclose = () => {
          if (!opened) reject(new APIError(0, "暂时无法同步，请重试"));
          if (this.socket === socket) this.socket = null;
          this.connecting = null;
          if (!this.stopped)
            this.retry = setTimeout(
              () => void this.open().catch(() => {}),
              1000,
            );
        };
      });
    } finally {
      this.connecting = null;
    }
  }

  private receive(message: ServerMessage): Conversation | null {
    if (message.type === "snapshot" && message.state) {
      this.update(message.state);
      return message.state;
    }
    if (message.type === "sync" && message.state) {
      this.merge(message.state);
      return this.latest;
    }
    if (
      (message.type === "response" || message.type === "error") &&
      message.requestId
    ) {
      const request = this.pending.get(message.requestId);
      if (!request) return this.latest;
      this.pending.delete(message.requestId);
      if (message.state) this.merge(message.state);
      if (message.type === "response")
        request.resolve(message.data ?? this.latest);
      else
        request.reject(
          new APIError(
            message.status ?? 500,
            message.error ?? "操作失败，请重试",
            message.requestId,
          ),
        );
    }
    return this.latest;
  }

  private update(state: Conversation) {
    this.latest = state;
    for (const listener of this.listeners) listener(state);
  }

  private merge(state: Conversation) {
    if (!this.latest || state.revision <= this.latest.revision) return;
    const expected = state.messageSequence - this.latest.messageSequence;
    if (expected !== state.messages.length || expected < 0) {
      this.socket?.close(1008, "message gap");
      return;
    }
    this.update({
      ...state,
      messages: [...this.latest.messages, ...state.messages],
    });
  }

  private send(requestId: string, action: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "action", requestId, action }));
  }
}
