import { CourseSession } from "../../../packages/learning/src/pi/sessions/course";
import type {
  CourseManagement,
  AnimationTools,
} from "../../../packages/learning/src/pi/tool";
import type {
  ModelInfo,
  StoredCourse,
  StoredCourseConversation,
  CourseCover,
  CourseMaterial,
  OutlineReorganization,
  CodeLanguage,
  InputMode,
  AnimationPlaybackState,
} from "../../../packages/learning/src/domain/learning";
import { ToolAPI, ToolAPIError } from "./api";

type OutlineResult = {
  course?: StoredCourse;
  reorganization?: OutlineReorganization;
};
import type { CourseProjection } from "../../../packages/learning/src/domain/agent";
export type { CourseProjection } from "../../../packages/learning/src/domain/agent";

export class CourseHost {
  get running() {
    return this.pendingPrompts > 0 || this.session.running;
  }
  private session!: CourseSession;
  private saving: Promise<void> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private pendingPrompts = 0;
  private stopped = false;
  private playback = new Map<string, AnimationPlaybackState>();
  private materials: Array<{ name: string; content: string }> = [];

  constructor(
    readonly api: ToolAPI,
    private info: ModelInfo,
    private memory: string,
    readonly state: CourseProjection,
  ) {
    this.state.animations = [];
    this.createSession();
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

  private courseId() {
    if (!this.state.course) throw new Error("课程尚未建立");
    return this.state.course.id;
  }
  private async accept(course: StoredCourse) {
    this.state.course = {
      ...course,
      conversationId: this.state.conversationId,
      state: this.state.lesson,
    };
    this.changed();
    await this.flush();
    return this.state.course;
  }
  private async finishOutline(
    result: OutlineResult,
    classify: NonNullable<Parameters<CourseManagement["setOutline"]>[1]>,
  ): Promise<StoredCourse> {
    while (!result.course) {
      const reorganization = result.reorganization;
      if (!reorganization?.pending.length)
        throw new Error("课程大纲分类暂时不可用");
      const batch = await Promise.all(
        reorganization.pending.slice(0, 3).map(async (conversation) => ({
          conversation,
          classification: await classify(reorganization, conversation),
        })),
      );
      for (const { conversation, classification } of batch) {
        try {
          result = await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline-reorganizations/${reorganization.id}/assignments/${conversation.id}`,
            "PUT",
            {
              ...classification,
              conversationUpdatedAt: conversation.updatedAt,
            },
          );
        } catch (error) {
          if (!(error instanceof ToolAPIError) || error.status !== 409)
            throw error;
          result = await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline-reorganization`,
          );
          break;
        }
        if (result.course) break;
      }
    }
    return this.accept(result.course);
  }

  private createSession(handoff?: string) {
    const host = this;
    const management: CourseManagement = {
      get course() {
        return host.state.course;
      },
      get currentConversationId() {
        return host.state.conversationId || null;
      },
      create: async (title: string, topic: string, cover: CourseCover) => {
        const { course } = await this.api.json<{ course: StoredCourse }>(
          "/courses",
          "POST",
          { title, topic, cover },
        );
        await this.accept(course);
        for (const file of this.materials.splice(0)) {
          const { upload } = await this.api.json<{
            upload: {
              id: string;
              url: string;
              headers: Record<string, string>;
            };
          }>(`/courses/${course.id}/material-uploads`, "POST", {
            name: file.name,
            sizeBytes: Buffer.byteLength(file.content),
          });
          const response = await this.api.object(upload.url, {
            method: "PUT",
            headers: upload.headers,
            body: file.content,
          });
          if (!response.ok) throw new Error("课程材料上传失败");
          await this.api.json(
            `/courses/${course.id}/material-uploads/${upload.id}/complete`,
            "POST",
            {},
          );
        }
        return course;
      },
      rename: async (title, topic) =>
        this.accept(
          (
            await this.api.json<{ course: StoredCourse }>(
              `/courses/${this.courseId()}`,
              "PATCH",
              { title, topic },
            )
          ).course,
        ),
      setOutline: async (sections, classify) => {
        if (!classify) throw new Error("缺少课程分类器");
        await this.flush();
        return this.finishOutline(
          await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline`,
            "PUT",
            { sections },
          ),
          classify,
        );
      },
      resumeOutline: async (classify) => {
        if (!this.state.course) return null;
        try {
          return await this.finishOutline(
            await this.api.json<OutlineResult>(
              `/courses/${this.courseId()}/outline-reorganization`,
            ),
            classify,
          );
        } catch (error) {
          if (error instanceof ToolAPIError && error.status === 404)
            return null;
          throw error;
        }
      },
      createConversation: async (sectionId, title) => {
        if (
          this.state.course?.sections?.some((section) =>
            section.conversations.some(
              (conversation) => conversation.id === this.state.conversationId,
            ),
          )
        )
          throw new Error("当前学习对话已经归属章节");
        const conversation = await this.createConversation(sectionId, title);
        this.state.conversationId = conversation.id;
        await this.accept(this.state.course!);
        return conversation;
      },
      switchSection: async (sectionId, title) => {
        await this.flush();
        return this.createConversation(sectionId, title);
      },
      listConversations: async () =>
        this.state.course?.sections?.flatMap((s) => s.conversations) ?? [],
      readConversation: async (id) => {
        const { course } = await this.api.json<{ course: StoredCourse }>(
          `/courses/${this.courseId()}`,
        );
        const conversation = course.sections
          ?.flatMap((s) => s.conversations)
          .find((c) => c.id === id);
        if (!conversation) throw new Error("找不到这条历史学习记录");
        return conversation;
      },
      listMaterials: async () =>
        (
          await this.api.json<{ materials: CourseMaterial[] }>(
            `/courses/${this.courseId()}/materials`,
          )
        ).materials,
      readMaterial: async (id) => {
        const download = await this.api.json<{
          material: CourseMaterial;
          url: string;
          headers: Record<string, string>;
        }>(`/courses/${this.courseId()}/materials/${id}/download`);
        const response = await this.api.object(download.url, {
          headers: download.headers,
        });
        if (!response.ok) throw new Error("无法读取课程材料");
        return { material: download.material, content: await response.text() };
      },
    };
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
      management,
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
        this.createSession(text);
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
    );
  }
  private async createConversation(sectionId: string, title: string) {
    const { conversation } = await this.api.json<{
      conversation: StoredCourseConversation;
    }>(
      `/courses/${this.courseId()}/sections/${sectionId}/conversations`,
      "POST",
      { title },
    );
    const course = this.state.course!;
    await this.accept({
      ...course,
      sections: course.sections?.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              conversations: [...section.conversations, conversation],
            }
          : section,
      ),
    });
    return conversation;
  }
  async command(action: string, args: unknown[]) {
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
        this.materials = args[0] as typeof this.materials;
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
  stop() {
    this.session.stop();
    this.stopped = true;
    clearTimeout(this.saveTimer);
  }
}
