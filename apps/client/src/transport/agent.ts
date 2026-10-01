import { api, APIError } from "../api";

export type SyncStatus = "connecting" | "live" | "reconnecting";
export type AgentStatus = {
  id: string;
  kind: string;
  courseId: string;
  conversationId: string;
  running: boolean;
};

export type ConversationSummary = {
  id: string;
  courseId: string;
  sectionId: string;
  title: string;
  updatedAt: string;
};

export function subscribeAgentStatuses(
  receive: (
    sessions: AgentStatus[],
    conversations?: ConversationSummary[],
  ) => void,
) {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    const again = () => {
      if (!stopped) retry = setTimeout(() => void connect(), 1000);
    };
    try {
      const { ticket } = await api<{ ticket: string }>(
        "/socket-ticket",
        "POST",
        {},
      );
      if (stopped) return;
      const url = new URL(__ZHIYA_CLIENT_CONFIG__.apiOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/api/agent/socket";
      url.searchParams.set("ticket", ticket);
      socket = new WebSocket(url);
      const current = socket;
      current.onmessage = (event) => {
        if (stopped) return;
        try {
          const snapshot = JSON.parse(String(event.data));
          receive(snapshot.sessions, snapshot.conversations);
        } catch {
          current.close(1002, "invalid statuses");
        }
      };
      current.onclose = again;
      current.onerror = () => current.close();
    } catch {
      again();
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}

export type AgentSnapshot<T> = {
  id: string;
  revision: number;
  state: T & { commands?: Record<string, { status: string; error?: string }> };
};

/** Closing a view subscription never cancels an execution. */
export class AgentConnection<T> {
  private socket?: WebSocket;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private latest?: AgentSnapshot<T>;
  private pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private opening?: Promise<AgentSnapshot<T>>;
  constructor(
    private input: { kind: string; courseId?: string; conversationId?: string },
    private receive: (state: T) => void,
    private failure: (error: string) => void,
    private sync?: (status: SyncStatus) => void,
    lazy = false,
  ) {
    if (!lazy) void this.ready;
  }
  get ready(): Promise<AgentSnapshot<T>> {
    if (this.opening) return this.opening;
    this.opening = api<AgentSnapshot<T>>(
      "/agent/sessions",
      "POST",
      this.input,
    ).then((snapshot) => {
      this.update(snapshot);
      void this.connect(snapshot.id);
      return snapshot;
    });
    void this.opening.catch((error) => {
      if (!this.stopped) this.failure(error.message);
    });
    return this.opening;
  }
  private update(snapshot: AgentSnapshot<T>) {
    if (
      this.stopped ||
      (this.latest && snapshot.revision <= this.latest.revision)
    )
      return;
    this.latest = snapshot;
    this.receive(snapshot.state);
    for (const [id, waiting] of this.pending) {
      const receipt = snapshot.state.commands?.[id];
      if (!receipt || receipt.status === "running") continue;
      this.pending.delete(id);
      if (receipt.status === "failed")
        waiting.reject(new Error(receipt.error ?? "执行失败"));
      else waiting.resolve();
    }
  }
  async command(action: string, args: unknown[] = []) {
    if (this.stopped) return;
    const { id } = await this.ready;
    const requestId = crypto.randomUUID();
    if (this.stopped) {
      await api(`/agent/sessions/${id}/commands`, "POST", {
        requestId,
        action,
        args,
      });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const send = async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            await api(`/agent/sessions/${id}/commands`, "POST", {
              requestId,
              action,
              args,
            });
            return;
          } catch (error) {
            if (!this.stopped && !this.pending.has(requestId)) return;
            if (
              attempt >= 2 ||
              !(error instanceof APIError) ||
              (error.status !== 0 && error.status < 500)
            ) {
              this.pending.delete(requestId);
              reject(error);
              return;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * (attempt + 1)),
            );
          }
        }
      };
      void send();
    });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
    for (const waiting of this.pending.values()) waiting.resolve();
    this.pending.clear();
  }
  private async connect(id: string) {
    if (this.stopped) return;
    const again = () => {
      if (!this.stopped) {
        this.sync?.("reconnecting");
        this.retry = setTimeout(() => void this.connect(id), 1000);
      }
    };
    try {
      const { ticket } = await api<{ ticket: string }>(
        "/socket-ticket",
        "POST",
        {},
      );
      if (this.stopped) return;
      const url = new URL(__ZHIYA_CLIENT_CONFIG__.apiOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = `/api/agent/sessions/${id}/socket`;
      url.searchParams.set("ticket", ticket);
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onmessage = (event) => {
        try {
          this.update(JSON.parse(String(event.data)));
          if (!this.stopped) this.sync?.("live");
        } catch {
          socket.close(1002, "invalid snapshot");
        }
      };
      socket.onclose = again;
      socket.onerror = () => socket.close();
    } catch (error) {
      if (!this.stopped)
        this.failure(
          error instanceof APIError ? error.message : "暂时无法同步",
        );
      again();
    }
  }
}
