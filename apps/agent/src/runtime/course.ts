import { agentBranch, branchMessages, type Session } from "../pi/session";
import { CourseSession } from "../pi/sessions/course";
import type {
  AnimationTools,
} from "../pi/tool";
import type {
  ModelInfo,
  CodeLanguage,
  InputMode,
  AnimationPlaybackState,
} from "../../../../packages/learning/src/domain/learning";
import { CourseAPI } from "../adapters/course";
import { ToolAPI } from "../adapters/api";

import type { CourseProjection } from "../../../../packages/learning/src/domain/agent";
export type { CourseProjection } from "../../../../packages/learning/src/domain/agent";

export class CourseHost {
  get running() {
    return this.pendingPrompts > 0 || Boolean(this.session?.running);
  }
  private session!: CourseSession;
  private ready: Promise<void>;
  private saving: Promise<void> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private pendingPrompts = 0;
  private stopped = false;
  private playback = new Map<string, AnimationPlaybackState>();
  private courses: CourseAPI;

  constructor(
    readonly api: ToolAPI,
    private info: ModelInfo,
    private memory: string,
    readonly state: CourseProjection,
    private transcript?: { open: (conversationId: string) => Promise<Session> },
  ) {
    this.courses = new CourseAPI(
      api,
      state,
      () => this.changed(),
      () => this.flush(),
    );
    this.state.animations = [];
    this.ready = this.createSession();
  }

  private changed() {
    if (this.stopped) return;
    this.state.busy = this.pendingPrompts > 0 || Boolean(this.session?.busy);
    this.state.running =
      this.pendingPrompts > 0 || Boolean(this.session?.running);
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        void this.flush().catch(() => this.stop());
      }, 50);
  }

  async flush() {
    await this.ready;
    this.state.running = this.running;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this.saving = this.saving
      .then(() =>
        this.api.json(`/sessions/${this.api.id}/state`, "POST", snapshot),
      )
      .then(() => {});
    await this.saving;
  }

  private async createSession(handoff?: string) {
    const session = await this.transcript?.open(this.state.conversationId);
    const branch = session ? await agentBranch(session, "teacher") : undefined;
    const messages = branch ? await branchMessages(branch) : [];
    const animations: Pick<AnimationTools, "control" | "playback"> = {
      control: (pageId, command) => {
        const current = this.playback.get(pageId) ?? {
          pageId,
          status: "idle" as const,
          step: 0,
        };
        const next: AnimationPlaybackState = {
          ...current,
          status:
            command.action === "play"
              ? "playing"
              : command.action === "pause"
                ? "paused"
                : "idle",
          ...(command.action === "reset" ? { step: 0 } : {}),
          ...(command.action === "play" ? { buttonId: command.buttonId } : {}),
        };
        this.playback.set(pageId, next);
        this.state.animations!.push({
          id: crypto.randomUUID(),
          pageId,
          command,
        });
        this.changed();
        return next;
      },
      playback: (pageId) =>
        this.playback.get(pageId) ?? { pageId, status: "idle", step: 0 },
    };
    this.session = new CourseSession(
      {
        onboarding: (runId, payload, signal, onRetry) =>
          this.api.model(
            "/learning/model",
            { runId, payload },
            signal,
            onRetry,
          ),
        course: (agent, payload, signal, onRetry) =>
          this.api.model("/course/model", { agent, payload }, signal, onRetry),
      },
      this.info,
      this.memory,
      (message) => {
        const index = this.state.lesson.messages.findIndex(
          (m) => m.id === message.id,
        );
        if (index < 0) this.state.lesson.messages.push(message);
        else this.state.lesson.messages[index] = message;
        this.changed();
        // Presentation is recorded server-side; device playback cannot hold the loop open.
        queueMicrotask(() => this.session.finishNarration(message.id));
      },
      (pages, generating) => {
        this.state.lesson.pages = pages;
        this.state.generating = generating;
        this.changed();
      },
      (presentations, currentPresentationId) => {
        Object.assign(this.state.lesson, {
          presentations,
          currentPresentationId,
        });
        this.changed();
      },
      (activity) => {
        this.state.activity = activity;
        this.changed();
      },
      (retry) => {
        this.state.retry = retry;
        this.changed();
      },
      (error) => {
        this.state.error = error;
        this.changed();
      },
      structuredClone(this.state.lesson),
      this.courses.management,
      async () =>
        (await this.api.json<{ languages: CodeLanguage[] }>("/code/languages"))
          .languages,
      animations,
      async (conversation, text, isCurrent) => {
        await this.flush();
        if (!isCurrent()) return;
        this.session.stop();
        this.state.conversationId = conversation.id;
        this.state.lesson = structuredClone(conversation.state);
        await this.createSession(text);
        await this.session.beginFromHandoff();
      },
      handoff,
      {
        create: async (courseId, conversationId, request) =>
          (
            await this.api.json<{ generation: { id: string } }>(
              `/courses/${courseId}/image-generations`,
              "POST",
              { conversationId, ...request },
            )
          ).generation,
        get: async (courseId, id) =>
          (
            await this.api.json<{
              generation: {
                status: "running" | "complete" | "failed" | "cancelled";
                assetId?: string;
                error?: string;
              };
            }>(`/courses/${courseId}/image-generations/${id}`)
          ).generation,
        cancel: (courseId, id) =>
          this.api.json(
            `/courses/${courseId}/image-generations/${id}`,
            "DELETE",
          ),
      },
      branch && session ? { branch, messages, session } : undefined,
    );
  }
  async command(action: string, args: unknown[]) {
    await this.ready;
    this.state.error = "";
    switch (action) {
      case "attach":
        break;
      case "prompt":
        this.pendingPrompts++;
        this.state.activity = { kind: "thinking", text: "", active: true };
        this.changed();
        try {
          await this.session.prompt(
            String(args[0]),
            (args[1] as string[]) ?? [],
            (args[2] as InputMode) ?? "text",
          );
        } finally {
          this.pendingPrompts--;
          this.changed();
        }
        break;
      case "materials":
        this.courses.materials = args[0] as typeof this.courses.materials;
        break;
      case "stop":
        this.session.stopCurrent();
        this.state.busy = false;
        break;
      case "selectPresentation":
        this.session.selectPresentation(String(args[0]));
        break;
      case "updateCodingExercise": {
        const changes = args[1] as Parameters<
          CourseSession["updateCodingExercise"]
        >[1];
        if (changes.result === null) changes.result = undefined;
        this.session.updateCodingExercise(String(args[0]), changes);
        break;
      }
      case "updateQuestion":
        this.session.updateQuestion(
          String(args[0]),
          args[1] as Parameters<CourseSession["updateQuestion"]>[1],
        );
        break;
      case "submitQuestion":
        await this.session.submitQuestion(String(args[0]));
        break;
      case "deferQuestion":
        await this.session.deferQuestion(String(args[0]));
        break;
      case "requestExerciseReview":
        await this.session.requestExerciseReview();
        break;
      case "beginFromHandoff":
        await this.session.beginFromHandoff(args[0] as InputMode);
        break;
      case "animationPlayback":
        this.playback.set(String(args[0]), args[1] as AnimationPlaybackState);
        break;
      default:
        throw new Error("未知课堂操作");
    }
    await this.flush();
  }
  async shutdown() {
    await this.ready;
    this.stop();
    await this.session.waitForIdle();
  }
  stop() {
    this.session?.stop();
    this.stopped = true;
    clearTimeout(this.saveTimer);
  }
}
