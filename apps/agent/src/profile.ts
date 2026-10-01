import { ProfileSession } from "../../../packages/learning/src/pi/sessions/profile";
import type {
  Conversation,
  ConversationStore,
} from "../../../packages/learning/src/pi/contracts";
import type { ModelInfo } from "../../../packages/learning/src/domain/learning";
import { ToolAPI } from "./api";

import type { ProfileProjection } from "../../../packages/learning/src/domain/agent";
export type { ProfileProjection } from "../../../packages/learning/src/domain/agent";

export class ProfileHost {
  get running() {
    return this.state.busy;
  }
  private session?: ProfileSession;
  private timer?: ReturnType<typeof setTimeout>;
  private saving = Promise.resolve();
  private stopped = false;
  private waiting?: AbortController;
  private finished: Promise<void> = Promise.resolve();
  constructor(
    readonly api: ToolAPI,
    private info: ModelInfo,
    readonly state: ProfileProjection,
  ) {}
  private changed() {
    if (this.stopped) return;
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => this.stop());
      }, 50);
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const snapshot = structuredClone(this.state);
    this.saving = this.saving
      .then(() =>
        this.api.json(`/sessions/${this.api.id}/state`, "POST", snapshot),
      )
      .then(() => {});
    await this.saving;
  }
  async command(action: string, args: unknown[]) {
    if (action === "attach") return;
    if (action === "stop" || action === "endCorrection") {
      this.session?.stop();
      this.waiting?.abort();
      await this.finished;
      if (action === "endCorrection") {
        const response = await this.api.json<{ state: Conversation }>(
          "/learning/action",
          "POST",
          {
            requestId: crypto.randomUUID(),
            action: { action: "end_correction" },
          },
        );
        this.state.conversation = response.state;
        this.state.error = "";
        this.state.output = undefined;
        await this.flush();
      }
      return;
    }
    if (action !== "run") throw new Error("未知建档操作");
    if (this.state.busy) return;
    let finish!: () => void;
    this.finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.state.busy = true;
    this.state.error = "";
    this.changed();
    let operations = Promise.resolve();
    const apply = <T>(action: object): Promise<T> => {
      const result = operations.then(() =>
        this.api.json<{ state: Conversation; data: T }>(
          "/learning/action",
          "POST",
          { requestId: crypto.randomUUID(), action },
        ),
      );
      operations = result.then(
        (response) => {
          this.state.conversation = response.state;
          this.changed();
        },
        () => {},
      );
      return result.then((response) => response.data);
    };
    const current = async () => {
      await operations;
      const state = await this.api.json<Conversation>("/learning");
      if (state.revision !== this.state.conversation.revision) {
        this.state.conversation = state;
        this.changed();
      }
      return state;
    };
    const store: ConversationStore = {
      open: current,
      current,
      waitForChange: async (revision) => {
        const controller = new AbortController();
        this.waiting = controller;
        try {
          while (!this.stopped && !this.session?.isStopped) {
            const state = (await (
              await this.api.request(
                `/learning?after=${revision}`,
                "GET",
                undefined,
                controller.signal,
              )
            ).json()) as Conversation;
            if (state.revision > revision) return state;
          }
          throw new Error("执行已停止");
        } finally {
          if (this.waiting === controller) this.waiting = undefined;
        }
      },
      claim: (correction) => apply({ action: "claim", ...correction }),
      release: (runId) => apply({ action: "release", runId }),
      heartbeat: (runId) => apply({ action: "heartbeat", runId }),
      saveMessage: (runId, message) =>
        apply({ action: "message", runId, message }),
      executeTool: (runId, toolCallId) =>
        apply({ action: "tool", runId, toolCallId }),
      recordToolError: (runId, toolCallId) =>
        apply({ action: "tool_error", runId, toolCallId }),
    };
    this.session = new ProfileSession(
      {
        onboarding: async (runId, payload, signal, onRetry) => {
          await operations;
          return this.api.model(
            "/learning/model",
            { runId, payload },
            signal,
            onRetry,
          );
        },
        course: (agent, payload, signal, onRetry) =>
          this.api.model("/course/model", { agent, payload }, signal, onRetry),
      },
      this.info,
      store,
      (conversation) => {
        this.state.conversation = conversation;
        this.changed();
      },
      (output) => {
        this.state.output = output;
        this.changed();
      },
      (retry) => {
        this.state.retry = retry;
        this.changed();
      },
    );
    try {
      await this.session.run(args[0] as string | undefined);
      await operations;
    } finally {
      await operations;
      this.state.busy = false;
      try {
        await this.flush();
      } finally {
        finish();
      }
    }
  }
  stop() {
    this.waiting?.abort();
    this.stopped = true;
    clearTimeout(this.timer);
    this.session?.stop();
  }
}
