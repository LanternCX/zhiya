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
  private pageSequence: string[] = [];
  private slideTask = 0;
  private cancellation = 0;
  private stopped = false;
  private streamingTeacherMessage = false;
  private messageSequence = 0;
  private teacherMessageId = 0;
  private narrationPlayback: {
    id: number;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  private currentPageId = "";
  private modelRetries = new Map<
    "teacher" | "slides" | "animation" | "outline-classifier",
    ModelRetryStatus
  >();
  private pendingTaskNotices: string[] = [];
  private pendingActiveNotices: string[] = [];
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
    private onMessage: (message: CourseMessage, replaceLast?: boolean) => void,
    private onPages: (pages: LessonPage[], generating: boolean) => void,
    private onSequence: (sequence: string[], currentPageId: string) => void,
    private onActivity: (activity: CourseActivity | null) => void,
    private onRetry: ModelRetryListener,
    private onError: (message: string) => void,
    initial: CourseConversationState,
    courseManagement: CourseManagement,
    codingLanguages: CodingTools["languages"],
    animationPlayback: Pick<AnimationTools, "control" | "playback">,
  ) {
    this.pageStore = [...initial.pages];
    this.pageSequence = [...initial.presentedPageIds];
    this.currentPageId = initial.currentPageId;
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
    };
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
        place: (pageId, position) => this.placeLessonPage(pageId, position),
        remove: (pageId) => this.removeLessonPage(pageId),
        show: (pageId) => this.showPage(pageId),
        next: () => this.presentNextPage(),
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
        this.onMessage(
          {
            id: this.teacherMessageId,
            role: "assistant",
            text,
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
    this.startOutlineTask(
      info,
      (classify) => courseManagement.resumeOutline(classify),
      false,
    );
  }

  get busy() {
    return this.teacher.state.isStreaming;
  }

  async prompt(text: string, materialNames: string[] = []) {
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
      return;
    }
    const operation = this.cancellation;
    try {
      await this.teacher.prompt(agentText);
      this.flushPendingActiveNotices();
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
    this.slideTask++;
    for (const task of this.slideAgents.values()) {
      if (task.status !== "running") continue;
      task.status = "cancelled";
      task.agent.abort();
    }
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
    const displayed = new Set(this.pageSequence);
    const summarize = (page: LessonPage) => ({
      pageId: page.id,
      kind: page.kind,
      title: page.title,
    });
    return {
      buffer: this.pageStore
        .filter((page) => !displayed.has(page.id))
        .map(summarize),
      displaySequence: this.pageSequence.map((pageId, index) => {
        const page = this.pageStore.find(
          (candidate) => candidate.id === pageId,
        );
        if (!page) throw new Error(`展示序列引用了不存在的页面 ${pageId}`);
        return { position: index + 1, ...summarize(page) };
      }),
      currentPageId: this.currentPageId,
    };
  }

  private placeLessonPage(pageId: string, position: number) {
    if (!this.pageStore.some((page) => page.id === pageId))
      throw new Error(`课堂页面 ${pageId} 尚未进入缓冲池`);
    const next = this.pageSequence.filter((id) => id !== pageId);
    if (!Number.isInteger(position) || position < 1 || position > next.length + 1)
      throw new Error(`页面位置必须在 1 到 ${next.length + 1} 之间`);
    next.splice(position - 1, 0, pageId);
    this.pageSequence = next;
    this.onSequence([...next], this.currentPageId);
    return this.readLessonPages();
  }

  private removeLessonPage(pageId: string) {
    const index = this.pageSequence.indexOf(pageId);
    if (index < 0) throw new Error(`课堂页面 ${pageId} 不在展示序列中`);
    this.pageSequence.splice(index, 1);
    if (this.currentPageId === pageId) {
      this.currentPageId =
        this.pageSequence[index] ?? this.pageSequence[index - 1] ?? "";
    }
    this.onSequence([...this.pageSequence], this.currentPageId);
    return this.readLessonPages();
  }

  private async showPage(pageId: string): Promise<LessonPage> {
    await this.waitForNarrationPlayback();
    const page = this.pageStore.find((candidate) => candidate.id === pageId);
    if (page && !this.pageSequence.includes(pageId))
      throw new Error(`请先把课堂页面 ${pageId} 放入展示序列`);
    if (page) return this.present(page);
    const task = [...this.animationTasks.values()].find(
      (candidate) => candidate.pageId === pageId,
    );
    const illustration = [...this.illustrationTasks.values()].find(
      (candidate) => candidate.pageId === pageId,
    );
    if (task?.status === "running" || illustration?.status === "running")
      throw new Error(`课堂页面 ${pageId} 仍在生成，尚未进入缓冲池`);
    if (task?.status === "failed")
      throw new Error(task.error || `页面 ${pageId} 生成失败`);
    if (illustration?.status === "failed")
      throw new Error(illustration.error || `页面 ${pageId} 生成失败`);
    throw new Error(`找不到课堂页面 ${pageId}`);
  }

  private cancelAnimation(taskId: string) {
    const task = this.animationTasks.get(taskId);
    if (!task || task.status !== "running") return;
    task.status = "cancelled";
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
    if (this.stopped) return;
    this.pendingTaskNotices.push(
      `Background page entered the unordered lesson-page buffer: ${JSON.stringify({ pageId: page.id, kind: page.kind, title: page.title })}. Treat this as internal state, not as a student request. Read the buffer before deciding whether to move this page into the display sequence. Do not change the display sequence, visible page, or user-visible narration solely because this page arrived.`,
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

  private present(page: LessonPage) {
    if (!this.pageSequence.includes(page.id))
      throw new Error(`课堂页面 ${page.id} 不在展示序列中`);
    this.currentPageId = page.id;
    this.onSequence([...this.pageSequence], page.id);
    return page;
  }

  selectLessonPage(pageId: string) {
    const page = this.pageStore.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error(`找不到课堂页面 ${pageId}`);
    return this.present(page);
  }

  private async presentNextPage(): Promise<LessonPage> {
    const operation = this.cancellation;
    await this.waitForNarrationPlayback();
    if (operation !== this.cancellation) throw new Error("教学播放已停止");
    const current = this.pageSequence.indexOf(this.currentPageId);
    const nextId = this.pageSequence[current + 1];
    if (!nextId) throw new Error("展示序列中没有下一页");
    const next = this.pageStore.find((page) => page.id === nextId);
    if (!next) throw new Error(`展示序列引用了不存在的页面 ${nextId}`);
    return this.present(next);
  }

  private startSlides(
    info: ModelInfo,
    memory: string,
    request: SlideRequest,
  ) {
    if (request.replaceCurrent) this.cancelSlides();
    const taskId = `slides-${++this.slideTask}`;
    const slides: Slide[] = [];
    const agent = createSlidesAgent({
      model: info,
      gateway: this.gateway,
      memory,
      onRetry: (status) => this.updateModelRetry("slides", status),
      publish: (id, page) => {
        const task = this.slideAgents.get(taskId);
        if (!task || task.status !== "running" || this.stopped)
          throw new Error("This slide task is no longer current.");
        if (this.pageStore.some((candidate) => candidate.id === id))
          throw new Error(`页面 ID 已被使用：${id}`);
        const slide: Slide = { kind: "slide", id, ...page };
        slides.push(slide);
        this.addToPageStore(slide);
        this.onPages(
          [...this.pageStore],
          slides.length < request.pageCount,
        );
        return slides.length;
      },
    });
    this.slideAgents.set(taskId, { agent, status: "running" });
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
        this.notifyTeacherOfTask({
          taskId,
          kind: "slides",
          status: task.status,
          error: failure.message,
        });
        this.onError(failure.message);
      });
    return { taskId, status: "running" as const };
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
    this.pageStore.push(exercise);
    const current = this.pageSequence.indexOf(this.currentPageId);
    this.pageSequence.splice(
      current < 0 ? this.pageSequence.length : current + 1,
      0,
      id,
    );
    this.onPages(
      [...this.pageStore],
      this.hasRunningVisualTask(),
    );
    this.present(exercise);
    return exercise;
  }

  private currentCodingExercise() {
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
