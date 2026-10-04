import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./course.css";
import "./course-room-layout-fix.css";
import ResizeHandle from "../../components/ResizeHandle";
import { createCourseSession } from "./runtime";
import DeliverableWorkspace from "../deliverables/DeliverableWorkspace";
import type { DeliverableSelection } from "../../../../../packages/learning/src/domain/deliverable";
import type {
  CourseActivity,
  MaterialPreparationProgress,
  CourseMessage,
  LessonPage,
  LessonPresentation,
  AnimationPlaybackCommand,
  ModelInfo,
  ModelRetryStatus,
  StoredCourseConversation,
  StoredCourse,
  CourseSection,
} from "../../../../../packages/learning/src/domain/learning";
import { CourseMessageResponse } from "./MaterialReference";
import MaterialParsingProgress from "./MaterialParsingProgress";
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
import { useSpeechPreference } from "../voice/useSpeechPreference";
import { Spinner } from "../../components/ui/spinner";
import AnimationCanvas, { type AnimationController } from "./AnimationCanvas";
import IllustrationCanvas from "./IllustrationCanvas";
import QuestionPage from "./QuestionPage";
import { runCode } from "./code";
import CourseLibrary from "./CourseLibrary";
import Icon from "../../components/Icon";
import ConnectionRetry from "../../components/ConnectionRetry";
import { WifiOffIcon } from "lucide-react";
import { courseMaterialAttachments } from "./course-composer";
import { useElapsedSeconds } from "../../lib/use-elapsed-seconds";
import { takeCompletedSentences } from "../../transport/speech";
import { VoiceSessionController } from "../voice/VoiceSessionController";
import { replaceVoicePlaybackText } from "../voice/VoicePlaybackText";
import type { InputMode } from "../../../../../packages/learning/src/domain/learning";
import { ResponsePresenter } from "../../../../../packages/learning/src/conversation/ResponsePresenter";
import { emptyCourseState, uploadCourseMaterials } from "./courses";

type RenderedCourseMessage = CourseMessage;

