import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./course.css";
import type { CourseSession } from "../../pi";
import { createCourseSession } from "./runtime";
import type {
  CourseActivity,
  CourseMessage,
  LessonPage,
  AnimationPlaybackCommand,
  AnimationPlaybackState,
  ModelInfo,
  ModelRetryStatus,
  CourseConversationState,
  StoredCourseConversation,
  StoredCourse,
  CourseSection,
} from "../../domain/learning";
import { MessageResponse } from "../../components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningLiveSummary,
  ReasoningTrigger,
} from "../../components/ai-elements/reasoning";
import { Shimmer } from "../../components/ai-elements/shimmer";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "../../components/ai-elements/attachments";
import ChatComposer, {
  type ChatComposerMessage,
} from "../../components/ChatComposer";
import { Spinner } from "../../components/ui/spinner";
import SlideCanvas from "./SlideCanvas";
import AnimationCanvas, { type AnimationController } from "./AnimationCanvas";
import IllustrationCanvas from "./IllustrationCanvas";
import { listCodeLanguages, runCode } from "./code";
import CourseLibrary from "./CourseLibrary";
import Icon from "../../components/Icon";
import ConnectionRetry from "../../components/ConnectionRetry";
import { courseMaterialAttachments } from "./course-composer";
import { useElapsedSeconds } from "../../lib/use-elapsed-seconds";
import {
  createCourse,
  createCourseConversation as createStoredCourseConversation,
  emptyCourseState,
  getCourseMaterial,
  listCourseMaterials,
  reorganizeCourseOutline,
  resumeCourseOutlineReorganization,
  saveCourseConversation,
  updateCourse,
  uploadCourseMaterial,
} from "./courses";

type RenderedCourseMessage = CourseMessage;

const CodingPage = lazy(() => import("./CodingPage"));

const conversationControls = {
  code: { copy: true, download: false },
  image: false,
  mermaid: {
    copy: true,
    download: false,
    fullscreen: false,
    panZoom: false,
  },
  table: { copy: true, download: false, fullscreen: false },
} as const;

function Activity({ activity }: { activity: CourseActivity | null }) {
  if (!activity) return null;
  if (activity.kind === "thinking")
    return (
      <Reasoning
        className="course-activity course-thinking"
        isStreaming={activity.active}
      >
        <ReasoningTrigger
          className="course-thinking-trigger"
          getThinkingMessage={(streaming, seconds) =>
            streaming ? (
              <ReasoningLiveSummary
                status={`正在组织本次讲解… · ${seconds ?? 0} 秒`}
                preview={activity.text}
              />
            ) : (
              <span>讲解思路已整理</span>
            )
          }
        />
        {activity.text && <ReasoningContent>{activity.text}</ReasoningContent>}
      </Reasoning>
    );
  return <ToolActivity activity={activity} />;
}

function ToolActivity({
  activity,
}: {
  activity: Extract<CourseActivity, { kind: "tool" }>;
}) {
  const elapsed = useElapsedSeconds(activity.status === "running");

  return (
    <div
      className="course-activity course-tool-activity"
      data-status={activity.status}
      role="status"
    >
      {activity.status === "running" && <Spinner />}
      <span className="course-tool-mark" aria-hidden="true" />
      {activity.status === "running" ? (
        <Shimmer duration={1}>
          {`正在${activity.label} · ${elapsed ?? 0} 秒`}
        </Shimmer>
      ) : (
        <span>
          {activity.status === "error"
            ? `${activity.label}失败`
            : `${activity.label}完成`}
        </span>
      )}
    </div>
  );
}

