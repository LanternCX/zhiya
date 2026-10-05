import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { useAccount } from "./features/account/useAccount";
import AccountProfile from "./features/account/Profile";
import Security from "./features/account/Security";
import CourseRoom from "./features/course/CourseRoom";
import CourseOverview from "./features/course/CourseOverview";
import Profile from "./features/profile/Profile";
import ClassPage from "./features/classes/ClassPage";
import Mark from "./components/Mark";
import type { ComposerInputMode } from "./components/ChatComposer";
import Icon from "./components/Icon";
import ResizeHandle from "./components/ResizeHandle";
import ThemeToggle from "./components/ThemeToggle";
import LearningNavigation from "./components/LearningNavigation";
import {
  subscribeAgentStatuses,
  type AgentStatus,
  type ConversationSummary,
} from "./transport/agent";
import { Dialog as SidebarDialog } from "radix-ui";
import { useSpeechPreference } from "./features/voice/useSpeechPreference";
import { Volume2Icon } from "lucide-react";
import {
  createCourseConversation,
  deleteCourseConversation,
  deleteCourse,
  listCourses,
  emptyCourseState,
  updateCourse,
} from "./features/course/courses";
import type {
  CourseSection,
  InputMode,
  ModelInfo,
  StoredCourse,
  StoredCourseConversation,
} from "./domain/learning";
import "./workspace.css";
import { matchRoutes, useLocation, useNavigate } from "react-router";
import {
  conversationPath,
  independentConversationPath,
  coursePath,
  pageRoutes,
  returnPath,
  usePage,
} from "./routes";

