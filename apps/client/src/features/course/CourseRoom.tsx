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
  StoredCourseConversation,
} from "../../domain/learning";
import { MessageResponse } from "../../components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../components/ai-elements/reasoning";
import { Shimmer } from "../../components/ai-elements/shimmer";
import { PromptInputSubmit } from "../../components/ai-elements/prompt-input";
import { Spinner } from "../../components/ui/spinner";
import SlideCanvas from "./SlideCanvas";
import { listCodeLanguages, runCode } from "./code";
import CourseLibrary from "./CourseLibrary";
import Icon from "../../components/Icon";
import ConnectionRetry from "../../components/ConnectionRetry";
import {
  createCourse,
  createCourseConversation as createStoredCourseConversation,
  emptyCourseState,
  getCourseMaterial,
  listCourseMaterials,
  replaceCourseOutline,
  saveCourseConversation,
  updateCourse,
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
  libraryError,
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
  libraryError: string;
  onOpenCourse: (course: StoredCourse) => void;
  onRenameCourse: (course: StoredCourse, title: string) => Promise<boolean>;
  onDeleteCourse: (course: StoredCourse) => Promise<boolean>;
  onCourseCreated: (course: StoredCourse) => void;
  onCourseUpdated: (course: StoredCourse) => void;
}) {
  const initialState = activeCourse?.state ?? emptyCourseState();
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<CourseActivity | null>(null);
  const [modelRetry, setModelRetry] = useState<ModelRetryStatus | null>(null);
  const [course, setCourse] = useState<StoredCourse | null>(activeCourse);
  const [conversationToken, setConversationToken] = useState(0);
  const messagesRef = useRef<RenderedCourseMessage[]>(initialState.messages);
  const pagesRef = useRef<LessonPage[]>(initialState.pages);
  const presentedRef = useRef<Set<string>>(
    new Set(initialState.presentedPageIds),
  );
  const pendingConversation = useRef<{
    conversation: StoredCourseConversation;
    messageStart: number;
    existingPageIds: Set<string>;
  } | null>(null);
  const session = useRef<CourseSession | null>(null);
  const sessionCourse = useRef<StoredCourse | null>(activeCourse);
  const pendingSave = useRef<{
    course: StoredCourse;
    state: CourseConversationState;
  } | null>(null);
  const latestSnapshot = useRef<{
    course: StoredCourse;
    state: CourseConversationState;
  } | null>(null);
  const saveInFlight = useRef(false);
  const thread = useRef<HTMLDivElement | null>(null);
  const flushCourseSave = async () => {
    if (saveInFlight.current || !pendingSave.current) return;
    const next = pendingSave.current;
    pendingSave.current = null;
    saveInFlight.current = true;
    try {
      await saveCourseConversation(next.course, next.state);
    } catch {
      setError("课程进度暂时无法保存");
    } finally {
      saveInFlight.current = false;
      if (pendingSave.current) void flushCourseSave();
    }
  };

  useEffect(() => {
    if (!info?.available || !coursesReady) return;
    const selectedCourse =
      sessionCourse.current?.id === activeCourse?.id
        ? sessionCourse.current
        : activeCourse;
    const initial = selectedCourse?.state ?? emptyCourseState();
    sessionCourse.current = selectedCourse;
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
      setError,
      initial,
      {
        course: selectedCourse,
        create: async (title, topic, cover) => {
          const created = await createCourse(title, topic, cover);
          sessionCourse.current = created;
          setCourse(created);
          onCourseCreated(created);
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
        setOutline: async (sections) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          const updated = await replaceCourseOutline(
            sessionCourse.current.id,
            sections,
          );
          const currentConversation = updated.sections
            ?.flatMap((section) => section.conversations)
            .find(
              (conversation) =>
                conversation.id === sessionCourse.current?.conversationId,
            );
          const next = currentConversation
            ? {
                ...updated,
                conversationId: currentConversation.id,
                state: sessionCourse.current.state,
              }
            : updated;
          sessionCourse.current = next;
          setCourse(next);
          onCourseUpdated(next);
          return next;
        },
        createConversation: async (sectionId, title) => {
          if (!sessionCourse.current) throw new Error("课程尚未建立");
          const conversation = await createStoredCourseConversation(
            sessionCourse.current.id,
            sectionId,
            title,
          );
          let lastUser = 0;
          for (
            let index = messagesRef.current.length - 1;
            index >= 0;
            index--
          ) {
            if (messagesRef.current[index].role === "user") {
              lastUser = index;
              break;
            }
          }
          pendingConversation.current = {
            conversation,
            messageStart: lastUser,
            existingPageIds: new Set(pagesRef.current.map(({ id }) => id)),
          };
          const updated = {
            ...sessionCourse.current,
            sections: sessionCourse.current.sections?.map((section) =>
              section.id === sectionId
                ? {
                    ...section,
                    conversations: [...section.conversations, conversation],
                  }
                : section,
            ),
          };
          sessionCourse.current = updated;
          setCourse(updated);
          onCourseUpdated(updated);
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
    return () => {
      current.stop();
      if (session.current === current) session.current = null;
    };
  }, [
    info?.available,
    info?.id,
    memory,
    roomToken,
    conversationToken,
    coursesReady,
  ]);

  useEffect(() => {
    if (!course) return;
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

  const runPrompt = async (value: string) => {
    if (!value || busy || !session.current) return;
    setError("");
    setActivity({ kind: "thinking", text: "", active: true });
    setBusy(true);
    await session.current.prompt(value);
    const pending = pendingConversation.current;
    if (pending && sessionCourse.current) {
      pendingConversation.current = null;
      const nextPages = pagesRef.current.filter(
        ({ id }) => !pending.existingPageIds.has(id),
      );
      const nextState: CourseConversationState = {
        messages: messagesRef.current.slice(pending.messageStart),
        pages: nextPages,
        presentedPageIds: nextPages
          .filter(({ id }) => presentedRef.current.has(id))
          .map(({ id }) => id),
        currentPageId: nextPages.at(-1)?.id ?? "",
      };
      const updated = {
        ...sessionCourse.current,
        conversationId: pending.conversation.id,
        state: nextState,
        sections: sessionCourse.current.sections?.map((section) => ({
          ...section,
          conversations: section.conversations.map((conversation) =>
            conversation.id === pending.conversation.id
              ? { ...conversation, state: nextState }
              : conversation,
          ),
        })),
      };
      messagesRef.current = nextState.messages;
      pagesRef.current = nextPages;
      presentedRef.current = new Set(nextState.presentedPageIds);
      sessionCourse.current = updated;
      setMessages(nextState.messages);
      setPages(nextPages);
      setPresented(new Set(nextState.presentedPageIds));
      setPage(Math.max(0, nextPages.length - 1));
      setCourse(updated);
      onCourseUpdated(updated);
      setConversationToken((token) => token + 1);
    }
    setBusy(false);
  };
  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    await runPrompt(value);
  };
  const interrupt = () => {
    session.current?.stopCurrent();
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
    !busy && previousPage >= 0 && presented.has(pages[previousPage]?.id ?? "");
  const canGoNext =
    !busy &&
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
                  <p>{message.text}</p>
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
        <form
          className="course-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor="course-prompt">
            告诉知芽你想学什么
          </label>
          <textarea
            id="course-prompt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="告诉知芽你想学什么…"
            disabled={!info?.available || !coursesReady}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <PromptInputSubmit
            aria-label={running ? "打断" : "发送"}
            className="course-submit"
            disabled={
              !running && (!text.trim() || !info?.available || !coursesReady)
            }
            onStop={interrupt}
            status={running ? "streaming" : "ready"}
            title={running ? "打断" : "发送"}
          />
        </form>
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
                onChange={(changes) =>
                  session.current?.updateCodingExercise(current.id, changes)
                }
                onRun={async () => {
                  try {
                    setError("");
                    const result = await runCode(
                      current.languageId,
                      current.code,
                      current.stdin,
                    );
                    session.current?.updateCodingExercise(current.id, {
                      result,
                    });
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "代码暂时无法运行",
                    );
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
