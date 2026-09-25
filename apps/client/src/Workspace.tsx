import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { useAccount } from "./features/account/useAccount";
import AccountProfile from "./features/account/Profile";
import Security from "./features/account/Security";
import CourseRoom from "./features/course/CourseRoom";
import CourseOverview from "./features/course/CourseOverview";
import Profile from "./features/profile/Profile";
import Mark from "./components/Mark";
import Icon, { type IconName } from "./components/Icon";
import ThemeToggle from "./components/ThemeToggle";
import {
  createCourseConversation,
  deleteCourseConversation,
  deleteCourse,
  listCourses,
  updateCourse,
} from "./features/course/courses";
import type {
  CourseSection,
  ModelInfo,
  StoredCourse,
  StoredCourseConversation,
} from "./domain/learning";
import "./workspace.css";
import { matchRoutes, useLocation, useNavigate } from "react-router";
import {
  conversationPath,
  coursePath,
  pageRoutes,
  returnPath,
  usePage,
} from "./routes";

const destinations: {
  id: IconName;
  label: string;
  title: string;
  empty: string;
}[] = [
  { id: "learning", label: "学习", title: "学习地图", empty: "今天想学什么？" },
  { id: "explore", label: "探索", title: "自由探索", empty: "探索即将开放" },
  { id: "lab", label: "实验", title: "AI 实验室", empty: "实验准备中" },
  { id: "review", label: "回顾", title: "学习回顾", empty: "还没有学习记录" },
];

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
    "new-conversation",
  ].includes(page);
  // Retain the route of the hidden classroom, matching its existing lifetime
  // when visiting account pages or other workspace destinations.
  const [retainedLearningLocation, retainLearningLocation] = useState(location);
  const learningLocation = learningPage ? location : retainedLearningLocation;
  const learningMatch = matchRoutes(pageRoutes, learningLocation)?.at(-1);
  const { courseId, conversationId } = learningMatch?.params ?? {};
  const { user, view, navigate, busy, logout } = account;
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const memoryOpen = page === "learning-profile";
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
  const destination =
    destinations.find((item) => item.id === page) ?? destinations[0];
  const [courses, setCourses] = useState<StoredCourse[]>([]);
  const storedCourse = courses.find((course) => course.id === courseId);
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
      : storedCourse
    : null;
  const courseLevel =
    learningMatch?.route.id === "course" ? "course" : "conversation";
  const [coursesReady, setCoursesReady] = useState(false);
  const courseRoomToken: string =
    learningLocation.state?.roomKey ?? learningLocation.key;
  const newSession = learningMatch?.route.id === "new-conversation";
  const [courseEntryRequest, setCourseEntryRequest] = useState<{
    id: number;
    text: string;
    materialNames: string[];
    handoff?: boolean;
    conversationId?: string;
  } | null>(null);
  const [courseError, setCourseError] = useState("");
  const routeError =
    page === "not-found"
      ? "页面不存在"
      : learningPage && courseId && coursesReady
        ? (!storedCourse
            ? courseError || "课程不存在或无法访问"
            : conversationId && !conversation
              ? "学习对话不存在或无法访问"
              : "")
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
    if (!user) return;
    let current = true;
    setCoursesReady(false);
    void listCourses()
      .then((next) => {
        if (!current) return;
        setCourses(next);
        setCourseError("");
      })
      .catch(() => current && setCourseError("暂时无法读取课程"))
      .finally(() => current && setCoursesReady(true));
    return () => {
      current = false;
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
  const go = (next: typeof destination) => {
    void routeNavigate(next.id === "learning" ? "/learn" : `/${next.id}`);
  };
  const locateSession = (course: StoredCourse) => {
    const pathname = course.conversationId
      ? conversationPath(course.id, course.conversationId)
      : `${coursePath(course.id)}/conversations/new`;
    if (learningLocation.pathname === pathname) return;
    const state = { roomKey: courseRoomToken };
    if (learningPage) void routeNavigate(pathname, { replace: true, state });
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
      setCourseError("");
      return true;
    } catch {
      setCourseError("暂时无法删除课程");
      return false;
    }
  };
  const courseOpen =
    learningPage &&
    view === "home" &&
    !memoryOpen &&
    destination.id === "learning" &&
    Boolean(activeCourse);
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
  return (
    <div
      className={`workspace ${collapsed ? "is-collapsed" : ""} ${onboarding ? "is-onboarding" : ""}`}
    >
      <aside
        hidden={onboarding}
        className="workspace-sidebar"
        aria-label="侧栏"
      >
        <div className="workspace-brand">
          <Mark />
          <span>知芽</span>
        </div>
        <nav className="workspace-nav" aria-label="主导航">
          {destinations.map((item) => (
            <button
              key={item.id}
              title={item.title}
              aria-label={item.title}
              aria-current={
                view === "home" && !memoryOpen && page !== "not-found" && destination.id === item.id
                  ? "page"
                  : undefined
              }
              onClick={() => go(item)}
            >
              <Icon name={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
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
              <Icon name="review" />
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
      <div className="workspace-body">
        <header hidden={onboarding} className="workspace-toolbar">
          <button
            className="icon-button sidebar-toggle"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="sidebar" />
          </button>
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
                  void go(destinations[0]);
                }
              }}
            >
              <Icon
                name={
                  !courseOpen && memoryOpen && !editingMemory ? "close" : "back"
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
                  ? onboarding && destination.id === "learning"
                    ? "初次见面"
                    : destination.title
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
          {!onboarding && learningPage && courseId && !coursesReady && (
            <p role="status">正在读取课程…</p>
          )}
          {!onboarding &&
            !memoryOpen &&
            !routeError &&
            (!courseId || coursesReady) && (
              <section
                className="course-surface"
                data-hidden={view !== "home" || destination.id !== "learning"}
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
                    onCreateConversation={(section, request, materialNames) =>
                      createSectionConversation(section, request, materialNames)
                    }
                    onDeleteConversation={(section, conversation) =>
                      removeSectionConversation(section, conversation)
                    }
                    onStartLearning={(text, materialNames) => {
                      void routeNavigate(
                        `${coursePath(activeCourse.id)}/conversations/new`,
                      );
                      setCourseEntryRequest({
                        id: Date.now(),
                        text,
                        materialNames,
                      });
                    }}
                  />
                )}
                {(!activeCourse || courseLevel === "conversation") && (
                  <CourseRoom
                    key={courseRoomToken}
                    info={learningContext.model}
                    memory={learningContext.memory}
                    courses={courses}
                    activeCourse={activeCourse}
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
                        course.id === courseId &&
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
                  />
                )}
              </section>
            )}
          {!onboarding &&
            !memoryOpen &&
            view === "home" &&
            destination.id !== "learning" && (
              <section key={destination.id} className="workspace-empty">
                <div className={`subject-art ${destination.id}`}>
                  <Icon name={destination.id} />
                </div>
                <h1>{destination.empty}</h1>
                <button
                  className="text-button"
                  onClick={() => go(destinations[0])}
                >
                  返回学习
                </button>
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
    </div>
  );
}
