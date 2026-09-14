import { useEffect, useRef, useState, type ReactNode } from "react";
import type { useAccount } from "./features/account/useAccount";
import AccountProfile from "./features/account/Profile";
import Security from "./features/account/Security";
import CourseRoom from "./features/course/CourseRoom";
import CourseOverview from "./features/course/CourseOverview";
import SectionOverview from "./features/course/SectionOverview";
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
  const { user, view, navigate, busy, logout } = account;
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState(true);
  const [endingMemory, setEndingMemory] = useState(false);
  const [onboarding, setOnboarding] = useState(true);
  const [learningContext, setLearningContext] = useState<{
    memory: string;
    model: ModelInfo | null;
  }>({ memory: "", model: null });
  const [destination, setDestination] = useState(destinations[0]);
  const [courses, setCourses] = useState<StoredCourse[]>([]);
  const [activeCourse, setActiveCourse] = useState<StoredCourse | null>(null);
  const [courseLevel, setCourseLevel] = useState<
    "course" | "section" | "conversation"
  >("course");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [coursesReady, setCoursesReady] = useState(false);
  const [courseRoomToken, setCourseRoomToken] = useState(0);
  const [courseSessionMode, setCourseSessionMode] = useState<
    "new" | "existing"
  >("existing");
  const [courseEntryRequest, setCourseEntryRequest] = useState<{
    id: number;
    text: string;
    materialNames: string[];
  } | null>(null);
  const [courseError, setCourseError] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onboardingExit = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (!user) return;
    let current = true;
    setCoursesReady(false);
    void listCourses()
      .then((next) => {
        if (!current) return;
        setCourses(next);
        setActiveCourse(null);
        setCourseLevel("course");
        setActiveSectionId("");
        setCourseError("");
      })
      .catch(() => current && setCourseError("暂时无法读取课程"))
      .finally(() => current && setCoursesReady(true));
    return () => {
      current = false;
    };
  }, [user?.id]);
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
  const go = async (next: typeof destination) => {
    if (await navigate("home")) {
      setMemoryOpen(false);
      setDestination(next);
      if (next.id === "learning") {
        setActiveCourse(null);
        setCourseLevel("course");
        setActiveSectionId("");
        setCourseRoomToken((value) => value + 1);
      }
    }
  };
  const renameCourse = async (course: StoredCourse, title: string) => {
    try {
      const updated = await updateCourse(course.id, { title });
      setCourses((all) =>
        all.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (activeCourse?.id === updated.id) setActiveCourse(updated);
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
    view === "home" &&
    !memoryOpen &&
    destination.id === "learning" &&
    Boolean(activeCourse);
  const activeSection = activeCourse?.sections?.find((section) =>
    courseLevel === "conversation"
      ? section.conversations.some(
          (conversation) => conversation.id === activeCourse.conversationId,
        )
      : section.id === activeSectionId,
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
    setActiveCourse(updated);
    setCourses((all) =>
      all.map((item) => (item.id === updated.id ? updated : item)),
    );
    setActiveSectionId(conversation.sectionId);
    setCourseSessionMode("existing");
    setCourseLevel("conversation");
    setCourseRoomToken((value) => value + 1);
  };
  const createSectionConversation = async (
    request: string,
    materialNames: string[],
  ) => {
    if (!activeCourse || !activeSection) return;
    try {
      const conversation = await createCourseConversation(
        activeCourse.id,
        activeSection.id,
        "新对话",
      );
      const updated = {
        ...activeCourse,
        sections: activeCourse.sections?.map((section) =>
          section.id === activeSection.id
            ? {
                ...section,
                conversations: [...section.conversations, conversation],
              }
            : section,
        ),
      };
      setCourseError("");
      openConversation(conversation, updated);
      setCourseEntryRequest({
        id: Date.now(),
        text: request,
        materialNames,
      });
    } catch {
      setCourseError("暂时无法新建对话");
      throw new Error("Could not create the section conversation");
    }
  };
  const removeSectionConversation = async (
    conversation: StoredCourseConversation,
  ) => {
    if (!activeCourse || !activeSection) return false;
    try {
      const updated = await deleteCourseConversation(
        activeCourse.id,
        activeSection.id,
        conversation.id,
      );
      setCourses((all) =>
        all.map((item) => (item.id === updated.id ? updated : item)),
      );
      setActiveCourse(updated);
      setCourseError("");
      return true;
    } catch {
      setCourseError("暂时无法删除对话");
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
                view === "home" && !memoryOpen && destination.id === item.id
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
                if (await navigate("home")) setMemoryOpen(true);
              }}
            >
              <Icon name="review" />
              学习档案
            </button>
            <button
              onClick={async () => {
                setMenuOpen(false);
                if (await navigate("profile")) setMemoryOpen(false);
              }}
            >
              <Icon name="profile" />
              个人资料
            </button>
            <button
              onClick={async () => {
                setMenuOpen(false);
                if (await navigate("security")) setMemoryOpen(false);
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
                    ? "返回小节"
                    : courseLevel === "section"
                      ? "返回课程"
                      : "返回课程列表"
                  : memoryOpen && !editingMemory
                    ? "停止对话"
                    : "返回学习"
              }
              title={
                courseOpen
                  ? courseLevel === "conversation"
                    ? "返回小节"
                    : courseLevel === "section"
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
                    setActiveSectionId(activeSection?.id ?? "");
                    setCourseLevel("section");
                  } else if (courseLevel === "section") {
                    setCourseLevel("course");
                  } else {
                    setActiveCourse(null);
                    setActiveSectionId("");
                  }
                  setCourseRoomToken((value) => value + 1);
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
              ? courseLevel === "section"
                ? `${activeCourse?.title} · ${activeSection?.title ?? "小节"}`
                : courseLevel === "conversation"
                  ? `${activeSection?.title ?? activeCourse?.title} · 对话`
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
            onOnboardingChange={setOnboarding}
            onContextChange={setLearningContext}
          />
          {!onboarding && !memoryOpen && (
            <section
              className="course-surface"
              data-hidden={view !== "home" || destination.id !== "learning"}
              aria-label="学习空间"
            >
              {activeCourse && courseLevel === "course" && (
                <CourseOverview
                  course={activeCourse}
                  onOpenSection={(section: CourseSection) => {
                    setActiveSectionId(section.id);
                    setCourseLevel("section");
                  }}
                  onStartLearning={(text, materialNames) => {
                    setActiveSectionId("");
                    setCourseSessionMode("new");
                    setCourseLevel("conversation");
                    setCourseRoomToken((value) => value + 1);
                    setCourseEntryRequest({
                      id: Date.now(),
                      text,
                      materialNames,
                    });
                  }}
                />
              )}
              {activeCourse && courseLevel === "section" && activeSection && (
                <SectionOverview
                  course={activeCourse}
                  section={activeSection}
                  error={courseError}
                  onOpenConversation={(conversation) =>
                    openConversation(conversation)
                  }
                  onCreateConversation={createSectionConversation}
                  onDeleteConversation={removeSectionConversation}
                />
              )}
              {(!activeCourse || courseLevel === "conversation") && (
                <CourseRoom
                  info={learningContext.model}
                  memory={learningContext.memory}
                  courses={courses}
                  activeCourse={activeCourse}
                  coursesReady={coursesReady}
                  roomToken={courseRoomToken}
                  newSession={courseSessionMode === "new"}
                  entryRequest={courseEntryRequest}
                  libraryError={courseError}
                  onEntryRequestHandled={(id) => {
                    setCourseEntryRequest((current) =>
                      current?.id === id ? null : current,
                    );
                  }}
                  onOpenCourse={(course) => {
                    setActiveCourse(course);
                    setCourseLevel("course");
                    setActiveSectionId("");
                  }}
                  onRenameCourse={renameCourse}
                  onDeleteCourse={removeCourse}
                  onCourseCreated={(course) => {
                    setCourses((all) => [
                      course,
                      ...all.filter((item) => item.id !== course.id),
                    ]);
                    setActiveCourse(course);
                    setActiveSectionId(course.sections?.[0]?.id ?? "");
                    setCourseLevel("conversation");
                  }}
                  onCourseUpdated={(course) => {
                    setCourses((all) =>
                      all.map((item) =>
                        item.id === course.id ? course : item,
                      ),
                    );
                    setActiveCourse((current) =>
                      current?.id === course.id ? course : current,
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
