import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./course.css";
import type { CourseSession } from "../../pi";
import { createCourseSession } from "./runtime";
import type {
  CourseActivity,
  CourseMessage,
  LessonPage,
  ModelInfo,
  ModelRetryStatus,
  CourseConversationState,
  StoredCourse,
} from "../../domain/learning";
import { MessageResponse } from "../../components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
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
import { listCodeLanguages, runCode } from "./code";
import CourseLibrary from "./CourseLibrary";
import Icon from "../../components/Icon";
import ConnectionRetry from "../../components/ConnectionRetry";
import { NarrationPlayer } from "../../transport/speech";
import { TextChunker } from "../voice/TextChunker";
import { courseMaterialAttachments } from "./course-composer";
import { VoiceSessionController } from "../voice/VoiceSessionController";
import type { InputMode } from "../../domain/learning";
import { ResponsePresenter } from "../../conversation/ResponsePresenter";
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
              <Shimmer className="course-thinking-shimmer" duration={1}>
                正在思考教学节奏…
              </Shimmer>
            ) : (
              <span>{seconds ? `已思考 ${seconds} 秒` : "已完成思考"}</span>
            )
          }
        />
        {activity.text && <ReasoningContent>{activity.text}</ReasoningContent>}
      </Reasoning>
    );
  return (
    <div
      className="course-activity course-tool-activity"
      data-status={activity.status}
      role="status"
    >
      {activity.status === "running" && <Spinner />}
      <span className="course-tool-mark" aria-hidden="true" />
      {activity.status === "running" ? (
        <Shimmer duration={1}>{`正在${activity.label}`}</Shimmer>
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
  roomToken,
  newSession,
  entryRequest,
  libraryError,
  onEntryRequestHandled,
  onOpenCourse,
  onRenameCourse,
  onDeleteCourse,
  onCourseCreated,
  onCourseUpdated,
}: {
  info: ModelInfo | null;
  memory: string;
  courses: StoredCourse[];
  activeCourse: StoredCourse | null;
  coursesReady: boolean;
  roomToken: number;
  newSession: boolean;
  entryRequest: { id: number; text: string; materialNames: string[] } | null;
  libraryError: string;
  onEntryRequestHandled: (id: number) => void;
  onOpenCourse: (course: StoredCourse) => void;
  onRenameCourse: (course: StoredCourse, title: string) => Promise<boolean>;
  onDeleteCourse: (course: StoredCourse) => Promise<boolean>;
  onCourseCreated: (course: StoredCourse) => void;
  onCourseUpdated: (course: StoredCourse) => void;
}) {
  const initialState =
    activeCourse && newSession
      ? emptyCourseState()
      : (activeCourse?.state ?? emptyCourseState());
  const [messages, setMessages] = useState<RenderedCourseMessage[]>(
    initialState.messages,
  );
  const [pages, setPages] = useState<LessonPage[]>(initialState.pages);
  const [presented, setPresented] = useState<Set<string>>(
    () => new Set(initialState.presentedPageIds),
  );
  const [page, setPage] = useState(() =>
    Math.max(
      0,
      initialState.pages.findIndex(
        ({ id }) => id === initialState.currentPageId,
      ),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [codeRunning, setCodeRunning] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<CourseActivity | null>(null);
  const [modelRetry, setModelRetry] = useState<ModelRetryStatus | null>(null);
  const [course, setCourse] = useState<StoredCourse | null>(activeCourse);
  const messagesRef = useRef<RenderedCourseMessage[]>(initialState.messages);
  const pagesRef = useRef<LessonPage[]>(initialState.pages);
  const presentedRef = useRef<Set<string>>(
    new Set(initialState.presentedPageIds),
  );
  const session = useRef<CourseSession | null>(null);
  const codeRunSequence = useRef(0);
  const voiceEnabled = true;
  const [liveVoice, setLiveVoice] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceController = useRef<VoiceSessionController | null>(null);
  const narrationPlayer = useRef<NarrationPlayer | null>(null);
  const narrationMessage = useRef<number | null>(null);
  const narrationConsumed = useRef(0);
  const narrationChunker = useRef<TextChunker | null>(null);
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
  const startLiveVoice = () => {
    if (voiceController.current) return;
    const controller = new VoiceSessionController((text) => {
      if (text.trim()) setVoiceTranscript(text);
    }, () => session.current?.stopCurrent());
    voiceController.current = controller;
    setVoiceTranscript("");
    setLiveVoice(true);
    void controller.start().catch((reason) => {
      controller.end();
      if (voiceController.current === controller) voiceController.current = null;
      setLiveVoice(false);
      setVoiceMuted(false);
      setError(reason instanceof Error ? reason.message : "无法启动语音对话");
    });
  };
  const endLiveVoice = () => {
    voiceController.current?.end();
    voiceController.current = null;
    setLiveVoice(false);
    setVoiceMuted(false);
  };
  useEffect(() => endLiveVoice, []);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      voiceController.current?.handleVisibilityChange(true);
      voiceController.current = null;
      setLiveVoice(false);
      setVoiceMuted(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);
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
    setPresented(new Set(initial.presentedPageIds));
    presentedRef.current = new Set(initial.presentedPageIds);
    const initialPage = initial.pages.findIndex(
      (page) => page.id === initial.currentPageId,
    );
    setPage(Math.max(0, initialPage));
    setBusy(false);
    setActivity(null);
    setModelRetry(null);
    setError("");
    const acceptUpdatedCourse = (updated: StoredCourse) => {
      const currentConversation = updated.sections
        ?.flatMap((section) => section.conversations)
        .find(
          (conversation) =>
            conversation.id === boundConversationId.current,
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
      onCourseUpdated(next);
      return next;
    };
    const current = createCourseSession(
      info,
      memory,
      (message, replaceLast) => {
        if (message.role === "assistant" && message.streaming) {
          voiceController.current?.recordAgentText(message.text);
        }
        setMessages((all) => {
          const next = !replaceLast
            ? [...all, message]
            : [...all.slice(0, -1), message];
          messagesRef.current = next;
          return next;
        });
      },
      (next) => {
        pagesRef.current = next;
        setPages(next);
      },
      (pageId) => {
        setPresented((existing) => {
          const next = new Set(existing).add(pageId);
          presentedRef.current = next;
          return next;
        });
        setPages((existing) => {
          const index = existing.findIndex((page) => page.id === pageId);
          if (index >= 0) setPage(index);
          return existing;
        });
      },
      setActivity,
      setModelRetry,
      (message) => {
        setError(message);
        voiceController.current?.reportAgentError(message);
      },
      initial,
      {
        course: selectedCourse,
        currentConversationId: boundConversationId.current,
        create: async (title, topic, cover) => {
          const created = await createCourse(title, topic, cover);
          boundConversationId.current = null;
          sessionCourse.current = created;
          setCourse(created);
          onCourseCreated(created);
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
          onCourseUpdated(next);
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
                presentedPageIds: [...presentedRef.current],
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
          const conversation = await createStoredCourseConversation(
            sessionCourse.current.id,
            sectionId,
            title,
          );
          const state: CourseConversationState = {
            messages: messagesRef.current,
            pages: pagesRef.current,
            presentedPageIds: [...presentedRef.current],
            currentPageId: pagesRef.current.at(-1)?.id ?? "",
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
          onCourseUpdated(updated);
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
    );
    session.current = current;
    narrationPlayer.current?.stop();
    narrationPlayer.current = new NarrationPlayer(() => {
      const latest = messagesRef.current.at(-1);
      if (latest?.role === "assistant" && !latest.streaming) current.finishNarration(latest.id);
    });
    return () => {
      current.stop();
      narrationPlayer.current?.dispose();
      narrationPlayer.current = null;
      if (session.current === current) session.current = null;
    };
  }, [
    info?.available,
    info?.id,
    memory,
    roomToken,
    coursesReady,
  ]);

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
      presentedPageIds: [...presented],
      currentPageId: pages[page]?.id ?? "",
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
    onCourseUpdated(updated);
    const timer = window.setTimeout(() => {
      pendingSave.current = { course, state };
      void flushCourseSave();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [course?.id, course?.conversationId, messages, pages, presented, page]);

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
    if (!latest) return;
    if (latest.id !== narrationMessage.current) {
      narrationMessage.current = latest.id;
      narrationConsumed.current = 0;
      narrationChunker.current = new TextChunker();
    }
    const delta = latest.text.slice(narrationConsumed.current);
    narrationConsumed.current = latest.text.length;
    const sentences = narrationChunker.current?.push(delta, !latest.streaming) ?? [];
    if (!voiceEnabled) {
      if (!latest.streaming) session.current?.finishNarration(latest.id);
      return;
    }
    for (const sentence of sentences) {
      if (liveVoice) voiceController.current?.speakText(ResponsePresenter.present(sentence, "speech").speech_text);
      else void narrationPlayer.current?.speak(sentence);
    }
  }, [messages, voiceEnabled, liveVoice]);

  useEffect(() => {
    if (voiceEnabled) return;
    narrationPlayer.current?.stop();
    const latest = messagesRef.current.at(-1);
    if (latest?.role === "assistant" && !latest.streaming)
      session.current?.finishNarration(latest.id);
  }, [voiceEnabled]);

  useEffect(() => {
    if (liveVoice) return;
    voiceController.current?.setSpeaker(false);
  }, [liveVoice]);

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
    inputMode: InputMode = "text",
  ) => {
    if (!value || busy || !session.current) return;
    if (clearError) setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    await session.current.prompt(value, materialNames, inputMode);
    setBusy(false);
  };
  useEffect(() => {
    if (!entryRequest) return;
    const timer = window.setTimeout(() => {
      if (
        !session.current ||
        startedEntryRequest.current === entryRequest.id
      )
        return;
      startedEntryRequest.current = entryRequest.id;
      onEntryRequestHandled(entryRequest.id);
      void runPrompt(entryRequest.text, entryRequest.materialNames);
    });
    return () => window.clearTimeout(timer);
  }, [entryRequest, onEntryRequestHandled]);
  const submit = async ({ text: input, files }: ChatComposerMessage, inputMode: InputMode = "text") => {
    if (busy) throw new Error("The course session is busy");
    setError("");
    const requested = input.trim();
    if (!course) {
      pendingInitialMaterials.current = files;
      void runPrompt(
        requested || "请根据我附带的教学材料创建课程并开始教学。",
        files.map((file) => file.name),
        true,
        inputMode,
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
      inputMode,
    );
  };
  const interrupt = () => {
    if (voiceController.current) voiceController.current.interrupt();
    else session.current?.stopCurrent();
    setActivity(null);
    setBusy(false);
  };
  const running = busy;
  const current = pages[Math.min(page, Math.max(0, pages.length - 1))];

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

  const previousPage = page - 1;
  const nextPage = page + 1;
  const canGoPrevious =
    !busy &&
    !codeRunning &&
    previousPage >= 0 &&
    presented.has(pages[previousPage]?.id ?? "");
  const canGoNext =
    !busy &&
    !codeRunning &&
    nextPage < pages.length &&
    presented.has(pages[nextPage]?.id ?? "");

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
          <ConnectionRetry status={modelRetry} />
        </div>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <ChatComposer
          attachments={courseMaterialAttachments}
          className="course-composer"
          disabled={!info?.available || !coursesReady}
          label="告诉知芽你想学什么"
          onError={setError}
          onVoiceError={setError}
          onStop={interrupt}
          onSubmit={(message) => submit(message, liveVoice ? "speech" : "text")}
          voiceTranscript={voiceTranscript}
          onStartVoiceMode={startLiveVoice}
          voiceModeActive={liveVoice}
          voiceMuted={voiceMuted}
          onToggleVoiceMute={() => { const next = !voiceMuted; setVoiceMuted(next); voiceController.current?.setMuted(next); }}
          onEndVoiceMode={endLiveVoice}
          running={running}
          submitLabel="发送"
        />
      </section>

      {current && (
        <section className="slide-stage" aria-label="课堂页面">
          {current.kind === "slide" ? (
            <SlideCanvas key={current.id} slide={current} />
          ) : (
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
          )}
          <footer className="slide-controls">
            <button
              aria-label="上一页"
              title="上一页"
              disabled={!canGoPrevious}
              onClick={() => setPage(previousPage)}
            >
              ←
            </button>
            <span>{`${page + 1} / ${presented.size}`}</span>
            <button
              aria-label="下一页"
              title="下一页"
              disabled={!canGoNext}
              onClick={() => setPage(nextPage)}
            >
              →
            </button>
          </footer>
        </section>
      )}
    </section>
  );
}