export default function Workspace({
  account,
  feedback,
}: {
  account: ReturnType<typeof useAccount>;
  feedback: ReactNode;
}) {
  const page = usePage();
  const location = useLocation();
  const routeNavigate = useNavigate();
  const learningPage = [
    "learning",
    "course",
    "conversation",
    "independent-conversation",
    "new-conversation",
  ].includes(page);
  // A destination click takes effect before the router renders the next page.
  // Async course updates must respect that navigation even in the same tick.
  const learningNavigationIntent = useRef(learningPage);
  useLayoutEffect(() => {
    learningNavigationIntent.current = learningPage;
  }, [learningPage, location.pathname]);
  // Retain the route of the hidden classroom, matching its existing lifetime
  // when visiting account pages or the learning profile.
  const [retainedLearningLocation, retainLearningLocation] = useState(location);
  const learningLocation = learningPage ? location : retainedLearningLocation;
  const learningMatch = matchRoutes(pageRoutes, learningLocation)?.at(-1);
  const { courseId, conversationId } = learningMatch?.params ?? {};
  const { user, view, navigate, busy, logout } = account;
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const sidebarWidthRef = useRef(220);
  const [sidebarBlinkPhase, setSidebarBlinkPhase] = useState<
    "out" | "in" | null
  >(null);
  const blinkPhaseRef = useRef<"out" | "in" | null>(null);
  const blinkTimersRef = useRef<number[]>([]);
  const lastBlinkAtRef = useRef(0);
  const SIDEBAR_COLLAPSE_AT = 72;
  const clearBlinkTimers = useCallback(() => {
    blinkTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    blinkTimersRef.current = [];
  }, []);
  const setBlinkPhase = useCallback((phase: "out" | "in" | null) => {
    blinkPhaseRef.current = phase;
    setSidebarBlinkPhase(phase);
  }, []);
  useEffect(() => clearBlinkTimers, [clearBlinkTimers]);
  const applyCollapsed = useCallback(
    (next: boolean) => {
      if (next === collapsedRef.current) return;
      const reversingMidBlink = blinkPhaseRef.current !== null;
      collapsedRef.current = next;
      clearBlinkTimers();
      const now = performance.now();
      // 动画进行中反向拖动，或距上次眨眼不足一帧周期：直接落定不播动画
      if (reversingMidBlink || now - lastBlinkAtRef.current < 290) {
        setCollapsed(next);
        setBlinkPhase(null);
        return;
      }
      lastBlinkAtRef.current = now;
      // 第一阶段：旧内容（展开时是图标、收起时是完整内容）淡出
      setBlinkPhase("out");
      const outTimer = window.setTimeout(() => {
        // 侧栏已全空，此刻才切换布局（文字在这里才进入 DOM）
        setCollapsed(next);
        setBlinkPhase("in");
        const inTimer = window.setTimeout(() => setBlinkPhase(null), 150);
        blinkTimersRef.current.push(inTimer);
      }, 130);
      blinkTimersRef.current.push(outTimer);
    },
    [clearBlinkTimers, setBlinkPhase],
  );
  const handleSidebarResizeStart = useCallback(() => {
    if (collapsedRef.current) {
      sidebarWidthRef.current = 72;
      setSidebarWidth(72);
    }
  }, []);
  const handleSidebarResize = useCallback(
    (delta: number) => {
      const next = Math.min(360, Math.max(72, sidebarWidthRef.current + delta));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
      applyCollapsed(next <= SIDEBAR_COLLAPSE_AT);
    },
    [applyCollapsed],
  );
  const handleSidebarResizeEnd = useCallback(() => {
    if (sidebarWidthRef.current <= SIDEBAR_COLLAPSE_AT) {
      sidebarWidthRef.current = 220;
      setSidebarWidth(220);
    }
  }, []);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speechReplies, setSpeechReplies] = useSpeechPreference();
  const memoryOpen = page === "learning-profile";
  const classesOpen = page === "classes" || page === "class" || page === "class-management" || page === "class-shares";
  const [editingMemory, setEditingMemory] = useState(true);
  const [endingMemory, setEndingMemory] = useState(false);
  const [onboarding, setOnboarding] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const receiveOnboarding = useCallback((value: boolean) => {
    setOnboarding(value);
    setProfileReady(true);
  }, []);
  const [learningContext, setLearningContext] = useState<{
    memory: string;
    model: ModelInfo | null;
  }>({ memory: "", model: null });
  const [courses, setCourses] = useState<StoredCourse[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    ConversationSummary[]
  >([]);
  const independentConversation =
    learningMatch?.route.id === "independent-conversation";
  const stableConversationId = useRef<string | null>(null);
  const assignedCourseId =
    courseId ??
    conversationHistory.find((item) => item.id === conversationId)?.courseId;
  const storedCourse = courses.find((course) => course.id === assignedCourseId);
  const conversation = storedCourse?.sections
    ?.flatMap((section) => section.conversations)
    .find((item) => item.id === conversationId);
  const activeCourse = storedCourse
    ? conversation
      ? {
          ...storedCourse,
          conversationId: conversation.id,
          state: conversation.state,
        }
      : independentConversation && conversationId
        ? { ...storedCourse, conversationId, state: emptyCourseState() }
        : storedCourse
    : null;
  const courseLevel =
    learningMatch?.route.id === "course" ? "course" : "conversation";
  const [coursesReady, setCoursesReady] = useState(false);
  const [coursesLoadError, setCoursesLoadError] = useState(false);
  const courseRoomToken: string =
    learningLocation.state?.roomKey ?? learningLocation.key;
  const newSession = learningMatch?.route.id === "new-conversation";
  const [courseEntryRequest, setCourseEntryRequest] = useState<{
    id: number;
    text: string;
    materialNames: string[];
    inputMode?: InputMode;
    inputMethod?: ComposerInputMode;
    handoff?: boolean;
    conversationId?: string;
  } | null>(null);
  const [courseError, setCourseError] = useState("");
  const routeError =
    page === "not-found"
      ? "页面不存在"
      : learningPage && courseId && coursesReady
        ? !storedCourse
          ? courseError || "课程不存在或无法访问"
          : conversationId && !conversation
            ? "学习对话不存在或无法访问"
            : ""
        : "";
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onboardingExit = useRef<HTMLButtonElement>(null);
  const sectionConversationRequests = useRef(new Set<string>());
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (learningPage) retainLearningLocation(location);
  }, [learningPage, location]);
  useEffect(() => {
    const screen = window.matchMedia("(max-width: 720px)");
    const closeOnDesktop = () => {
      if (!screen.matches) setMobileNavigationOpen(false);
    };
    screen.addEventListener("change", closeOnDesktop);
    return () => screen.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!user) return;
    let current = true;
    setCoursesReady(false);
    setCoursesLoadError(false);
    void listCourses()
      .then((next) => {
        if (!current) return;
        setCourses(next);
        setCourseError("");
      })
      .catch(() => {
        if (!current) return;
        setCourseError("暂时无法读取课程");
        setCoursesLoadError(true);
      })
      .finally(() => current && setCoursesReady(true));
    return () => {
      current = false;
    };
  }, [user?.id]);
  useEffect(() => {
    setAgentStatuses([]);
    setConversationHistory([]);
    if (!user) return;
    let current = true;
    let previous: AgentStatus[] | undefined;
    let refresh = 0;
    const close = subscribeAgentStatuses((next, conversations) => {
      if (!current) return;
      setAgentStatuses(next);
      if (conversations) setConversationHistory(conversations);
      const changed =
        previous &&
        next.some((status) => {
          const old = previous!.find((item) => item.id === status.id);
          return (
            !old ||
            old.conversationId !== status.conversationId ||
            (old.running && !status.running)
          );
        });
      previous = next;
      if (changed) {
        const version = ++refresh;
        void listCourses()
          .then((courses) => {
            if (current && version === refresh) {
              setCourses((all) => {
                const merged = courses.map((course) => {
                  const local = all.find((item) => item.id === course.id);
                  if (!local) return course;
                  const known = new Set(
                    course.sections?.flatMap((section) =>
                      section.conversations.map((item) => item.id),
                    ),
                  );
                  // A list request can precede a newer projection. Never remove
                  // conversations that arrived over the live stream meanwhile.
                  if (
                    local.sections?.some((section) =>
                      section.conversations.some((item) => !known.has(item.id)),
                    )
                  )
                    return local;
                  return course;
                });
                return [
                  ...merged,
                  ...all.filter(
                    (course) => !courses.some((item) => item.id === course.id),
                  ),
                ];
              });
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      current = false;
      close();
    };
  }, [user?.id]);
  useEffect(() => {
    if (!profileReady) return;
    if (onboarding && page !== "onboarding") {
      void routeNavigate(
        `/onboarding?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
        { replace: true },
      );
    } else if (!onboarding && page === "onboarding") {
      void routeNavigate(returnPath(location.search), { replace: true });
    }
  }, [
    profileReady,
    onboarding,
    page,
    location.pathname,
    location.search,
    routeNavigate,
  ]);
  useEffect(() => {
    if (wasConfirming.current && !account.confirmation)
      (onboarding ? onboardingExit : trigger).current?.focus();
    wasConfirming.current = Boolean(account.confirmation);
  }, [account.confirmation, onboarding]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  if (!user) return null;
  const titles: Record<string, string> = {
    profile: "个人资料",
    security: "账号安全",
    password: "修改密码",
    email: "更换邮箱",
    delete: "注销账号",
  };
  const goLearn = () => {
    learningNavigationIntent.current = true;
    setMobileNavigationOpen(false);
    void routeNavigate("/learn");
  };
  const locateSession = (course: StoredCourse) => {
    const pathname =
      course.conversationId &&
      (independentConversation ||
        stableConversationId.current === course.conversationId)
        ? independentConversationPath(course.conversationId)
        : course.conversationId
          ? conversationPath(course.id, course.conversationId)
          : `${coursePath(course.id)}/conversations/new`;
    if (learningLocation.pathname === pathname) return;
    const state = { roomKey: courseRoomToken };
    if (learningNavigationIntent.current)
      void routeNavigate(pathname, { replace: true, state });
    else retainLearningLocation({ ...learningLocation, pathname, state });
  };
  const renameCourse = async (course: StoredCourse, title: string) => {
    try {
      const updated = await updateCourse(course.id, { title });
      setCourses((all) =>
        all.map((item) => (item.id === updated.id ? updated : item)),
      );
      setCourseError("");
      return true;
    } catch {
      setCourseError("暂时无法重命名课程");
      return false;
    }
  };
  const removeCourse = async (course: StoredCourse) => {
    try {
      await deleteCourse(course.id);
      const remaining = courses.filter((item) => item.id !== course.id);
      setCourses(remaining);
      setConversationHistory((all) =>
        all.filter((item) => item.courseId !== course.id),
      );
      setCourseError("");
      return true;
    } catch {
      setCourseError("暂时无法删除课程");
      return false;
    }
  };
  const courseOpen =
    learningPage && view === "home" && !memoryOpen && Boolean(activeCourse);
  const activeSection = activeCourse?.sections?.find((section) =>
    section.conversations.some(
      (conversation) => conversation.id === activeCourse.conversationId,
    ),
  );
  const openConversation = (
    conversation: StoredCourseConversation,
    source = activeCourse,
  ) => {
    if (!source) return;
    const updated = {
      ...source,
      conversationId: conversation.id,
      state: conversation.state,
    };
    setCourses((all) =>
      all.map((item) => (item.id === updated.id ? updated : item)),
    );
    void routeNavigate(conversationPath(source.id, conversation.id));
  };
  const createSectionConversation = async (
    section: CourseSection,
    request?: string,
    materialNames: string[] = [],
    inputMode: InputMode = "text",
    inputMethod?: ComposerInputMode,
  ) => {
    if (!activeCourse || sectionConversationRequests.current.has(section.id))
      return;
    sectionConversationRequests.current.add(section.id);
    try {
      const conversation = await createCourseConversation(
        activeCourse.id,
        section.id,
        section.conversations.length === 0 ? "第一次学习" : "新一轮学习",
      );
      const updated = {
        ...activeCourse,
        sections: activeCourse.sections?.map((item) =>
          item.id === section.id
            ? {
                ...item,
                conversations: [...item.conversations, conversation],
              }
            : item,
        ),
      };
      setCourseError("");
      openConversation(conversation, updated);
      if (request)
        setCourseEntryRequest({
          id: Date.now(),
          text: request,
          materialNames,
          inputMode,
          inputMethod,
          conversationId: conversation.id,
        });
    } catch {
      setCourseError("暂时无法开始新的学习");
      throw new Error("Could not create the section conversation");
    } finally {
      sectionConversationRequests.current.delete(section.id);
    }
  };
  const removeSectionConversation = async (
    section: CourseSection,
    conversation: StoredCourseConversation,
  ) => {
    if (!activeCourse) return false;
    try {
      const updated = await deleteCourseConversation(
        activeCourse.id,
        section.id,
        conversation.id,
      );
      setConversationHistory((all) =>
        all.filter((item) => item.id !== conversation.id),
      );
      setCourses((all) =>
        all.map((item) => (item.id === updated.id ? updated : item)),
      );
      setCourseError("");
      return true;
    } catch {
      setCourseError("暂时无法删除学习记录");
      return false;
    }
  };
  const navigation = (
    <LearningNavigation
      courses={courses}
      statuses={agentStatuses}
      conversations={conversationHistory}
      ready={coursesReady}
      loadError={coursesLoadError}
      onNavigate={() => {
        learningNavigationIntent.current = true;
        setMobileNavigationOpen(false);
      }}
      onLearn={goLearn}
      onClasses={() => {
        learningNavigationIntent.current = false;
        setMobileNavigationOpen(false);
      }}
    />
  );
  return (
    <div
      className={`workspace ${collapsed ? "is-collapsed" : ""} ${onboarding ? "is-onboarding" : ""} ${sidebarBlinkPhase ? `is-sidebar-blinking-${sidebarBlinkPhase}` : ""}`}
      style={
        onboarding || (collapsed && collapsedRef.current)
          ? undefined
          : ({
              ["--workspace-sidebar-width"]: `${sidebarWidth}px`,
            } as CSSProperties)
      }
    >
      <SidebarDialog.Root
        open={mobileNavigationOpen && !onboarding}
        onOpenChange={setMobileNavigationOpen}
      >
        <aside
          hidden={onboarding}
          className="workspace-sidebar"
          aria-label="侧栏"
        >
          <div className="workspace-sidebar-header">
            <div className="workspace-brand">
              <Mark />
              <span>知芽</span>
            </div>
            <button
              className="icon-button sidebar-toggle"
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              aria-expanded={!collapsed}
              onClick={() => applyCollapsed(!collapsedRef.current)}
            >
              <Icon name="sidebar" />
            </button>
          </div>
          {navigation}
          <div className="workspace-account">
            <button
              ref={trigger}
              className="user-trigger"
              aria-label="用户菜单"
              aria-expanded={menuOpen}
              aria-controls="user-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="user-avatar">
                {user.avatar ? (
                  <img src={user.avatar} alt="" />
                ) : (
                  <Icon name="profile" />
                )}
              </span>
              <span className="user-name">{user.nickname}</span>
              <Icon name="more" />
            </button>
            <div
              ref={menu}
              hidden={!menuOpen}
              id="user-menu"
              className="user-popover"
              aria-label="用户设置"
            >
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  void routeNavigate("/learning-profile");
                }}
              >
                <Icon name="notebook" />
                学习档案
              </button>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  void navigate("profile");
                }}
              >
                <Icon name="profile" />
                个人资料
              </button>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  void navigate("security");
                }}
              >
                <Icon name="shield" />
                账号安全
              </button>
              <div className="appearance-row">
                <span>外观</span>
                <ThemeToggle />
              </div>
              <button
                role="switch"
                aria-checked={speechReplies}
                aria-label="语音播报"
                onClick={() => setSpeechReplies(!speechReplies)}
              >
                <Volume2Icon />
                语音播报
                <span className="speech-preference-switch" aria-hidden="true" />
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  void logout(false);
                }}
              >
                <Icon name="logout" />
                退出登录
              </button>
            </div>
          </div>
        </aside>
        {!onboarding && (
          <ResizeHandle
            className="workspace-sidebar-resize"
            onResizeStart={handleSidebarResizeStart}
            onResize={handleSidebarResize}
            onResizeEnd={handleSidebarResizeEnd}
          />
        )}
        <div className="workspace-body">
          <header hidden={onboarding} className="workspace-toolbar">
            <SidebarDialog.Trigger asChild>
              <button
                className="icon-button mobile-sidebar-toggle"
                aria-label="打开侧栏"
              >
                <Icon name="sidebar" />
              </button>
            </SidebarDialog.Trigger>
            {(view !== "home" || memoryOpen || courseOpen) && (
              <button
                className="icon-button"
                aria-label={
                  courseOpen
                    ? courseLevel === "conversation"
                      ? "返回课程"
                      : "返回课程列表"
                    : memoryOpen && !editingMemory
                      ? "停止对话"
                      : "返回学习"
                }
                title={
                  courseOpen
                    ? courseLevel === "conversation"
                      ? "返回课程"
                      : "返回课程列表"
                    : memoryOpen && !editingMemory
                      ? "停止对话"
                      : "返回学习"
                }
                disabled={endingMemory}
                onClick={() => {
                  if (courseOpen) {
                    if (courseLevel === "conversation") {
                      void routeNavigate(coursePath(activeCourse!.id));
                    } else {
                      void routeNavigate("/learn");
                    }
                  } else if (memoryOpen && !editingMemory) {
                    setEndingMemory(true);
                  } else {
                    goLearn();
                  }
                }}
              >
                <Icon
                  name={
                    !courseOpen && memoryOpen && !editingMemory
                      ? "close"
                      : "back"
                  }
                />
              </button>
            )}
            <span>
              {courseOpen
                ? courseLevel === "conversation"
                  ? (activeSection?.title ?? activeCourse?.title)
                  : activeCourse?.title
                : memoryOpen
                  ? "学习档案"
                  : view === "home"
                    ? classesOpen ? "我的班级" : onboarding
                      ? "初次见面"
                      : "学习地图"
                    : titles[view]}
            </span>
          </header>
          <main className="workspace-content" aria-busy={busy}>
            {onboarding && (
              <div className="onboarding-controls">
                <button
                  ref={onboardingExit}
                  className="icon-button"
                  aria-label="退出建档"
                  title="退出建档"
                  disabled={busy}
                  onClick={() => void logout(false, "onboarding")}
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            {feedback}
            <Profile
              user={user}
              visible={onboarding || (view === "home" && memoryOpen)}
              memoryOpen={!onboarding && memoryOpen}
              editing={editingMemory}
              setEditing={setEditingMemory}
              ending={endingMemory}
              setEnding={setEndingMemory}
              onOnboardingChange={receiveOnboarding}
              onContextChange={setLearningContext}
            />
            {!onboarding && routeError && (
              <section className="workspace-empty">
                <h1>{routeError}</h1>
                <button
                  className="text-button"
                  onClick={() => void routeNavigate("/learn")}
                >
                  返回学习
                </button>
              </section>
            )}
            {!onboarding && classesOpen && <ClassPage key={location.pathname} user={user} management={page === "class-management"} materials={page === "class-shares"} />}
            {!onboarding && learningPage && courseId && !coursesReady && (
              <p role="status">正在读取课程…</p>
            )}
            {!onboarding &&
              !memoryOpen &&
              !routeError &&
              (!courseId || coursesReady) && (
                <section
                  className="course-surface"
                  data-hidden={!learningPage}
                  aria-label="学习空间"
                >
                  {activeCourse && courseLevel === "course" && (
                    <CourseOverview
                      course={activeCourse}
                      courseError={courseError}
                      onOpenSection={(section: CourseSection) => {
                        const latest = [...section.conversations].sort((a, b) =>
                          b.updatedAt.localeCompare(a.updatedAt),
                        )[0];
                        if (latest) openConversation(latest);
                        else {
                          void createSectionConversation(
                            section,
                            `请开始${section.title}的学习。`,
                            [],
                          ).catch(() => undefined);
                        }
                      }}
                      onOpenConversation={(conversation) =>
                        openConversation(conversation)
                      }
                      onCreateConversation={(
                        section,
                        request,
                        materialNames,
                        inputMode,
                        inputMethod,
                      ) =>
                        createSectionConversation(
                          section,
                          request,
                          materialNames,
                          inputMode,
                          inputMethod,
                        )
                      }
                      onDeleteConversation={(section, conversation) =>
                        removeSectionConversation(section, conversation)
                      }
                      onStartLearning={(
                        text,
                        materialNames,
                        inputMode,
                        inputMethod,
                      ) => {
                        void routeNavigate(
                          `${coursePath(activeCourse.id)}/conversations/new`,
                        );
                        setCourseEntryRequest({
                          id: Date.now(),
                          text,
                          materialNames,
                          inputMode,
                          inputMethod,
                        });
                      }}
                    />
                  )}
                  {(!activeCourse || courseLevel === "conversation") && (
                    <CourseRoom
                      key={courseRoomToken}
                      visible={learningPage && view === "home"}
                      info={learningContext.model}
                      memory={learningContext.memory}
                      courses={courses}
                      activeCourse={activeCourse}
                      conversationId={
                        independentConversation ? conversationId : undefined
                      }
                      onConversationReady={(id) => {
                        stableConversationId.current = id;
                        const pathname = independentConversationPath(id);
                        if (learningLocation.pathname === pathname) return;
                        const state = { roomKey: courseRoomToken };
                        if (learningNavigationIntent.current)
                          void routeNavigate(pathname, {
                            replace: true,
                            state,
                          });
                        else
                          retainLearningLocation({
                            ...learningLocation,
                            pathname,
                            state,
                          });
                      }}
                      coursesReady={coursesReady}
                      newSession={newSession}
                      entryRequest={courseEntryRequest}
                      libraryError={courseError}
                      onEntryRequestHandled={(id) => {
                        setCourseEntryRequest((current) =>
                          current?.id === id ? null : current,
                        );
                      }}
                      onOpenCourse={(course) => {
                        void routeNavigate(coursePath(course.id));
                      }}
                      onRenameCourse={renameCourse}
                      onDeleteCourse={removeCourse}
                      onCourseCreated={(course) => {
                        setCourses((all) => [
                          course,
                          ...all.filter((item) => item.id !== course.id),
                        ]);
                        locateSession(course);
                      }}
                      onCourseUpdated={(course) => {
                        setCourses((all) =>
                          all.map((item) =>
                            item.id === course.id ? course : item,
                          ),
                        );
                        if (
                          course.conversationId &&
                          (course.id === courseId || independentConversation) &&
                          courseLevel === "conversation"
                        )
                          locateSession(course);
                      }}
                      onSwitchConversation={(course, conversation, handoff) => {
                        setCourses((all) =>
                          all.map((item) =>
                            item.id === course.id ? course : item,
                          ),
                        );
                        setCourseEntryRequest({
                          id: Date.now(),
                          text: handoff,
                          materialNames: [],
                          handoff: true,
                          conversationId: conversation.id,
                        });
                        void routeNavigate(
                          conversationPath(course.id, conversation.id),
                        );
                      }}
                      onEnterNextSection={async (section, request) => {
                        const latest = [...section.conversations].sort((a, b) =>
                          b.updatedAt.localeCompare(a.updatedAt),
                        )[0];
                        if (latest) {
                          openConversation(latest);
                          setCourseEntryRequest({
                            id: Date.now(),
                            text:
                              request ??
                              `请从上次进度继续${section.title}的学习。`,
                            materialNames: [],
                            conversationId: latest.id,
                          });
                        } else
                          await createSectionConversation(
                            section,
                            request ?? `请开始${section.title}的学习。`,
                          );
                      }}
                    />
                  )}
                </section>
              )}
            {!onboarding && view !== "home" && (
              <section key={view} className="workspace-settings">
                <h1>{titles[view]}</h1>
                {view === "profile" ? (
                  <AccountProfile {...account} user={user} />
                ) : (
                  <>
                    <Security {...account} user={user} />
                    {view !== "security" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("security")}
                      >
                        返回账号安全
                      </button>
                    )}
                  </>
                )}
              </section>
            )}
          </main>
        </div>
        <SidebarDialog.Portal>
          <SidebarDialog.Overlay className="navigation-overlay" />
          <SidebarDialog.Content
            className="navigation-drawer"
            aria-describedby={undefined}
          >
            <div className="navigation-drawer-header">
              <SidebarDialog.Close asChild>
                <button className="icon-button" aria-label="关闭侧栏">
                  <Icon name="close" />
                </button>
              </SidebarDialog.Close>
              <SidebarDialog.Title>学习导航</SidebarDialog.Title>
            </div>
            {navigation}
          </SidebarDialog.Content>
        </SidebarDialog.Portal>
      </SidebarDialog.Root>
    </div>
  );
}
