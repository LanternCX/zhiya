import type { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ModelInfo,
  ModelRetryListener,
  ModelRetryStatus,
  Slide,
  LessonPage,
  CodingExercise,
  CourseMessage,
  CourseActivity,
  CourseConversationState,
  OutlineReorganization,
  StoredCourseConversation,
  InputMode,
  UserMessage,
} from "../../domain/learning";
import { ConversationManager } from "../../conversation/ConversationManager";
import { ResponsePresenter } from "../../conversation/ResponsePresenter";
import type { ModelGateway } from "../gateway";
import { createTeacherAgent, teacherToolLabel } from "../agent/teacher";
import { createSlidesAgent } from "../agent/slides";
import { classifyCourseConversation } from "../agent/outline-classifier";
import type { CodingTools, CourseManagement } from "../tool";
import type { SlideRequest } from "../tools/create_slides";

export class CourseSession {
  private teacher: Agent;
  private slideAgent: Agent | null = null;
  private publishedPages: LessonPage[] = [];
  private pendingFirst: {
    task: number;
    reject: (error: Error) => void;
  } | null = null;
  private slideTask = 0;
  private cancellation = 0;
  private stopped = false;
  private streamingTeacherMessage = false;
  private messageSequence = 0;
  private teacherMessageId = 0;
  private currentInputMode: InputMode = "text";
  private narrationPlayback: {
    id: number;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  private currentPageId = "";
  private nextSlideWaiter: {
    afterId: string;
    resolve: (page: LessonPage) => void;
    reject: (error: Error) => void;
  } | null = null;
  private modelRetries = new Map<
    "teacher" | "slides" | "outline-classifier",
    ModelRetryStatus
  >();
  private classificationAgents = new Set<Agent>();
  private outlineRecovery: Promise<boolean>;
  private recoverOutline: () => Promise<boolean>;

  constructor(
    private gateway: ModelGateway,
    info: ModelInfo,
    memory: string,
    private onMessage: (message: CourseMessage, replaceLast?: boolean) => void,
    private onPages: (pages: LessonPage[], generating: boolean) => void,
    private onPresent: (pageId: string) => void,
    private onActivity: (activity: CourseActivity | null) => void,
    private onRetry: ModelRetryListener,
    private onError: (message: string) => void,
    initial: CourseConversationState,
    courseManagement: CourseManagement,
    codingLanguages: CodingTools["languages"],
  ) {
    this.publishedPages = [...initial.pages];
    this.currentPageId = initial.currentPageId;
    this.messageSequence = initial.messages.reduce(
      (largest, message) => Math.max(largest, message.id),
      0,
    );
    const classify = (
      reorganization: OutlineReorganization,
      conversation: StoredCourseConversation,
    ) =>
      classifyCourseConversation({
        model: info,
        gateway: this.gateway,
        reorganization,
        conversation,
        onRetry: (status) =>
          this.updateModelRetry("outline-classifier", status),
        register: (agent) => this.classificationAgents.add(agent),
        unregister: (agent) => this.classificationAgents.delete(agent),
      });
    const teachingManagement: CourseManagement = {
      ...courseManagement,
      setOutline: (sections) => courseManagement.setOutline(sections, classify),
    };
    this.recoverOutline = async () => {
      try {
        await courseManagement.resumeOutline(classify);
        return true;
      } catch (error) {
        if (!this.stopped)
          this.onError(
            error instanceof Error ? error.message : "课程大纲调整暂时中断",
          );
        return false;
      }
    };
    this.outlineRecovery = this.recoverOutline();
    this.teacher = createTeacherAgent({
      model: info,
      gateway: this.gateway,
      memory,
      messages: initial.messages,
      management: teachingManagement,
      slides: {
        start: (request) => this.startSlides(info, memory, request),
        cancel: () => this.cancelSlides(),
        read: () => ({
          pages: this.publishedPages.filter(
            (page): page is Slide => page.kind === "slide",
          ),
          generating: Boolean(this.slideAgent?.state.isStreaming),
        }),
        next: () => this.presentNextSlide(),
      },
      coding: {
        languages: codingLanguages,
        show: (id, exercise) => this.showCodingExercise(id, exercise),
        read: () => this.currentCodingExercise(),
        end: () => this.endCodingExercise(),
      },
      onRetry: (status) => this.updateModelRetry("teacher", status),
    });
    this.teacher.subscribe((event) => {
      if (this.stopped) return;
      if (event.type === "tool_execution_start") {
        this.onActivity({
          kind: "tool",
          name: event.toolName,
          label: teacherToolLabel(event.toolName),
          status: "running",
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        this.onActivity({
          kind: "tool",
          name: event.toolName,
          label: teacherToolLabel(event.toolName),
          status: event.isError ? "error" : "complete",
        });
        return;
      }
      if (
        event.type !== "message_start" &&
        event.type !== "message_update" &&
        event.type !== "message_end"
      )
        return;
      if (event.message.role !== "assistant") return;
      if (event.type === "message_start") {
        this.streamingTeacherMessage = false;
        this.teacherMessageId = ++this.messageSequence;
        this.onActivity({ kind: "thinking", text: "", active: true });
        return;
      }
      const message = event.message as AssistantMessage;
      const reasoning = message.content
        .filter((part) => part.type === "thinking")
        .map((part) => part.thinking)
        .join("\n\n");
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      const presented = ResponsePresenter.present(text, this.currentInputMode);
      if (reasoning || (event.type === "message_update" && !presented.display_text)) {
        this.onActivity({
          kind: "thinking",
          text: reasoning,
          active: event.type === "message_update",
        });
      } else if (presented.display_text) {
        this.onActivity(null);
      }
      if (presented.display_text.trim()) {
        this.ensureNarrationPlayback(this.teacherMessageId);
        this.onMessage(
          {
            id: this.teacherMessageId,
            role: "assistant",
            text: presented.display_text,
            streaming: event.type === "message_update",
            pageId: this.currentPageId || undefined,
          },
          this.streamingTeacherMessage,
        );
        this.streamingTeacherMessage = event.type === "message_update";
      } else if (event.type === "message_end") {
        this.streamingTeacherMessage = false;
      }
    });
  }

  get busy() {
    return this.teacher.state.isStreaming;
  }

  async prompt(input: UserMessage | string, materialNames: string[] = [], inputMode: InputMode = "text") {
    if (this.stopped || this.busy) return;
    if (!(await this.outlineRecovery)) {
      this.outlineRecovery = this.recoverOutline();
      if (!(await this.outlineRecovery)) return;
    }
    if (this.stopped) return;
    const operation = this.cancellation;
    const message = typeof input === "string"
      ? ConversationManager.userMessage(input, inputMode, materialNames)
      : ConversationManager.normalizeUserMessage(input);
    this.currentInputMode = message.input_mode;
    const text = message.text;
    const materials = message.materials ?? [];
    this.onMessage({
      id: ++this.messageSequence,
      ...message,
    });
    const materialPrompt = materials.length
      ? `The student attached these files as course materials for this request: ${JSON.stringify(materials)}. If this is a new course, create it first so the files can be uploaded. Then list and read the relevant course materials before planning or teaching from them.`
      : "";
    const agentText = [text, materialPrompt, ResponsePresenter.modePrompt(message.input_mode)]
      .filter(Boolean)
      .join("\n\n");
    try {
      await this.teacher.prompt(agentText);
      await this.waitForNarrationPlayback();
      if (this.teacher.state.errorMessage)
        throw new Error(this.teacher.state.errorMessage);
    } catch (error) {
      if (!this.stopped && operation === this.cancellation)
        this.onError(
          error instanceof Error ? error.message : "暂时无法继续教学",
        );
    }
  }

  stopCurrent() {
    this.cancellation++;
    this.teacher.abort();
    for (const agent of this.classificationAgents) agent.abort();
    this.classificationAgents.clear();
    this.cancelSlides();
    this.narrationPlayback?.resolve();
    this.narrationPlayback = null;
    this.onActivity(null);
    this.modelRetries.clear();
    this.onRetry(null);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopCurrent();
  }

  private cancelSlides() {
    const pending = this.pendingFirst;
    this.pendingFirst = null;
    this.slideTask++;
    this.slideAgent?.abort();
    this.slideAgent = null;
    pending?.reject(new Error("课件生成已停止"));
    this.nextSlideWaiter?.reject(new Error("课件生成已停止"));
    this.nextSlideWaiter = null;
  }

  private updateModelRetry(
    agent: "teacher" | "slides" | "outline-classifier",
    status: ModelRetryStatus | null,
  ) {
    if (status) this.modelRetries.set(agent, status);
    else this.modelRetries.delete(agent);
    const active = [...this.modelRetries.values()].sort(
      (a, b) => b.attempt - a.attempt,
    )[0];
    this.onRetry(active ?? null);
  }

  private ensureNarrationPlayback(id: number) {
    if (this.narrationPlayback?.id === id) return;
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.narrationPlayback = { id, promise, resolve };
  }

  private waitForNarrationPlayback() {
    return this.narrationPlayback?.promise ?? Promise.resolve();
  }

  finishNarration(id: number) {
    if (this.narrationPlayback?.id !== id) return;
    this.narrationPlayback.resolve();
    this.narrationPlayback = null;
  }

  updateCodingExercise(
    id: string,
    changes: Partial<Pick<CodingExercise, "code" | "stdin" | "result">>,
  ) {
    const index = this.publishedPages.findIndex(
      (page) => page.kind === "coding" && page.id === id,
    );
    if (index < 0) return;
    this.publishedPages[index] = {
      ...(this.publishedPages[index] as CodingExercise),
      ...changes,
    };
    this.onPages(
      [...this.publishedPages],
      Boolean(this.slideAgent?.state.isStreaming),
    );
  }

  async requestExerciseReview() {
    if (this.stopped || this.busy) return;
    await this.prompt("我结束这次编程练习了，请审查我的最终代码并给出建议。");
  }

  private present(page: LessonPage) {
    this.currentPageId = page.id;
    this.onPresent(page.id);
    return page;
  }

  private async presentNextSlide(): Promise<LessonPage> {
    const operation = this.cancellation;
    await this.waitForNarrationPlayback();
    if (operation !== this.cancellation) throw new Error("教学播放已停止");
    const current = this.publishedPages.findIndex(
      (page) => page.id === this.currentPageId,
    );
    const next = this.publishedPages[current + 1];
    if (next) return this.present(next);
    if (!this.slideAgent?.state.isStreaming)
      return Promise.reject(new Error("没有等待讲解的下一页"));
    return new Promise((resolve, reject) => {
      this.nextSlideWaiter = {
        afterId: this.currentPageId,
        resolve: (page) => resolve(this.present(page)),
        reject,
      };
    });
  }

  private startSlides(
    info: ModelInfo,
    memory: string,
    request: SlideRequest,
  ): Promise<Slide> {
    if (request.replaceCurrent) this.cancelSlides();
    else if (this.slideAgent?.state.isStreaming)
      return Promise.reject(
        new Error(
          "A slide task is already running. Continue it or replace it explicitly.",
        ),
      );
    const task = ++this.slideTask;
    const slides: Slide[] = [];
    let settleFirst: (slide: Slide) => void = () => {};
    let rejectFirst: (error: Error) => void = () => {};
    const first = new Promise<Slide>((resolve, reject) => {
      settleFirst = resolve;
      rejectFirst = reject;
    });
    this.pendingFirst = { task, reject: rejectFirst };
    const agent = createSlidesAgent({
      model: info,
      gateway: this.gateway,
      memory,
      onRetry: (status) => this.updateModelRetry("slides", status),
      publish: (id, page) => {
        if (task !== this.slideTask || this.stopped)
          throw new Error("This slide task is no longer current.");
        const slide: Slide = { kind: "slide", id, ...page };
        slides.push(slide);
        this.publishedPages.push(slide);
        this.onPages(
          [...this.publishedPages],
          slides.length < request.pageCount,
        );
        if (slides.length === 1) {
          this.present(slide);
          if (this.pendingFirst?.task === task) this.pendingFirst = null;
          settleFirst(slide);
        }
        const waiter = this.nextSlideWaiter;
        if (waiter) {
          const previous = this.publishedPages.findIndex(
            (page) => page.id === waiter.afterId,
          );
          const waitingPage = this.publishedPages[previous + 1];
          if (waitingPage) {
            this.nextSlideWaiter = null;
            waiter.resolve(waitingPage);
          }
        }

        return slides.length;
      },
    });
    this.slideAgent = agent;
    void agent
      .prompt(
        `Create ${request.pageCount} page(s) for this teaching goal: ${request.goal}`,
      )
      .then(() => {
        if (task !== this.slideTask) return;
        this.slideAgent = null;
        this.onPages([...this.publishedPages], false);
        const failure = agent.state.errorMessage
          ? new Error(agent.state.errorMessage)
          : slides.length < request.pageCount
            ? new Error(
                slides.length === 0
                  ? "课件没有生成可展示的页面"
                  : `课件只生成了 ${slides.length} / ${request.pageCount} 页`,
              )
            : null;
        if (!failure) return;
        if (this.pendingFirst?.task === task) this.pendingFirst = null;
        if (slides.length === 0) rejectFirst(failure);
        this.onError(failure.message);
      })
      .catch((error) => {
        if (task !== this.slideTask || this.stopped) return;
        this.slideAgent = null;
        this.onPages([...this.publishedPages], false);
        const failure =
          error instanceof Error ? error : new Error("课件生成失败");
        if (slides.length === 0) {
          if (this.pendingFirst?.task === task) this.pendingFirst = null;
          rejectFirst(failure);
        }
        this.onError(failure.message);
      });
    return first;
  }

  private showCodingExercise(
    id: string,
    draft: Pick<
      CodingExercise,
      "title" | "instructions" | "languageId" | "languageName" | "starterCode"
    >,
  ) {
    const exercise: CodingExercise = {
      kind: "coding",
      id,
      ...draft,
      code: draft.starterCode,
      stdin: "",
      status: "active",
    };
    const current = this.publishedPages.findIndex(
      (page) => page.id === this.currentPageId,
    );
    this.publishedPages.splice(
      current < 0 ? this.publishedPages.length : current + 1,
      0,
      exercise,
    );
    this.onPages(
      [...this.publishedPages],
      Boolean(this.slideAgent?.state.isStreaming),
    );
    this.present(exercise);
    return exercise;
  }

  private currentCodingExercise() {
    const exercise = [...this.publishedPages]
      .reverse()
      .find(
        (page): page is CodingExercise =>
          page.kind === "coding" && page.status === "active",
      );
    if (!exercise) throw new Error("没有进行中的编程练习");
    return exercise;
  }

  private endCodingExercise() {
    const exercise = this.currentCodingExercise();
    exercise.status = "ended";
    this.onPages(
      [...this.publishedPages],
      Boolean(this.slideAgent?.state.isStreaming),
    );
    return exercise;
  }
}
