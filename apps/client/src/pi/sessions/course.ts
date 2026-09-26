import type { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ModelInfo,
  ModelRetryListener,
  ModelRetryStatus,
  Slide,
  AnimationPage,
  IllustrationPage,
  LessonPage,
  LessonPresentation,
  CodingExercise,
  CourseMessage,
  CourseActivity,
  CourseConversationState,
  OutlineReorganization,
  OutlineClassification,
  StoredCourse,
  StoredCourseConversation,
} from "../../domain/learning";
import type { ModelGateway } from "../gateway";
import { createTeacherAgent, teacherToolLabel } from "../agent/teacher";
import { createSlidesAgent } from "../agent/slides";
import { createAnimationAgent } from "../agent/animation";
import { classifyCourseConversation } from "../agent/outline-classifier";
import type {
  AgentTaskSummary,
  AnimationTools,
  CodingTools,
  CourseManagement,
} from "../tool";
import type { SlideRequest } from "../tools/create_slides";
import {
  cancelIllustration,
  createIllustration,
  getIllustration,
} from "../../transport/illustrations";

export class CourseSession {
  private teacher: Agent;
  private slideAgents = new Map<
    string,
    {
      agent: Agent;
      status: "running" | "complete" | "failed" | "cancelled";
      pageIds: string[];
      error?: string;
    }
  >();
  private animationSequence = 0;
  private outlineSequence = 0;
  private animationTasks = new Map<
    string,
    {
      pageId: string;
      agent: Agent;
      status: "running" | "complete" | "failed" | "cancelled";
      error?: string;
    }
  >();
  private illustrationTasks = new Map<
    string,
    {
      courseId: string;
      generationId: string;
      pageId: string;
      title: string;
      alt: string;
      status: "running" | "complete" | "failed" | "cancelled";
      error?: string;
    }
  >();
  private pageStore: LessonPage[] = [];
  private presentations: LessonPresentation[] = [];
  private cancellation = 0;
  private stopped = false;
  private messageSequence = 0;
  private teacherMessageId = 0;
  private narrationPlayback: {
    id: number;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  private currentPresentationId = "";
  private teacherPresentationId = "";

  private get currentPageId() {
    return (
      this.presentations.find((item) => item.id === this.currentPresentationId)
        ?.pageId ?? ""
    );
  }
  private modelRetries = new Map<
    "teacher" | "slides" | "animation" | "outline-classifier",
    ModelRetryStatus
  >();
  private pendingTaskNotices: string[] = [];
  private pageWaiters = new Set<() => void>();
  private teachingInterrupted = false;
  private pendingActiveNotices: string[] = [];
  private pendingHandoff: {
    conversation: StoredCourseConversation;
    text: string;
  } | null = null;
  private switchingSection = false;
  private outlineTasks = new Map<
    string,
    {
      status: "running" | "complete" | "failed" | "cancelled";
      agents: Set<Agent>;
      recovery: boolean;
      sections?: AgentTaskSummary["sections"];
      error?: string;
    }
  >();

  constructor(
    private gateway: ModelGateway,
    info: ModelInfo,
    memory: string,
    private onMessage: (message: CourseMessage) => void,
    private onPages: (pages: LessonPage[], generating: boolean) => void,
    private onSequence: (
      sequence: LessonPresentation[],
      currentPresentationId: string,
    ) => void,
    private onActivity: (activity: CourseActivity | null) => void,
    private onRetry: ModelRetryListener,
    private onError: (message: string) => void,
    initial: CourseConversationState,
    courseManagement: CourseManagement,
    codingLanguages: CodingTools["languages"],
    animationPlayback: Pick<AnimationTools, "control" | "playback">,
    private onHandoff: (
      conversation: StoredCourseConversation,
      text: string,
      isCurrent: () => boolean,
    ) => Promise<void>,
    initialHandoff?: string,
  ) {
    this.pageStore = [...initial.pages];
    this.presentations = [...initial.presentations];
    this.currentPresentationId = initial.currentPresentationId;
    this.teacherPresentationId = initial.presentations.at(-1)?.id ?? "";
    this.messageSequence = initial.messages.reduce(
      (largest, message) => Math.max(largest, message.id),
      0,
    );
    const teachingManagement: CourseManagement = {
      ...courseManagement,
      setOutline: async (sections) =>
        this.startOutlineTask(info, (classify) =>
          courseManagement.setOutline(sections, classify),
        ),
      switchSection: async (sectionId, title, handoff) => {
        if (this.switchingSection || this.pendingHandoff)
          throw new Error("学习小节正在切换");
        if (
          [...this.outlineTasks.values()].some(
            (task) => task.status === "running" && !task.recovery,
          )
        )
          throw new Error("请等待课程大纲更新完成后再切换小节");
        this.switchingSection = true;
        const operation = this.cancellation;
        try {
          const conversation = await courseManagement.switchSection(
            sectionId,
            title,
            handoff,
          );
          if (this.stopped || operation !== this.cancellation)
            throw new Error("学习小节切换已停止");
          this.pendingHandoff = { conversation, text: handoff };
          return conversation;
        } finally {
          this.switchingSection = false;
        }
      },
    };
    this.teacher = createTeacherAgent({
      model: info,
      gateway: this.gateway,
      memory,
      messages: initial.messages,
      management: teachingManagement,
      slides: {
        start: (id, request, signal) =>
          this.startSlides(info, memory, id, request, signal),
        cancel: () => this.cancelSlides(),
        read: () => ({
          pages: this.pageStore.filter(
            (page): page is Slide => page.kind === "slide",
          ),
          generating: [...this.slideAgents.values()].some(
            (task) => task.status === "running",
          ),
        }),
      },
      animations: {
        start: (request) => this.startAnimation(info, memory, request),
        read: () =>
          [...this.animationTasks].map(([taskId, task]) => ({
            taskId,
            pageId: task.pageId,
            status: task.status,
            ...(task.error ? { error: task.error } : {}),
          })),
        cancel: (taskId) => this.cancelAnimation(taskId),
        control: (pageId, command) => {
          if (this.currentPageId !== pageId)
            throw new Error(`动画页面 ${pageId} 当前不可见`);
          return animationPlayback.control(pageId, command);
        },
        playback: animationPlayback.playback,
      },
      illustrations: {
        start: (request) => this.startIllustration(courseManagement, request),
      },
      pages: {
        read: () => this.readLessonPages(),
        show: (id, pageId, signal) => this.showPage(id, pageId, signal),
      },
      tasks: {
        read: () => this.readAgentTasks(),
        cancel: (taskId) => this.cancelAgentTask(taskId),
      },
      coding: {
        languages: codingLanguages,
        show: (id, exercise) => this.showCodingExercise(id, exercise),
        read: () => this.currentCodingExercise(),
        end: () => this.endCodingExercise(),
      },
      onRetry: (status) => this.updateModelRetry("teacher", status),
      handoff: initialHandoff,
      shouldStopAfterTurn: () => this.pendingHandoff !== null,
      beforeToolCall: async () =>
        this.teachingInterrupted
          ? {
              block: true,
              reason:
                "The student interrupted this teaching step. Process their new message before using more tools.",
            }
          : undefined,
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
        this.teachingInterrupted = false;
        this.teacherPresentationId = this.currentPresentationId;
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
      if (reasoning || (event.type === "message_update" && !text)) {
        this.onActivity({
          kind: "thinking",
          text: reasoning,
          active: event.type === "message_update",
        });
      } else if (text) {
        this.onActivity(null);
      }
      if (text.trim()) {
        this.ensureNarrationPlayback(this.teacherMessageId);
        this.onMessage({
          id: this.teacherMessageId,
          role: "assistant",
          text,
          streaming: event.type === "message_update",
          pageId: this.presentations.find(
            (item) => item.id === this.teacherPresentationId,
          )?.pageId,
          presentationId: this.teacherPresentationId || undefined,
        });
      }
    });
    this.startOutlineTask(
      info,
      (classify) => courseManagement.resumeOutline(classify),
      false,
    );
  }

  get busy() {
    return this.teacher.state.isStreaming && !this.teacher.signal?.aborted;
  }

  async prompt(text: string, materialNames: string[] = []) {
    if (this.teacher.signal?.aborted) await this.teacher.waitForIdle();
    if (this.stopped) return;
    this.onMessage({
      id: ++this.messageSequence,
      role: "user",
      text,
      ...(materialNames.length ? { materials: materialNames } : {}),
    });
    const studentText = materialNames.length
      ? `${text}\n\nThe student attached these files as course materials for this request: ${JSON.stringify(materialNames)}. If this is a new course, create it first so the files can be uploaded. Then list and read the relevant course materials before planning or teaching from them.`
      : text;
    const taskNotices = [
      ...this.pendingActiveNotices.splice(0),
      ...this.pendingTaskNotices.splice(0),
    ];
    const agentText = taskNotices.length
      ? `${taskNotices.join("\n\n")}\n\n${studentText}`
      : studentText;
    if (this.busy) {
      this.teacher.steer({
        role: "user",
        content: agentText,
        timestamp: Date.now(),
      });
      this.teachingInterrupted = true;
      this.wakePageWaiters();
      this.narrationPlayback?.resolve();
      await this.teacher.waitForIdle();
      return;
    }
    const operation = this.cancellation;
    try {
      await this.teacher.prompt(agentText);
      if (await this.finishHandoff()) return;
      this.flushPendingActiveNotices();
      await this.waitForNarrationPlayback();
      if (this.teacher.state.errorMessage)
        throw new Error(this.teacher.state.errorMessage);
    } catch (error) {
      if (!this.stopped && operation === this.cancellation)
        this.onError(error instanceof Error ? error.message : "暂时无法继续教学");
    }
  }

  private async finishHandoff() {
    const handoff = this.pendingHandoff;
    if (!handoff) return false;
    this.pendingHandoff = null;
    const operation = this.cancellation;
    await this.onHandoff(
      handoff.conversation,
      handoff.text,
      () => !this.stopped && operation === this.cancellation,
    );
    return true;
  }

  async beginFromHandoff() {
    if (this.stopped) return;
    const operation = this.cancellation;
    try {
      await this.teacher.prompt(
        "Begin teaching in this conversation using the application handoff context.",
      );
      if (await this.finishHandoff()) return;
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
    this.pendingHandoff = null;
    this.teacher.abort();
    for (const [taskId, task] of this.outlineTasks) {
      if (task.status === "running") this.cancelAgentTask(taskId);
    }
    this.cancelSlides();
    for (const taskId of this.animationTasks.keys()) this.cancelAnimation(taskId);
    for (const taskId of this.illustrationTasks.keys())
      this.cancelIllustrationTask(taskId);
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
    for (const task of this.slideAgents.values()) {
      if (task.status !== "running") continue;
      task.status = "cancelled";
      task.agent.abort();
    }
    this.wakePageWaiters();
    this.onPages([...this.pageStore], this.hasRunningVisualTask());
  }

  private validateAnimation(page: AnimationPage) {
    const ids = new Set<string>();
    const groupIds = new Set(
      page.nodes.filter((node) => node.shape === "group").map((node) => node.id),
    );
    for (const node of page.nodes) {
      if (ids.has(node.id)) throw new Error(`动画对象 ID 重复：${node.id}`);
      ids.add(node.id);
    }
    for (const edge of page.edges) {
      if (ids.has(edge.id)) throw new Error(`动画对象 ID 重复：${edge.id}`);
      if (!ids.has(edge.source) || !ids.has(edge.target))
        throw new Error(`连线 ${edge.id} 引用了不存在的图形`);
      ids.add(edge.id);
    }
    for (const node of page.nodes) {
      if (node.shape === "group" && node.groupId)
        throw new Error(`分组 ${node.id} 不能嵌套在另一个分组中`);
      if (node.groupId && !groupIds.has(node.groupId))
        throw new Error(`图形 ${node.id} 引用了不存在的分组`);
    }
    for (const groupId of groupIds) {
      if (page.nodes.filter((node) => node.groupId === groupId).length > 4)
        throw new Error(`分组 ${groupId} 最多包含 4 个图形`);
    }
    const buttonIds = new Set<string>();
    for (const button of page.buttons) {
      if (buttonIds.has(button.id))
        throw new Error(`动画按钮 ID 重复：${button.id}`);
      buttonIds.add(button.id);
      for (const step of button.steps) {
        for (const action of step) {
          if (!ids.has(action.targetId))
            throw new Error(
              `按钮 ${button.id} 引用了不存在的对象 ${action.targetId}`,
            );
        }
      }
    }
  }

  private startAnimation(
    info: ModelInfo,
    memory: string,
    request: { pageId: string; goal: string },
  ) {
    if (
      this.pageStore.some((page) => page.id === request.pageId) ||
      [...this.animationTasks.values()].some(
        (task) => task.pageId === request.pageId,
      )
    )
      throw new Error(`页面 ID 已被使用：${request.pageId}`);
    const taskId = `animation-${++this.animationSequence}-${request.pageId}`;
    const agent = createAnimationAgent({
      model: info,
      gateway: this.gateway,
      memory,
      pageId: request.pageId,
      onRetry: (status) => this.updateModelRetry("animation", status),
      publish: (draft) => {
        const task = this.animationTasks.get(taskId);
        if (!task || task.status !== "running" || this.stopped)
          throw new Error("This animation task is no longer current.");
        if (draft.pageId !== request.pageId)
          throw new Error(
            `动画页面 ID 必须是 ${request.pageId}，实际为 ${draft.pageId}`,
          );
        if (this.pageStore.some((page) => page.id === draft.pageId))
          throw new Error(`动画页面 ${draft.pageId} 已经发布`);
        const { pageId, ...content } = draft;
        const page: AnimationPage = {
          kind: "animation",
          id: pageId,
          ...content,
        };
        this.validateAnimation(page);
        this.addToPageStore(page);
        this.onPages([...this.pageStore], true);
      },
    });
    this.animationTasks.set(taskId, {
      pageId: request.pageId,
      agent,
      status: "running",
    });
    this.onPages([...this.pageStore], true);
    const generate = async () => {
      await agent.prompt(`Create this animation page: ${request.goal}`);
      const task = this.animationTasks.get(taskId);
      const published = this.pageStore.some(
        (page) => page.id === request.pageId,
      );
      if (
        task?.status === "running" &&
        !this.stopped &&
        !agent.state.errorMessage &&
        !published
      ) {
        await agent.prompt(
          "You stopped without publishing the animation. Review your previous turn and any tool errors in this same conversation. Simplify or correct the scene, then call publish_animation exactly once. Do not output prose.",
        );
      }
    };
    void generate()
      .then(() => {
        const task = this.animationTasks.get(taskId);
        if (!task || task.status !== "running" || this.stopped) return;
        const published = this.pageStore.some(
          (page) => page.id === request.pageId,
        );
        if (agent.state.errorMessage || !published) {
          task.status = "failed";
          task.error =
            agent.state.errorMessage || "动画没有生成可展示的页面";
          this.onError(task.error);
        } else {
          task.status = "complete";
        }
        this.notifyTeacherOfTask({
          taskId,
          kind: "animation",
          status: task.status,
          pageId: task.pageId,
          ...(task.error ? { error: task.error } : {}),
        });
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
      })
      .catch((error) => {
        const task = this.animationTasks.get(taskId);
        if (!task || task.status !== "running" || this.stopped) return;
        task.status = "failed";
        task.error = error instanceof Error ? error.message : "动画生成失败";
        this.notifyTeacherOfTask({
          taskId,
          kind: "animation",
          status: task.status,
          pageId: task.pageId,
          error: task.error,
        });
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
        this.onError(task.error);
      });
    return { taskId, pageId: request.pageId, status: "running" as const };
  }

  private async startIllustration(
    management: CourseManagement,
    request: {
      pageId: string;
      title: string;
      description: string;
      alt: string;
    },
  ) {
    const course = management.course;
    const conversationId = management.currentConversationId;
    if (!course || !conversationId)
      throw new Error("请先创建并进入课程对话");
    if (
      this.pageStore.some((page) => page.id === request.pageId) ||
      [...this.illustrationTasks.values()].some(
        (task) => task.pageId === request.pageId,
      )
    )
      throw new Error(`页面 ID 已被使用：${request.pageId}`);
    const generation = await createIllustration(
      course.id,
      conversationId,
      request,
    );
    const taskId = generation.id;
    this.illustrationTasks.set(taskId, {
      courseId: course.id,
      generationId: generation.id,
      pageId: request.pageId,
      title: request.title,
      alt: request.alt,
      status: "running",
    });
    this.onPages([...this.pageStore], true);
    void this.pollIllustration(taskId);
    return { taskId, pageId: request.pageId, status: "running" as const };
  }

  private async pollIllustration(taskId: string): Promise<void> {
    const task = this.illustrationTasks.get(taskId);
    if (!task || task.status !== "running" || this.stopped) return;
    try {
      const generation = await getIllustration(
        task.courseId,
        task.generationId,
      );
      const current = this.illustrationTasks.get(taskId);
      if (!current || current.status !== "running" || this.stopped) return;
      if (generation.status === "running") {
        window.setTimeout(() => void this.pollIllustration(taskId), 1500);
        return;
      }
      if (generation.status === "complete" && generation.assetId) {
        const page: IllustrationPage = {
          kind: "illustration",
          id: current.pageId,
          title: current.title,
          alt: current.alt,
          assetId: generation.assetId,
        };
        this.addToPageStore(page);
        current.status = "complete";
      } else {
        current.status = generation.status;
        current.error = generation.error || "教学插图生成失败";
        if (current.status === "failed") this.onError(current.error);
      }
      this.notifyTeacherOfTask({
        taskId,
        kind: "illustration",
        status: current.status,
        pageId: current.pageId,
        ...(current.error ? { error: current.error } : {}),
      });
      this.onPages([...this.pageStore], this.hasRunningVisualTask());
    } catch (error) {
      const current = this.illustrationTasks.get(taskId);
      if (!current || current.status !== "running" || this.stopped) return;
      current.status = "failed";
      current.error =
        error instanceof Error ? error.message : "教学插图生成失败";
      this.notifyTeacherOfTask({
        taskId,
        kind: "illustration",
        status: "failed",
        pageId: current.pageId,
        error: current.error,
      });
      this.onPages([...this.pageStore], this.hasRunningVisualTask());
      this.onError(current.error);
    }
  }

  private cancelIllustrationTask(taskId: string) {
    const task = this.illustrationTasks.get(taskId);
    if (!task || task.status !== "running") return;
    task.status = "cancelled";
    this.wakePageWaiters();
    void cancelIllustration(task.courseId, task.generationId).catch(() => {});
    this.onPages([...this.pageStore], this.hasRunningVisualTask());
  }

  private hasRunningVisualTask() {
    return (
      [...this.slideAgents.values()].some((task) => task.status === "running") ||
      [...this.animationTasks.values()].some((task) => task.status === "running") ||
      [...this.illustrationTasks.values()].some(
        (task) => task.status === "running",
      )
    );
  }

  private addToPageStore(page: LessonPage) {
    this.pageStore.push(page);
    this.notifyTeacherOfPage(page);
  }

  private readLessonPages() {
    const summarize = (page: LessonPage) => ({
      pageId: page.id,
      kind: page.kind,
      title: page.title,
    });
    return {
      pages: this.pageStore.map(summarize),
      presentations: this.presentations.map((item, index) => ({
        ...item,
        position: index + 1,
      })),
      currentPresentationId: this.currentPresentationId,
      currentPageId: this.currentPageId,
      tasks: this.readAgentTasks(),
    };
  }

  private async showPage(
    id: string,
    pageId: string,
    signal?: AbortSignal,
  ): Promise<LessonPage> {
    const operation = this.cancellation;
    const page = await this.waitForPage(pageId, signal);
    await this.waitForNarrationPlayback();
    if (
      operation !== this.cancellation ||
      signal?.aborted ||
      this.teachingInterrupted ||
      this.stopped
    )
      throw new Error("当前教学步骤已中断");
    return this.present(id, page);
  }

  private wakePageWaiters() {
    for (const check of [...this.pageWaiters]) check();
  }

  private waitForPage(
    pageId: string,
    signal?: AbortSignal,
  ): Promise<LessonPage> {
    const operation = this.cancellation;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.pageWaiters.delete(check);
        signal?.removeEventListener("abort", check);
      };
      const check = () => {
        if (
          this.stopped ||
          signal?.aborted ||
          operation !== this.cancellation ||
          this.teachingInterrupted
        ) {
          cleanup();
          reject(
            new Error(
              "页面等待已中断，请先处理学生的新消息；继续教学时重新请求展示。",
            ),
          );
          return;
        }
        const page = this.pageStore.find(
          (candidate) => candidate.id === pageId,
        );
        if (page) {
          cleanup();
          resolve(page);
          return;
        }
        const task =
          [...this.slideAgents.values()].find((candidate) =>
            candidate.pageIds.includes(pageId),
          ) ??
          [
            ...this.animationTasks.values(),
            ...this.illustrationTasks.values(),
          ].find((candidate) => candidate.pageId === pageId);
        if (task?.status === "running") return;
        cleanup();
        reject(
          new Error(
            task?.error ||
              (task?.status === "cancelled"
                ? `页面 ${pageId} 的生成已取消`
                : `页面 ${pageId} 不可用或生成失败`),
          ),
        );
      };
      this.pageWaiters.add(check);
      signal?.addEventListener("abort", check, { once: true });
      check();
    });
  }

  private cancelAnimation(taskId: string) {
    const task = this.animationTasks.get(taskId);
    if (!task || task.status !== "running") return;
    task.status = "cancelled";
    this.wakePageWaiters();
    task.agent.abort();
    this.onPages([...this.pageStore], this.hasRunningVisualTask());
  }

  private startOutlineTask(
    info: ModelInfo,
    operation: (
      classify: (
        reorganization: OutlineReorganization,
        conversation: StoredCourseConversation,
      ) => Promise<OutlineClassification>,
    ) => Promise<
      | StoredCourse
      | { taskId: string; status: "running"; kind: "outline-classifier" }
      | null
    >,
    notifyWhenEmpty = true,
  ) {
    const running = [...this.outlineTasks.entries()].find(
      ([, task]) => task.status === "running",
    );
    if (running) {
      if (running[1].recovery && notifyWhenEmpty) {
        running[1].status = "cancelled";
        for (const agent of running[1].agents) agent.abort();
        this.outlineTasks.delete(running[0]);
      } else {
        throw new Error(`课程大纲任务正在运行：${running[0]}`);
      }
    }
    const taskId = `outline-${++this.outlineSequence}`;
    const task = {
      status: "running" as const,
      agents: new Set<Agent>(),
      recovery: !notifyWhenEmpty,
    };
    this.outlineTasks.set(taskId, task);
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
        register: (agent) => task.agents.add(agent),
        unregister: (agent) => task.agents.delete(agent),
      });
    void operation(classify)
      .then((result) => {
        const current = this.outlineTasks.get(taskId);
        if (!current || current.status !== "running" || this.stopped) return;
        if (result === null && !notifyWhenEmpty) {
          this.outlineTasks.delete(taskId);
          return;
        }
        if (result && "taskId" in result)
          throw new Error("课程大纲任务不能再次启动后台任务");
        current.status = "complete";
        current.sections = (result?.sections ?? []).map(
          ({ id, title, objective, status }) => ({
            id,
            title,
            objective,
            status,
          }),
        );
        this.notifyTeacherOfTask({
          taskId,
          kind: "outline-classifier",
          status: current.status,
          sections: current.sections,
        });
      })
      .catch((error) => {
        const current = this.outlineTasks.get(taskId);
        if (!current || current.status !== "running" || this.stopped) return;
        current.status = "failed";
        current.error =
          error instanceof Error ? error.message : "课程大纲调整暂时中断";
        this.notifyTeacherOfTask({
          taskId,
          kind: "outline-classifier",
          status: current.status,
          error: current.error,
        });
        this.onError(current.error);
      });
    return {
      taskId,
      status: "running" as const,
      kind: "outline-classifier" as const,
    };
  }

  private readAgentTasks(): AgentTaskSummary[] {
    return [
      ...[...this.slideAgents].map(([taskId, task]) => ({
        taskId,
        kind: "slides" as const,
        status: task.status,
        pageIds: task.pageIds,
        ...(task.error ? { error: task.error } : {}),
      })),
      ...[...this.animationTasks].map(([taskId, task]) => ({
        taskId,
        kind: "animation" as const,
        status: task.status,
        pageId: task.pageId,
        ...(task.error ? { error: task.error } : {}),
      })),
      ...[...this.illustrationTasks].map(([taskId, task]) => ({
        taskId,
        kind: "illustration" as const,
        status: task.status,
        pageId: task.pageId,
        ...(task.error ? { error: task.error } : {}),
      })),
      ...[...this.outlineTasks].map(([taskId, task]) => ({
        taskId,
        kind: "outline-classifier" as const,
        status: task.status,
        ...(task.sections ? { sections: task.sections } : {}),
        ...(task.error ? { error: task.error } : {}),
      })),
    ];
  }

  private cancelAgentTask(taskId: string): AgentTaskSummary {
    const slide = this.slideAgents.get(taskId);
    if (slide) {
      if (slide.status === "running") {
        slide.status = "cancelled";
        this.wakePageWaiters();
        slide.agent.abort();
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
      }
      return { taskId, kind: "slides", status: slide.status };
    }
    const animation = this.animationTasks.get(taskId);
    if (animation) {
      this.cancelAnimation(taskId);
      return {
        taskId,
        kind: "animation",
        status: animation.status,
        pageId: animation.pageId,
        ...(animation.error ? { error: animation.error } : {}),
      };
    }
    const outline = this.outlineTasks.get(taskId);
    const illustration = this.illustrationTasks.get(taskId);
    if (illustration) {
      this.cancelIllustrationTask(taskId);
      return {
        taskId,
        kind: "illustration",
        status: illustration.status,
        pageId: illustration.pageId,
        ...(illustration.error ? { error: illustration.error } : {}),
      };
    }
    if (outline) {
      if (outline.status === "running") {
        outline.status = "cancelled";
        for (const agent of outline.agents) agent.abort();
        outline.agents.clear();
      }
      return {
        taskId,
        kind: "outline-classifier",
        status: outline.status,
        ...(outline.sections ? { sections: outline.sections } : {}),
        ...(outline.error ? { error: outline.error } : {}),
      };
    }
    throw new Error(`找不到后台任务 ${taskId}`);
  }

  private notifyTeacherOfTask(task: AgentTaskSummary) {
    this.wakePageWaiters();
    if (this.stopped) return;
    const outlineRule =
      task.kind === "outline-classifier" && task.status === "complete"
        ? " The section IDs in this notice are authoritative. Use one of them for create_course_conversation and never invent or reuse a provisional ID."
        : "";
    const notice = `Background child-agent task completed: ${JSON.stringify(task)}. Treat this as internal task state, not as a student request.${outlineRule} Do not repeat prior teaching or emit user-visible prose solely because this task finished. Decide whether and when to act on the result.`;
    if (task.kind === "outline-classifier") {
      this.pendingActiveNotices.push(notice);
      this.flushPendingActiveNotices();
    } else {
      this.pendingTaskNotices.push(notice);
    }
  }

  private notifyTeacherOfPage(page: LessonPage) {
    this.wakePageWaiters();
    if (this.stopped) return;
    this.pendingTaskNotices.push(
      `Background page became available: ${JSON.stringify({ pageId: page.id, kind: page.kind, title: page.title })}. Treat this as internal state, not a student request. Select it only when it serves the lesson; completion alone never appends a presentation or changes focus.`,
    );
  }

  private flushPendingActiveNotices() {
    if (
      this.stopped ||
      this.teacher.state.isStreaming ||
      this.pendingActiveNotices.length === 0
    )
      return;
    const notice = this.pendingActiveNotices.splice(0).join("\n\n");
    void this.teacher.prompt({
      role: "user",
      content: notice,
      timestamp: Date.now(),
    }).then(
      () => {
        if (!this.stopped && this.teacher.state.errorMessage)
          this.onError(this.teacher.state.errorMessage);
        this.flushPendingActiveNotices();
      },
      (error) => {
        if (!this.stopped) {
          this.onError(
            error instanceof Error ? error.message : "后台任务通知失败",
          );
        }
      },
    );
  }

  private updateModelRetry(
    agent: "teacher" | "slides" | "animation" | "outline-classifier",
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
    const index = this.pageStore.findIndex(
      (page) => page.kind === "coding" && page.id === id,
    );
    if (index < 0) return;
    this.pageStore[index] = {
      ...(this.pageStore[index] as CodingExercise),
      ...changes,
    };
    this.onPages(
      [...this.pageStore],
      this.hasRunningVisualTask(),
    );
  }

  async requestExerciseReview() {
    if (this.stopped || this.busy) return;
    await this.prompt("我结束这次编程练习了，请审查我的最终代码并给出建议。");
  }

  private present(id: string, page: LessonPage) {
    const existing = this.presentations.find((item) => item.id === id);
    if (existing && existing.pageId !== page.id)
      throw new Error("展示记录不能改为其他页面");
    if (existing) return page;
    this.presentations.push({ id, pageId: page.id });
    this.currentPresentationId = id;
    this.teacherPresentationId = id;
    this.onSequence([...this.presentations], id);
    return page;
  }

  selectPresentation(id: string) {
    if (!this.presentations.some((item) => item.id === id))
      throw new Error(`找不到展示记录 ${id}`);
    this.currentPresentationId = id;
    this.onSequence([...this.presentations], id);
  }

  private async startSlides(
    info: ModelInfo,
    memory: string,
    id: string,
    request: SlideRequest,
    signal?: AbortSignal,
  ) {
    const taskId = `slides-${id}`;
    const existing = this.slideAgents.get(taskId);
    if (existing) {
      const page = request.background
        ? undefined
        : ((await this.waitForPage(existing.pageIds[0], signal)) as Slide);
      return {
        taskId,
        status: existing.status,
        pageIds: existing.pageIds,
        ...(page ? { page } : {}),
      };
    }
    if (request.replaceCurrent) this.cancelSlides();
    const pageIds = Array.from(
      { length: request.pageCount },
      () => `slide-${crypto.randomUUID()}`,
    );
    const slides: Slide[] = [];
    const publishedCalls = new Set<string>();
    const agent = createSlidesAgent({
      model: info,
      gateway: this.gateway,
      memory,
      onRetry: (status) => this.updateModelRetry("slides", status),
      publish: (id, page) => {
        const task = this.slideAgents.get(taskId);
        if (!task || task.status !== "running" || this.stopped)
          throw new Error("This slide task is no longer current.");
        if (publishedCalls.has(id)) return slides.length;
        if (slides.length === pageIds.length)
          throw new Error("请求的课件页数已全部生成");
        publishedCalls.add(id);
        const slide: Slide = {
          kind: "slide",
          id: pageIds[slides.length],
          ...page,
        };
        slides.push(slide);
        this.addToPageStore(slide);
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
        return slides.length;
      },
    });
    const task = {
      agent,
      status: "running" as AgentTaskSummary["status"],
      pageIds,
      error: undefined as string | undefined,
    };
    this.slideAgents.set(taskId, task);
    this.onPages([...this.pageStore], true);
    void agent
      .prompt(
        `Create ${request.pageCount} page(s) for this teaching goal: ${request.goal}`,
      )
      .then(() => {
        const task = this.slideAgents.get(taskId);
        if (!task || task.status !== "running") return;
        const failure = agent.state.errorMessage
          ? new Error(agent.state.errorMessage)
          : slides.length < request.pageCount
            ? new Error(
                slides.length === 0
                  ? "课件没有生成可展示的页面"
                  : `课件只生成了 ${slides.length} / ${request.pageCount} 页`,
              )
            : null;
        task.status = failure ? "failed" : "complete";
        task.error = failure?.message;
        this.notifyTeacherOfTask({
          taskId,
          kind: "slides",
          status: task.status,
          ...(failure ? { error: failure.message } : {}),
        });
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
        if (failure) this.onError(failure.message);
      })
      .catch((error) => {
        const task = this.slideAgents.get(taskId);
        if (!task || task.status !== "running" || this.stopped) return;
        task.status = "failed";
        this.onPages([...this.pageStore], this.hasRunningVisualTask());
        const failure =
          error instanceof Error ? error : new Error("课件生成失败");
        task.error = failure.message;
        this.notifyTeacherOfTask({
          taskId,
          kind: "slides",
          status: task.status,
          error: failure.message,
        });
        this.onError(failure.message);
      });
    const page = request.background
      ? undefined
      : ((await this.waitForPage(pageIds[0], signal)) as Slide);
    return { taskId, status: task.status, pageIds, ...(page ? { page } : {}) };
  }

  private async showCodingExercise(
    id: string,
    draft: Pick<
      CodingExercise,
      "title" | "instructions" | "languageId" | "languageName" | "starterCode"
    >,
  ) {
    const existing = this.pageStore.find((page) => page.id === id);
    if (existing) {
      if (existing.kind !== "coding")
        throw new Error("页面 ID 已用于其他教学内容");
      await this.showPage(id, id, this.teacher.signal);
      return existing;
    }
    const exercise: CodingExercise = {
      kind: "coding",
      id,
      ...draft,
      code: draft.starterCode,
      stdin: "",
      status: "active",
    };
    this.pageStore.push(exercise);
    this.onPages([...this.pageStore], this.hasRunningVisualTask());
    await this.showPage(id, id, this.teacher.signal);
    return exercise;
  }

  private currentCodingExercise() {
    const visible = this.pageStore.find(
      (page) => page.id === this.currentPageId,
    );
    if (visible?.kind === "coding") return visible;
    const exercise = [...this.pageStore]
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
      [...this.pageStore],
      this.hasRunningVisualTask(),
    );
    return exercise;
  }
}