export default function CourseRoom({
  info,
  memory,
  courses,
  activeCourse,
  coursesReady,
  newSession,
  entryRequest,
  libraryError,
  onEntryRequestHandled,
  onOpenCourse,
  onRenameCourse,
  onDeleteCourse,
  onCourseCreated,
  onCourseUpdated,
  onSwitchConversation,
  onEnterNextSection,
}: {
  info: ModelInfo | null;
  memory: string;
  courses: StoredCourse[];
  activeCourse: StoredCourse | null;
  coursesReady: boolean;
  newSession: boolean;
  entryRequest: {
    id: number;
    text: string;
    materialNames: string[];
    handoff?: boolean;
    conversationId?: string;
  } | null;
  libraryError: string;
  onEntryRequestHandled: (id: number) => void;
  onOpenCourse: (course: StoredCourse) => void;
  onRenameCourse: (course: StoredCourse, title: string) => Promise<boolean>;
  onDeleteCourse: (course: StoredCourse) => Promise<boolean>;
  onCourseCreated: (course: StoredCourse) => void;
  onCourseUpdated: (course: StoredCourse) => void;
  onSwitchConversation: (
    course: StoredCourse,
    conversation: StoredCourseConversation,
    handoff: string,
  ) => void;
  onEnterNextSection: (section: CourseSection) => Promise<void>;
}) {
  // Long-running sessions must notify the current page, not the route that
  // happened to be visible when generation started.
  const courseCallbacks = useRef<{
    onCourseCreated: typeof onCourseCreated;
    onCourseUpdated: typeof onCourseUpdated;
  } | null>(null);
  useLayoutEffect(() => {
    courseCallbacks.current = { onCourseCreated, onCourseUpdated };
    return () => {
      courseCallbacks.current = null;
    };
  }, [onCourseCreated, onCourseUpdated]);
  const initialState =
    activeCourse && newSession
      ? emptyCourseState()
      : (activeCourse?.state ?? emptyCourseState());
  const [messages, setMessages] = useState<RenderedCourseMessage[]>(
    initialState.messages,
  );
  const [pages, setPages] = useState<LessonPage[]>(initialState.pages);
  const [presented, setPresented] = useState<string[]>(
    () => [...initialState.presentedPageIds],
  );
  const [currentPageId, setCurrentPageId] = useState(
    () =>
      initialState.currentPageId ||
      initialState.presentedPageIds.at(-1) ||
      "",
  );
  const [busy, setBusy] = useState(false);
  const [codeRunning, setCodeRunning] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<CourseActivity | null>(null);
  const [generatingPages, setGeneratingPages] = useState(false);
  const [modelRetry, setModelRetry] = useState<ModelRetryStatus | null>(null);
  const [switchingSection, setSwitchingSection] = useState(false);
  const [course, setCourse] = useState<StoredCourse | null>(activeCourse);
  const messagesRef = useRef<RenderedCourseMessage[]>(initialState.messages);
  const pagesRef = useRef<LessonPage[]>(initialState.pages);
  const presentedRef = useRef<string[]>([...initialState.presentedPageIds]);
  const currentPageIdRef = useRef(initialState.currentPageId);
  const session = useRef<CourseSession | null>(null);
  const codeRunSequence = useRef(0);
  const sessionCourse = useRef<StoredCourse | null>(activeCourse);
  const boundConversationId = useRef<string | null>(
    activeCourse && !newSession ? activeCourse.conversationId : null,
  );
  const pendingSave = useRef<{
    course: StoredCourse;
    state: CourseConversationState;
  } | null>(null);
  const latestSnapshot = useRef<{
    course: StoredCourse;
    state: CourseConversationState;
  } | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const startedEntryRequest = useRef<number | null>(null);
  const pendingInitialMaterials = useRef<File[]>([]);
  const animationControllers = useRef(new Map<string, AnimationController>());
  const pendingAnimationCommands = useRef(
    new Map<string, AnimationPlaybackCommand[]>(),
  );
  const registerAnimationController = useCallback(
    (pageId: string, controller: AnimationController | null) => {
      if (!controller) {
        animationControllers.current.delete(pageId);
        return;
      }
      animationControllers.current.set(pageId, controller);
      const pending = pendingAnimationCommands.current.get(pageId) ?? [];
      pendingAnimationCommands.current.delete(pageId);
      for (const command of pending) controller.control(command);
    },
    [],
  );
  const flushCourseSave = async (): Promise<boolean> => {
    if (saveInFlight.current) {
      const saved = await saveInFlight.current;
      return (await flushCourseSave()) && saved;
    }
    if (!pendingSave.current) return true;
    const next = pendingSave.current;
    pendingSave.current = null;
    const saving = saveCourseConversation(next.course, next.state)
      .then(() => true)
      .catch(() => {
        setError("课程进度暂时无法保存");
        return false;
      });
    saveInFlight.current = saving;
    await saving;
    if (saveInFlight.current === saving) saveInFlight.current = null;
    if (pendingSave.current) return (await flushCourseSave()) && (await saving);
    return saving;
  };

  useEffect(() => {
    if (!info?.available || !coursesReady) return;
    const selectedCourse = activeCourse;
    const startsUnbound = Boolean(selectedCourse && newSession);
    const initial = startsUnbound
      ? emptyCourseState()
      : (selectedCourse?.state ?? emptyCourseState());
    sessionCourse.current = selectedCourse;
    boundConversationId.current = startsUnbound
      ? null
      : (selectedCourse?.conversationId ?? null);
    setCourse(selectedCourse);
    setMessages(initial.messages);
    messagesRef.current = initial.messages;
    setPages(initial.pages);
    pagesRef.current = initial.pages;
    setPresented([...initial.presentedPageIds]);
    presentedRef.current = [...initial.presentedPageIds];
    currentPageIdRef.current = initial.currentPageId;
    setCurrentPageId(
      initial.currentPageId ||
        initial.presentedPageIds.at(-1) ||
        "",
    );
    setBusy(false);
    setActivity(null);
    setModelRetry(null);
    setError("");
    const acceptUpdatedCourse = (updated: StoredCourse) => {
      const currentConversation = updated.sections
        ?.flatMap((section) => section.conversations)
        .find(
          (conversation) => conversation.id === boundConversationId.current,
        );
      const next = currentConversation
        ? {
            ...updated,
            conversationId: currentConversation.id,
            state: sessionCourse.current?.state ?? updated.state,
          }
        : updated;
      sessionCourse.current = next;
      setCourse(next);
      courseCallbacks.current?.onCourseUpdated(next);
      return next;
    };
    const current = createCourseSession(
      info,
      memory,
      (message, replaceLast) =>
        setMessages((all) => {
          const next = !replaceLast
            ? [...all, message]
            : [...all.slice(0, -1), message];
          messagesRef.current = next;
          return next;
        }),
      (next, generating) => {
        pagesRef.current = next;
        setPages(next);
        setGeneratingPages(generating);
      },
      (sequence, pageId) => {
        presentedRef.current = sequence;
        currentPageIdRef.current = pageId;
        setPresented(sequence);
        setCurrentPageId(pageId);
      },
      setActivity,
      setModelRetry,
      setError,
      initial,
      {
        get course() {
          return sessionCourse.current;
        },
        get currentConversationId() {
          return boundConversationId.current;
        },
        create: async (title, topic, cover) => {
          const created = await createCourse(title, topic, cover);
          boundConversationId.current = null;
          sessionCourse.current = created;
          setCourse(created);
          courseCallbacks.current?.onCourseCreated(created);
          const initialMaterials = pendingInitialMaterials.current;
          pendingInitialMaterials.current = [];
          if (initialMaterials.length) {
            const uploads = await Promise.allSettled(
              initialMaterials.map((file) =>
                uploadCourseMaterial(created.id, file),
              ),
            );
            const failed = uploads.filter(
              (result) => result.status === "rejected",
            ).length;
            if (failed)
              setError(
                failed === initialMaterials.length
                  ? "课程已建立，但教学材料上传失败，请在课程主页重试"
                  : `课程已建立，但有 ${failed} 份教学材料上传失败`,
              );
          }
          return created;
        },
        rename: async (title, topic) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          const updated = await updateCourse(sessionCourse.current.id, {
            title,
            ...(topic ? { topic } : {}),
          });
          const next = { ...updated, state: sessionCourse.current.state };
          sessionCourse.current = next;
          setCourse(next);
          courseCallbacks.current?.onCourseUpdated(next);
          return next;
        },
        setOutline: async (sections, classify) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          if (!classify) throw new Error("课程大纲调整缺少内容分类器");
          if (boundConversationId.current) {
            pendingSave.current = {
              course: sessionCourse.current,
              state: {
                ...sessionCourse.current.state,
                messages: messagesRef.current,
                pages: pagesRef.current,
                presentedPageIds: presentedRef.current,
              },
            };
            if (!(await flushCourseSave()))
              throw new Error("保存最新课程内容后才能调整大纲");
          }
          const updated = await reorganizeCourseOutline(
            sessionCourse.current.id,
            sections,
            classify,
          );
          return acceptUpdatedCourse(updated);
        },
        resumeOutline: async (classify) => {
          if (!sessionCourse.current) return null;
          const updated = await resumeCourseOutlineReorganization(
            sessionCourse.current.id,
            classify,
          );
          return updated ? acceptUpdatedCourse(updated) : null;
        },
        createConversation: async (sectionId, title) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          if (boundConversationId.current)
            throw new Error("当前学习对话已经建立");
          const section = sessionCourse.current.sections?.find(
            (candidate) => candidate.id === sectionId,
          );
          if (!section) {
            const available = (sessionCourse.current.sections ?? []).map(
              (candidate) => ({
                id: candidate.id,
                title: candidate.title,
              }),
            );
            throw new Error(
              `课程小节 ${sectionId} 不存在。请使用当前大纲中的真实小节：${JSON.stringify(available)}`,
            );
          }
          const conversation = await createStoredCourseConversation(
            sessionCourse.current.id,
            sectionId,
            title,
          );
          const state: CourseConversationState = {
            messages: messagesRef.current,
            pages: pagesRef.current,
            presentedPageIds: presentedRef.current,
            currentPageId: presentedRef.current.at(-1) ?? "",
          };
          boundConversationId.current = conversation.id;
          const updated = {
            ...sessionCourse.current,
            conversationId: conversation.id,
            state,
            sections: sessionCourse.current.sections?.map((section) =>
              section.id === sectionId
                ? {
                    ...section,
                    conversations: [
                      ...section.conversations,
                      { ...conversation, state },
                    ],
                  }
                : section,
            ),
          };
          sessionCourse.current = updated;
          setCourse(updated);
          courseCallbacks.current?.onCourseUpdated(updated);
          return conversation;
        },
        switchSection: async (sectionId, title) => {
          const currentCourse = sessionCourse.current;
          if (!currentCourse || !boundConversationId.current)
            throw new Error("当前没有可切换的学习对话");
          const section = currentCourse.sections?.find(
            (candidate) => candidate.id === sectionId,
          );
          if (!section) throw new Error(`课程小节 ${sectionId} 不存在`);
          pendingSave.current = {
            course: currentCourse,
            state: {
              messages: messagesRef.current,
              pages: pagesRef.current,
              presentedPageIds: presentedRef.current,
              currentPageId: currentPageIdRef.current,
            },
          };
          if (!(await flushCourseSave()))
            throw new Error("保存当前学习对话后才能切换小节");
          const conversation = await createStoredCourseConversation(
            currentCourse.id,
            sectionId,
            title,
          );
          const updated = {
            ...sessionCourse.current!,
            sections: sessionCourse.current!.sections?.map((candidate) =>
              candidate.id === sectionId
                ? {
                    ...candidate,
                    conversations: [...candidate.conversations, conversation],
                  }
                : candidate,
            ),
          };
          sessionCourse.current = updated;
          setCourse(updated);
          courseCallbacks.current?.onCourseUpdated(updated);
          return conversation;
        },
        listConversations: async () =>
          sessionCourse.current?.sections?.flatMap(
            (section) => section.conversations,
          ) ?? [],
        readConversation: async (conversationId) => {
          const conversation = sessionCourse.current?.sections
            ?.flatMap((section) => section.conversations)
            .find(({ id }) => id === conversationId);
          if (!conversation) throw new Error("找不到这条历史学习记录");
          return conversation;
        },
        listMaterials: async () => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          return listCourseMaterials(sessionCourse.current.id);
        },
        readMaterial: async (materialId) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          return getCourseMaterial(sessionCourse.current.id, materialId);
        },
      },
      listCodeLanguages,
      {
        control: (pageId, command) => {
          const controller = animationControllers.current.get(pageId);
          if (controller) return controller.control(command);
          const page = pagesRef.current.find(
            (candidate) => candidate.kind === "animation" && candidate.id === pageId,
          );
          if (!page) throw new Error(`找不到动画页面 ${pageId}`);
          pendingAnimationCommands.current.set(pageId, [
            ...(pendingAnimationCommands.current.get(pageId) ?? []),
            command,
          ]);
          return {
            pageId,
            status: "idle",
            step: 0,
            ...(command.action === "play" ? { buttonId: command.buttonId } : {}),
          } satisfies AnimationPlaybackState;
        },
        playback: (pageId) => {
          const controller = animationControllers.current.get(pageId);
          if (controller) return controller.read();
          const page = pagesRef.current.find(
            (candidate) => candidate.kind === "animation" && candidate.id === pageId,
          );
          if (!page) throw new Error(`找不到动画页面 ${pageId}`);
          return { pageId, status: "idle", step: 0 };
        },
      },
      async (conversation, handoff, isCurrent) => {
        const currentCourse = sessionCourse.current;
        if (!currentCourse) throw new Error("课程尚未建立");
        pendingSave.current = {
          course: currentCourse,
          state: {
            messages: messagesRef.current,
            pages: pagesRef.current,
            presentedPageIds: presentedRef.current,
            currentPageId: currentPageIdRef.current,
          },
        };
        if (!(await flushCourseSave()))
          throw new Error("保存当前学习对话后才能切换小节");
        if (!isCurrent()) return;
        onSwitchConversation(currentCourse, conversation, handoff);
      },
      entryRequest?.handoff &&
      entryRequest.conversationId === selectedCourse?.conversationId
        ? entryRequest.text
        : undefined,
    );
    session.current = current;
    return () => {
      codeRunSequence.current += 1;
      setCodeRunning(false);
      current.stop();
      if (session.current === current) session.current = null;
    };
  }, [info?.available, info?.id, memory, coursesReady]);

  useEffect(() => {
    if (
      !course ||
      !boundConversationId.current ||
      boundConversationId.current !== course.conversationId
    )
      return;
    const state = {
      messages,
      pages,
      presentedPageIds: presented,
      currentPageId,
    };
    const updated = {
      ...course,
      state,
      sections: course.sections?.map((section) => ({
        ...section,
        conversations: section.conversations.map((conversation) =>
          conversation.id === course.conversationId
            ? { ...conversation, state }
            : conversation,
        ),
      })),
    };
    sessionCourse.current = updated;
    latestSnapshot.current = { course, state };
    courseCallbacks.current?.onCourseUpdated(updated);
    const timer = window.setTimeout(() => {
      pendingSave.current = { course, state };
      void flushCourseSave();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    course?.id,
    course?.conversationId,
    messages,
    pages,
    presented,
    currentPageId,
  ]);

  useEffect(
    () => () => {
      const latest = latestSnapshot.current;
      if (!latest || latest.course.id !== course?.id) return;
      pendingSave.current = latest;
      void flushCourseSave();
    },
    [course?.id],
  );

  useEffect(() => {
    let latest: RenderedCourseMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === "assistant") {
        latest = messages[index];
        break;
      }
    }
    if (!latest || latest.streaming) return;
    session.current?.finishNarration(latest.id);
  }, [messages]);

  useEffect(() => {
    const element = thread.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages, activity]);

  const runPrompt = async (
    value: string,
    materialNames: string[] = [],
    clearError = true,
  ) => {
    if (!value || busy || !session.current) return;
    if (clearError) setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    await session.current.prompt(value, materialNames);
    setBusy(false);
  };
  const runHandoff = async () => {
    if (busy || !session.current) return;
    setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    await session.current.beginFromHandoff();
    setBusy(false);
  };
  useEffect(() => {
    if (!entryRequest) return;
    const timer = window.setTimeout(() => {
      if (!session.current || startedEntryRequest.current === entryRequest.id)
        return;
      if (
        entryRequest.conversationId &&
        boundConversationId.current !== entryRequest.conversationId
      )
        return;
      startedEntryRequest.current = entryRequest.id;
      onEntryRequestHandled(entryRequest.id);
      if (entryRequest.handoff) void runHandoff();
      else void runPrompt(entryRequest.text, entryRequest.materialNames);
    });
    return () => window.clearTimeout(timer);
  }, [entryRequest, onEntryRequestHandled]);
  const submit = async ({ text: input, files }: ChatComposerMessage) => {
    if (busy) throw new Error("The course session is busy");
    setError("");
    const requested = input.trim();
    if (!course) {
      pendingInitialMaterials.current = files;
      void runPrompt(
        requested || "请根据我附带的教学材料创建课程并开始教学。",
        files.map((file) => file.name),
      );
      return;
    }
    const uploads = await Promise.allSettled(
      files.map((file) => uploadCourseMaterial(course.id, file)),
    );
    const uploadedNames = uploads.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.name] : [],
    );
    const failed = uploads.length - uploadedNames.length;
    if (failed)
      setError(
        failed === uploads.length
          ? "教学材料上传失败，请重试"
          : `有 ${failed} 份教学材料上传失败`,
      );
    if (
      (!requested && uploadedNames.length === 0) ||
      (uploads.length > 0 && uploadedNames.length === 0)
    )
      throw new Error("No course material was uploaded");
    void runPrompt(
      requested || "请根据我附带的教学材料继续教学。",
      uploadedNames,
      failed === 0,
    );
  };
  const interrupt = () => {
    session.current?.stopCurrent();
    setActivity(null);
    setBusy(false);
  };
  const running = busy;
  const presentedPages = presented
    .map((id) => pages.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is LessonPage => Boolean(candidate));
  const current =
    presentedPages.find((candidate) => candidate.id === currentPageId) ??
    presentedPages.at(-1);

  useEffect(() => {
    const container = thread.current;
    if (!container || !current) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = [
        ...container.querySelectorAll<HTMLElement>(".course-message"),
      ].find((message) => message.dataset.pageId === current.id);
      if (!anchor) return;
      const top =
        container.scrollTop +
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      container.scrollTo({
        top,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [current?.id]);

  const presentedPage = current
    ? presentedPages.findIndex((candidate) => candidate.id === current.id)
    : -1;
  const previousPage = presentedPages[presentedPage - 1];
  const nextPage = presentedPages[presentedPage + 1];
  const canGoPrevious = !busy && !codeRunning && Boolean(previousPage);
  const canGoNext = !busy && !codeRunning && Boolean(nextPage);
  const orderedSections = [...(course?.sections ?? [])].sort(
    (left, right) => left.position - right.position,
  );
  const currentSectionIndex = orderedSections.findIndex((section) =>
    section.conversations.some(
      (conversation) => conversation.id === boundConversationId.current,
    ),
  );
  const nextSection =
    currentSectionIndex < 0
      ? undefined
      : orderedSections
          .slice(currentSectionIndex + 1)
          .find((section) => section.status !== "archived");
  const enterNextSection = async () => {
    const currentCourse = sessionCourse.current;
    if (
      !nextSection ||
      !currentCourse ||
      !boundConversationId.current ||
      busy ||
      switchingSection
    )
      return;
    setSwitchingSection(true);
    pendingSave.current = {
      course: currentCourse,
      state: {
        messages: messagesRef.current,
        pages: pagesRef.current,
        presentedPageIds: presentedRef.current,
        currentPageId: currentPageIdRef.current,
      },
    };
    try {
      if (await flushCourseSave()) await onEnterNextSection(nextSection);
    } catch {
      setError("暂时无法进入下一小节，请重试");
    } finally {
      setSwitchingSection(false);
    }
  };

  return (
    <section
      className="course-room ai-elements"
      aria-label="课堂"
      data-has-slides={Boolean(current)}
    >
      <section className="course-conversation" aria-label="教学对话">
        <div className="course-thread" aria-live="polite" ref={thread}>
          {messages.length === 0 ? (
            <div className="course-start">
              <div className="subject-art learning">
                <Icon name="learning" />
              </div>
              <h1>{course ? "开始新的学习对话" : "今天想学什么？"}</h1>
              {course ? (
                <p>从一个问题、例子或练习开始这次学习。</p>
              ) : (
                <CourseLibrary
                  courses={courses}
                  error={libraryError}
                  onOpen={onOpenCourse}
                  onRename={onRenameCourse}
                  onDelete={onDeleteCourse}
                />
              )}
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`course-message ${message.role}`}
                aria-current={
                  message.pageId && message.pageId === current?.id
                    ? "step"
                    : undefined
                }
                data-page-id={message.pageId}
              >
                <span>{message.role === "user" ? "我" : "知芽"}</span>
                {message.role === "assistant" ? (
                  <MessageResponse
                    className="course-message-body"
                    controls={conversationControls}
                    isAnimating={message.streaming}
                  >
                    {message.text}
                  </MessageResponse>
                ) : (
                  <>
                    <p>{message.text}</p>
                    {message.materials?.length ? (
                      <Attachments
                        className="course-message-materials"
                        variant="inline"
                      >
                        {message.materials.map((name) => (
                          <Attachment
                            data={{
                              id: name,
                              type: "file",
                              filename: name,
                              mediaType: name.endsWith(".md")
                                ? "text/markdown"
                                : "text/plain",
                              url: "",
                            }}
                            key={name}
                          >
                            <AttachmentPreview />
                            <AttachmentInfo />
                          </Attachment>
                        ))}
                      </Attachments>
                    ) : null}
                  </>
                )}
              </article>
            ))
          )}
          <Activity activity={activity} />
          {generatingPages &&
            !(
              activity?.kind === "tool" &&
              activity.name === "create_slides" &&
              activity.status === "running"
            ) && (
              <ToolActivity
                activity={{
                  kind: "tool",
                  name: "background-pages",
                  label: "准备课件",
                  status: "running",
                }}
              />
            )}
          <ConnectionRetry status={modelRetry} />
        </div>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {nextSection && (
          <div className="course-next-section">
            <button
              aria-label={`进入下一小节：${nextSection.title}`}
              disabled={
                !info?.available ||
                !coursesReady ||
                busy ||
                codeRunning ||
                switchingSection
              }
              onClick={() => void enterNextSection()}
              type="button"
            >
              <span>下一小节</span>
              <strong>{nextSection.title}</strong>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
        <ChatComposer
          attachments={courseMaterialAttachments}
          className="course-composer"
          disabled={!info?.available || !coursesReady}
          label="告诉知芽你想学什么"
          onError={setError}
          onStop={interrupt}
          onSubmit={submit}
          running={running}
          submitLabel="发送"
        />
      </section>

      {current && (
        <section className="slide-stage" aria-label="课堂页面">
          {pages
            .filter(
              (candidate) =>
                candidate.kind === "animation" &&
                presented.includes(candidate.id),
            )
            .map((animation) =>
              animation.kind === "animation" ? (
                <div
                  className="animation-page-slot"
                  hidden={current.id !== animation.id}
                  key={animation.id}
                >
                  <AnimationCanvas
                    active={current.id === animation.id}
                    page={animation}
                    onController={(controller) =>
                      registerAnimationController(animation.id, controller)
                    }
                  />
                </div>
              ) : null,
            )}
          {current.kind === "animation" ? null : current.kind === "slide" ? (
            <SlideCanvas key={current.id} slide={current} />
          ) : current.kind === "illustration" ? (
            course ? (
              <IllustrationCanvas
                courseId={course.id}
                key={current.id}
                page={current}
              />
            ) : null
          ) : current.kind === "coding" ? (
            <Suspense
              fallback={
                <div className="coding-page-loading" role="status">
                  正在加载代码编辑器…
                </div>
              }
            >
              <CodingPage
                key={current.id}
                exercise={current}
                running={codeRunning}
                onChange={(changes) =>
                  session.current?.updateCodingExercise(current.id, changes)
                }
                onRun={async () => {
                  const activeSession = session.current;
                  const runId = ++codeRunSequence.current;
                  setCodeRunning(true);
                  try {
                    setError("");
                    activeSession?.updateCodingExercise(current.id, {
                      result: undefined,
                    });
                    const result = await runCode(
                      current.languageId,
                      current.languageName,
                      current.code,
                      current.stdin,
                    );
                    if (
                      codeRunSequence.current !== runId ||
                      session.current !== activeSession
                    ) {
                      throw new Error("运行页面已切换，请重新运行代码");
                    }
                    activeSession?.updateCodingExercise(current.id, {
                      result,
                    });
                    return result;
                  } catch (error) {
                    const message =
                      error instanceof Error ? error.message : "代码暂时无法运行";
                    if (
                      codeRunSequence.current === runId &&
                      session.current === activeSession
                    ) {
                      setError(message);
                    }
                    throw new Error(message);
                  } finally {
                    if (codeRunSequence.current === runId) {
                      setCodeRunning(false);
                    }
                  }
                }}
                onEnd={async () => {
                  setBusy(true);
                  try {
                    await session.current?.requestExerciseReview();
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Suspense>
          ) : null}
          <footer className="slide-controls">
            <button
              aria-label="上一页"
              title="上一页"
              disabled={!canGoPrevious}
              onClick={() =>
                previousPage && session.current?.selectLessonPage(previousPage.id)
              }
            >
              ←
            </button>
            <span>{`${presentedPage + 1} / ${presentedPages.length}`}</span>
            <button
              aria-label="下一页"
              title="下一页"
              disabled={!canGoNext}
              onClick={() =>
                nextPage && session.current?.selectLessonPage(nextPage.id)
              }
            >
              →
            </button>
          </footer>
        </section>
      )}
    </section>
  );
}