const CodingPage = lazy(() => import("./CodingPage"));
const SlideCanvas = lazy(() => import("./SlideCanvasCover"));

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
  if (activity.kind === "materials") return <MaterialParsingProgress progress={activity.progress} />;
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
  courses,
  activeCourse,
  conversationId,
  onConversationReady,
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
  onEnterNextSection,
}: {
  info: ModelInfo | null;
  memory: string;
  courses: StoredCourse[];
  activeCourse: StoredCourse | null;
  conversationId?: string;
  onConversationReady: (id: string) => void;
  coursesReady: boolean;
  newSession: boolean;
  entryRequest: {
    id: number;
    text: string;
    materialNames: string[];
    inputMode?: InputMode;
    inputMethod?: ChatComposerMessage["inputMethod"];
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
  onEnterNextSection: (
    section: CourseSection,
    request?: string,
  ) => Promise<void>;
}) {
  // Long-running sessions must notify the current page, not the route that
  // happened to be visible when generation started.
  const courseCallbacks = useRef<{
    onCourseCreated: typeof onCourseCreated;
    onCourseUpdated: typeof onCourseUpdated;
    onConversationReady: typeof onConversationReady;
  } | null>(null);
  useLayoutEffect(() => {
    courseCallbacks.current = {
      onCourseCreated,
      onCourseUpdated,
      onConversationReady,
    };
    return () => {
      courseCallbacks.current = null;
    };
  }, [onCourseCreated, onCourseUpdated, onConversationReady]);
  const initialState =
    activeCourse && newSession
      ? emptyCourseState()
      : (activeCourse?.state ?? emptyCourseState());
  const [messages, setMessages] = useState<RenderedCourseMessage[]>(
    initialState.messages,
  );
  const [pages, setPages] = useState<LessonPage[]>(initialState.pages);
  const [presented, setPresented] = useState<LessonPresentation[]>(() => [
    ...initialState.presentations,
  ]);
  const [currentPresentationId, setCurrentPresentationId] = useState(
    () =>
      initialState.currentPresentationId ||
      initialState.presentations.at(-1)?.id ||
      "",
  );
  const [busy, setBusy] = useState(false);
  const [deliverablesChanged, setDeliverablesChanged] = useState(0);
  const [deliverableSelection, setDeliverableSelection] = useState<DeliverableSelection | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const [liveVoice, setLiveVoice] = useState(false);
  const [speechReplies] = useSpeechPreference();
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const [voicePlaybackText, setVoicePlaybackText] = useState<
    Record<number, string>
  >({});
  const [codeRunning, setCodeRunning] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<CourseActivity | null>(null);
  const [materialProgress, setMaterialProgress] =
    useState<MaterialPreparationProgress | null>(null);
  const [generatingPages, setGeneratingPages] = useState(false);
  const [modelRetry, setModelRetry] = useState<ModelRetryStatus | null>(null);
  const [switchingSection, setSwitchingSection] = useState(false);
  const [course, setCourse] = useState<StoredCourse | null>(activeCourse);
  const [conversationWidth, setConversationWidth] = useState(420);
  const [resizingConversation, setResizingConversation] = useState(false);
  const handleConversationResize = useCallback((delta: number) => {
    setConversationWidth((width) => Math.max(320, Math.min(720, width + delta)));
  }, []);
  const messagesRef = useRef<RenderedCourseMessage[]>(initialState.messages);
  const pagesRef = useRef<LessonPage[]>(initialState.pages);
  const presentedRef = useRef<LessonPresentation[]>([
    ...initialState.presentations,
  ]);
  const currentPresentationIdRef = useRef(initialState.currentPresentationId);
  const session = useRef<ReturnType<typeof createCourseSession> | null>(null);
  const voiceController = useRef<VoiceSessionController | null>(null);
  const voiceStart = useRef<Promise<boolean> | null>(null);
  const narrationMessage = useRef<number | null>(null);
  const restoredNarrations = useRef(new Set<number>());
  const interruptedNarration = useRef<number | null>(null);
  const narrationConsumed = useRef(0);
  const queuedSpeech = useRef(0);
  const playedSpeech = useRef(0);
  const narrationComplete = useRef(false);
  const voiceScheduledText = useRef<Record<number, string>>({});
  const promptSequence = useRef(0);
  const codeRunSequence = useRef(0);
  const sessionCourse = useRef<StoredCourse | null>(activeCourse);
  const thread = useRef<HTMLDivElement | null>(null);
  const followThread = useRef(true);
  const startedEntryRequest = useRef<number | null>(null);
  const boundConversationId = useRef<string | null>(
    activeCourse && !newSession ? activeCourse.conversationId : null,
  );
  const startLiveVoice = (): Promise<boolean> => {
    if (voiceStart.current) return voiceStart.current;
    if (voiceController.current) return Promise.resolve(true);
    const controller = new VoiceSessionController(() =>
      session.current?.stopCurrent(),
    );
    controller.setSpeaker(true);
    controller.subscribe((state) => {
      if (!state.error) return;
      setNarrating(false);
      setError(state.error);
      const latest = narrationMessage.current;
      if (latest !== null) session.current?.finishNarration(latest);
      if (
        (state.status === "ended" ||
          state.errorKind === "tts" ||
          state.errorKind === "playback") &&
        voiceController.current === controller
      ) {
        voiceController.current = null;
        voiceStart.current = null;
        controller.end();
        setLiveVoice(false);
        setVoiceStarting(false);
      }
    });
    voiceController.current = controller;
    setVoiceStarting(true);
    const pending = controller
      .start()
      .then(async () => {
        if (voiceController.current !== controller) {
          controller.end();
          return false;
        }
        setLiveVoice(true);
        return true;
      })
      .catch((reason) => {
        if (voiceController.current === controller) {
          voiceController.current = null;
          controller.end();
          setLiveVoice(false);
          setError(
            reason instanceof Error ? reason.message : "无法启动语音对话",
          );
        }
        return false;
      })
      .finally(() => {
        if (voiceStart.current === pending) {
          voiceStart.current = null;
          setVoiceStarting(false);
        }
      });
    voiceStart.current = pending;
    return pending;
  };
  const endLiveVoice = () => {
    const controller = voiceController.current;
    voiceController.current = null;
    voiceStart.current = null;
    controller?.end();
    setNarrating(false);
    if (narrationMessage.current !== null)
      session.current?.finishNarration(narrationMessage.current);
    setLiveVoice(false);
    setVoiceStarting(false);
  };
  useEffect(
    () => () => {
      const controller = voiceController.current;
      voiceController.current = null;
      voiceStart.current = null;
      controller?.end();
    },
    [],
  );
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") endLiveVoice();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);
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

  useEffect(() => {
    if (!info?.available || !coursesReady) return;
    const seenAnimations = new Set<string>();
    let first = true;
    const current = createCourseSession(
      {
        courseId: activeCourse?.id,
        conversationId:
          conversationId ??
          (newSession ? undefined : activeCourse?.conversationId),
      },
      (snapshot) => {
        const initialSnapshot = first;
        first = false;
        if (
          snapshot.conversationId &&
          !snapshot.course?.sections?.some((section) =>
            section.conversations.some(
              (item) => item.id === snapshot.conversationId,
            ),
          )
        ) {
          courseCallbacks.current?.onConversationReady(snapshot.conversationId);
        }
        if (initialSnapshot) {
          restoredNarrations.current = new Set(
            snapshot.lesson.messages
              .filter((message) => !message.streaming)
              .map((message) => message.id),
          );
        }
        const nextCourse = snapshot.course
          ? {
              ...snapshot.course,
              conversationId: snapshot.conversationId,
              state: snapshot.lesson,
            }
          : null;
        const created = !sessionCourse.current && nextCourse;
        sessionCourse.current = nextCourse;
        boundConversationId.current = snapshot.conversationId || null;
        setCourse(nextCourse);
        if (nextCourse) {
          if (created) courseCallbacks.current?.onCourseCreated(nextCourse);
          else courseCallbacks.current?.onCourseUpdated(nextCourse);
        }
        messagesRef.current = snapshot.lesson.messages;
        pagesRef.current = snapshot.lesson.pages;
        presentedRef.current = snapshot.lesson.presentations;
        currentPresentationIdRef.current =
          snapshot.lesson.currentPresentationId;
        setMessages(snapshot.lesson.messages);
        setPages(snapshot.lesson.pages);
        setPresented(snapshot.lesson.presentations);
        setCurrentPresentationId(snapshot.lesson.currentPresentationId);
        setBusy(snapshot.busy);
        setDeliverablesChanged(snapshot.deliverablesChanged ?? 0);
        setDeliverableSelection(snapshot.deliverableSelection ?? null);
        setAgentRunning(
          snapshot.running ?? (snapshot.busy || snapshot.generating),
        );
        setGeneratingPages(snapshot.generating);
        setActivity(snapshot.activity ?? null);
        setModelRetry(snapshot.retry ?? null);
        if (snapshot.error) setError(snapshot.error);
        for (const animation of snapshot.animations ?? []) {
          if (seenAnimations.has(animation.id)) continue;
          seenAnimations.add(animation.id);
          if (initialSnapshot) continue;
          const controller = animationControllers.current.get(animation.pageId);
          if (controller) controller.control(animation.command);
          else
            pendingAnimationCommands.current.set(animation.pageId, [
              ...(pendingAnimationCommands.current.get(animation.pageId) ?? []),
              animation.command,
            ]);
        }
      },
      (message) => {
        setError(message);
        voiceController.current?.reportAgentError(message);
      },
      setSyncStatus,
    );
    session.current = current;
    return () => {
      codeRunSequence.current += 1;
      current.stop();
      if (session.current === current) session.current = null;
    };
  }, [info?.available, coursesReady]);

  useEffect(() => {
    let latest: RenderedCourseMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === "assistant") {
        latest = messages[index];
        break;
      }
    }
    if (!latest) return;
    if (
      !liveVoice ||
      latest.input_mode !== "speech" ||
      !voiceController.current
    ) {
      if (!latest.streaming) session.current?.finishNarration(latest.id);
      return;
    }
    // Only speech playback needs to skip completed responses restored from history.
    // Text can also finish in a teaching turn started by a background task.
    if (restoredNarrations.current.has(latest.id)) return;
    if (latest.id === interruptedNarration.current) return;
    if (latest.id !== narrationMessage.current) {
      interruptedNarration.current = null;
      narrationMessage.current = latest.id;
      narrationConsumed.current = 0;
      queuedSpeech.current = 0;
      playedSpeech.current = 0;
      narrationComplete.current = false;
      voiceScheduledText.current[latest.id] = "";
      setVoicePlaybackText((current) => ({ ...current, [latest.id]: "" }));
    }
    const spokenText = ResponsePresenter.present(
      latest.text,
      "speech",
    ).speech_text;
    if (latest.streaming && spokenText !== latest.text) return;
    const extracted = takeCompletedSentences(
      spokenText,
      narrationConsumed.current,
      !latest.streaming,
    );
    narrationConsumed.current = extracted.consumed;
    for (const sentence of extracted.sentences) {
      const messageId = latest.id;
      const baseText = voiceScheduledText.current[messageId] ?? "";
      voiceScheduledText.current[messageId] = `${baseText}${sentence}`;
      queuedSpeech.current += 1;
      setNarrating(true);
      const updateVisibleText = (visibleSentence: string) => {
        setVoicePlaybackText((current) =>
          replaceVoicePlaybackText(
            current,
            messageId,
            `${baseText}${visibleSentence}`,
          ),
        );
      };
      voiceController.current.speakText(
        sentence,
        () => {
          updateVisibleText(sentence);
          playedSpeech.current += 1;
          if (
            narrationComplete.current &&
            playedSpeech.current >= queuedSpeech.current
          ) {
            setNarrating(false);
            session.current?.finishNarration(messageId);
          }
        },
        updateVisibleText,
      );
    }
    if (!latest.streaming) {
      narrationComplete.current = true;
      if (playedSpeech.current >= queuedSpeech.current) {
        setNarrating(false);
        session.current?.finishNarration(latest.id);
      }
    }
  }, [messages, liveVoice]);

  useEffect(() => {
    const element = thread.current;
    if (!element || !followThread.current) return;
    element.scrollTo({
      top: element.scrollHeight,
      // Repeated smooth scrolling competes with the user's scroll gestures.
      behavior: "instant",
    });
  }, [messages, activity, materialProgress, voicePlaybackText, liveVoice]);

  const runPrompt = async (
    value: string,
    materialNames: string[] = [],
    clearError = true,
    inputMode: InputMode = "text",
  ) => {
    const current = session.current;
    if (!value || !current) return;
    if (current.busy) {
      await current.prompt(value, materialNames, inputMode);
      return;
    }
    const run = ++promptSequence.current;
    if (clearError) setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    await current.prompt(value, materialNames, inputMode);
    if (run === promptSequence.current && session.current === current)
      setBusy(false);
  };
  const runHandoff = async () => {
    const current = session.current;
    if (busy || !current) return;
    const run = ++promptSequence.current;
    setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    const speechReady = speechReplies && (await startLiveVoice());
    if (run !== promptSequence.current || session.current !== current) return;
    await current.beginFromHandoff(speechReady ? "speech" : "text");
    if (run === promptSequence.current && session.current === current)
      setBusy(false);
  };
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
  const enterNextSection = async (request?: string) => {
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
    try {
      await onEnterNextSection(nextSection, request);
    } catch {
      setError("暂时无法进入下一小节，请重试");
    } finally {
      setSwitchingSection(false);
    }
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
      else if (entryRequest.inputMode === "speech" || speechReplies) {
        void startLiveVoice().then((ready) => {
          if (entryRequest.text)
            void runPrompt(
              entryRequest.text,
              entryRequest.materialNames,
              ready,
              ready ? "speech" : "text",
            );
        });
      } else void runPrompt(entryRequest.text, entryRequest.materialNames);
    });
    return () => window.clearTimeout(timer);
  }, [entryRequest, onEntryRequestHandled]);
  const submit = async ({
    text: input,
    files,
    automatic = false,
    speakReplies = false,
  }: ChatComposerMessage) => {
    setError("");
    const requested = input.trim();
    const speechReady = speakReplies && (await startLiveVoice());
    const inputMode: InputMode = speechReady ? "speech" : "text";
    if ((busy || narrating) && (liveVoice || automatic)) {
      if (files.length) throw new Error("请先停止当前讲解，再发送新的材料");
      interrupt();
    } else if (busy) {
      if (files.length) throw new Error("请先停止当前讲解，再发送新的材料");
      if (requested) void runPrompt(requested);
      return;
    }
    if (!course) {
      await session.current?.materials(files);
      void runPrompt(
        requested || "请根据我附带的教学材料创建课程并开始教学。",
        files.map((file) => file.name),
        true,
        inputMode,
      );
      return;
    }
    setMaterialProgress(null);
    let uploadedNames: string[];
    try {
      const uploaded = await uploadCourseMaterials(course.id, files, setMaterialProgress);
      uploadedNames = uploaded.map(material => material.name);
    } catch (error) {
      setError("教学材料上传或解析失败，请重试");
      throw new Error("教学材料上传或解析失败，请重试", { cause: error });
    }
    setMaterialProgress(null);
    if (
      files.length === 0 &&
      nextSection &&
      /(?:想学|要学|进入|开始|学习|学|跳到|跳转到|去|切换到)\s*下(?:一)?(?:小节|节|章|关)/.test(
        requested,
      ) &&
      !/(?:不想|不要|别|不打算|暂时不|无需|不必)[^。！？]*下(?:一)?(?:小节|节|章|关)/.test(
        requested,
      )
    ) {
      await enterNextSection(requested);
      return;
    }
    void runPrompt(
      requested || "请根据我附带的教学材料继续教学。",
      uploadedNames,
      true,
      inputMode,
    );
  };
  const interrupt = () => {
    promptSequence.current++;
    interruptedNarration.current = narrationMessage.current;
    if (voiceController.current) voiceController.current.interrupt();
    else session.current?.stopCurrent();
    if (narrationMessage.current !== null)
      session.current?.finishNarration(narrationMessage.current);
    setActivity(null);
    setBusy(false);
    setNarrating(false);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !(busy || narrating)
      )
        return;
      event.preventDefault();
      interrupt();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, narrating, liveVoice]);
  const running = busy || narrating;
  const currentPresentation =
    presented.find((item) => item.id === currentPresentationId) ??
    presented.at(-1);
  const current = pages.find((page) => page.id === currentPresentation?.pageId);

  useEffect(() => {
    const container = thread.current;
    if (!container || !current) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = [
        ...container.querySelectorAll<HTMLElement>(".course-message"),
      ].find(
        (message) => message.dataset.presentationId === currentPresentation?.id,
      );
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
  }, [currentPresentation?.id, current?.id]);

  const presentedPage = currentPresentation
    ? presented.findIndex(
        (candidate) => candidate.id === currentPresentation.id,
      )
    : -1;
  const previousPage = presented[presentedPage - 1];
  const nextPage = presented[presentedPage + 1];
  const canGoPrevious = !codeRunning && Boolean(previousPage);
  const canGoNext = !codeRunning && Boolean(nextPage);

  return (
    <section
      className={`course-room ai-elements ${resizingConversation ? "is-resizing" : ""}`}
      aria-label="课堂"
      data-has-slides={Boolean(current || course)}
      style={{
        ["--course-conversation-width"]: `${conversationWidth}px`,
      } as CSSProperties}
    >
      <section className="course-conversation" aria-label="教学对话">
        <div
          className="course-thread"
          aria-live="polite"
          ref={thread}
          onScroll={(event) => {
            const element = event.currentTarget;
            followThread.current =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              24;
          }}
        >
          {messages.length === 0 && !busy && !activity && !materialProgress ? (
            <div className="course-start">
              <div className="subject-art learning">
                <Icon name="learning" />
              </div>
              <h1>{course ? "开始新的学习对话" : "今天想学什么？"}</h1>
              {course ? <p>从一个问题、例子或练习开始这次学习。</p> : null}
              {!course && (
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
            messages
              .filter((message) => !message.questionEvent)
              .map((message) => (
                <article
                  key={message.id}
                  className={`course-message ${message.role}`}
                  aria-current={
                    message.presentationId &&
                    message.presentationId === currentPresentation?.id
                      ? "step"
                      : undefined
                  }
                  data-page-id={message.pageId}
                  data-presentation-id={message.presentationId}
                >
                  <span>{message.role === "user" ? "我" : "知芽"}</span>
                  {message.role === "assistant" ? (
                    <CourseMessageResponse
                      courseId={course?.id}
                      className="course-message-body"
                      controls={conversationControls}
                      isAnimating={message.streaming}
                    >
                      {liveVoice &&
                      message.input_mode === "speech" &&
                      ResponsePresenter.present(message.text, "speech")
                        .speech_text === message.text &&
                      Object.prototype.hasOwnProperty.call(
                        voicePlaybackText,
                        message.id,
                      )
                        ? voicePlaybackText[message.id]
                        : message.text}
                    </CourseMessageResponse>
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
          <Activity activity={materialProgress ? { kind: "materials", progress: materialProgress } : activity} />
          {agentRunning && !materialProgress && activity?.kind !== "materials" && (
            <span
              className="agent-progress-icon"
              role="status"
              aria-label="生成状态"
              title="正在生成"
            >
              <Spinner
                aria-hidden="true"
                role={undefined}
                aria-label={undefined}
              />
            </span>
          )}
          {syncStatus === "reconnecting" && (
            <span
              className="agent-progress-icon"
              role="status"
              aria-label="实时同步"
              title="正在重新连接"
            >
              <WifiOffIcon size={16} aria-hidden="true" />
            </span>
          )}
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
          initialInputMode={entryRequest?.inputMethod}
          attachments={courseMaterialAttachments}
          className="course-composer"
          disabled={!info?.available || !coursesReady}
          label="告诉知芽你想学什么"
          onError={setError}
          onVoiceError={setError}
          onStop={interrupt}
          onSubmit={submit}
          onStartVoiceMode={startLiveVoice}
          voiceModeActive={liveVoice}
          voiceModeStarting={voiceStarting}
          onEndVoiceMode={endLiveVoice}
          running={running}
          submitLabel="发送"
        />
      </section>

      {(course || current) && <DeliverableWorkspace
        courseId={course?.id}
        changed={deliverablesChanged}
        sourceChanged={JSON.stringify({
          title: course?.title,
          topic: course?.topic,
          pages: pages.map((page) => {
            if (page.kind === "coding") return { ...page, code: page.starterCode, stdin: "", result: undefined };
            if (page.kind === "question") return { ...page, selected: [], answerText: "" };
            return page;
          }),
          order: [...new Set(presented.map(({ pageId }) => pageId))],
          ready: !agentRunning,
          sections: course?.sections?.map(({ id, title, objective, status }) => ({ id, title, objective, status })),
        })}
        selection={deliverableSelection}
        onSelect={async (id, blockId) => { await session.current?.selectDeliverable(id, blockId); }}
      >
      {current && (
        <ResizeHandle
          direction="horizontal"
          onResizeStart={() => setResizingConversation(true)}
          onResize={handleConversationResize}
          onResizeEnd={() => setResizingConversation(false)}
        />
      )}

      {current && (
        <section className="slide-stage" aria-label="课堂页面">
          {pages
            .filter(
              (candidate) =>
                candidate.kind === "animation" &&
                presented.some((item) => item.pageId === candidate.id),
            )
            .map((animation) =>
              animation.kind === "animation" ? (
                <div
                  className="animation-page-slot"
                  hidden={current.id !== animation.id}
                  key={animation.id}
                >
                  <AnimationCanvas
                    onPlayback={(state) =>
                      session.current?.animationPlayback(state)
                    }
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
            <Suspense
              fallback={
                <div className="lesson-slide" role="status">
                  正在排版课件…
                </div>
              }
            >
              <SlideCanvas key={current.id} slide={current} />
            </Suspense>
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
                      error instanceof Error
                        ? error.message
                        : "代码暂时无法运行";
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
          ) : current.kind === "question" ? (
            <QuestionPage
              key={current.id}
              question={current}
              onChange={(changes) =>
                session.current?.updateQuestion(current.id, changes)
              }
              onDefer={async () => {
                setBusy(true);
                try {
                  await session.current?.deferQuestion(current.id);
                } finally {
                  setBusy(false);
                }
              }}
              onSubmit={async () => {
                setBusy(true);
                try {
                  await session.current?.submitQuestion(current.id);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
          <footer className="slide-controls">
            <button
              aria-label="上一页"
              title="上一页"
              disabled={!canGoPrevious}
              onClick={() =>
                previousPage &&
                session.current?.selectPresentation(previousPage.id)
              }
            >
              ←
            </button>
            <span>{`${presentedPage + 1} / ${presented.length}`}</span>
            <button
              aria-label="下一页"
              title="下一页"
              disabled={!canGoNext}
              onClick={() =>
                nextPage && session.current?.selectPresentation(nextPage.id)
              }
            >
              →
            </button>
          </footer>
        </section>
      )}
      </DeliverableWorkspace>}
    </section>
  );
}
