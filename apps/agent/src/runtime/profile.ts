import type { Session } from "../pi/session";
import { profileStore } from "../adapters/profile";
import { ProfileSession } from "../pi/sessions/profile";
import type {
  Conversation,
} from "../pi/contracts";
import type { ModelInfo } from "../domain/learning";
import { ToolAPI } from "../adapters/api";

import type { ProfileProjection } from "../domain/agent";
export type { ProfileProjection } from "../domain/agent";

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
    private transcript?: Session,
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
    const { store, settled } = profileStore(
      this.api,
      (conversation) => {
        this.state.conversation = conversation;
        this.changed();
      },
      () => !this.stopped && !this.session?.isStopped,
      (controller) => {
        this.waiting = controller;
      },
    );
    this.session = new ProfileSession(
      {
        onboarding: async (runId, payload, signal, onRetry) => {
          await settled();
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
      this.state.role,
      this.transcript,
    );
    try {
      await this.session.run(args[0] as string | undefined);
      await settled();
    } finally {
      await settled();
      this.state.busy = false;
      try {
        await this.flush();
      } finally {
        finish();
      }
    }
  }
  async shutdown() {
    this.stop();
    await this.finished;
  }
  stop() {
    this.waiting?.abort();
    this.stopped = true;
    clearTimeout(this.timer);
    this.session?.stop();
  }
}
