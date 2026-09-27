import { Link, useLocation } from "react-router";
import type { StoredCourse } from "../domain/learning";
import { conversationPath } from "../routes";
import Icon from "./Icon";

export default function LearningNavigation({
  courses,
  ready,
  loadError,
  onNavigate,
  onLearn,
}: {
  courses: StoredCourse[];
  ready: boolean;
  loadError: boolean;
  onNavigate: () => void;
  onLearn: () => void;
}) {
  const { pathname } = useLocation();
  const recent = courses
    .flatMap((course) =>
      (course.sections ?? []).flatMap((section) =>
        section.conversations.map((conversation) => ({ course, conversation })),
      ),
    )
    .sort(
      (a, b) =>
        Date.parse(b.conversation.updatedAt) - Date.parse(a.conversation.updatedAt) ||
        a.conversation.id.localeCompare(b.conversation.id),
    )
    .slice(0, 10);

  return (
    <div className="learning-navigation">
      <nav className="workspace-nav" aria-label="主导航">
        <button
          title="学习地图"
          aria-label="学习地图"
          aria-current={pathname === "/learn" ? "page" : undefined}
          onClick={onLearn}
        >
          <Icon name="learning" />
          <span>学习</span>
        </button>
      </nav>
      <nav
        className="recent-conversations"
        aria-label="最近对话"
        aria-busy={!ready}
      >
        <h2>最近对话</h2>
        {!ready ? (
          <p role="status">正在读取…</p>
        ) : loadError ? (
          <p role="status">暂时无法读取对话</p>
        ) : recent.length === 0 ? (
          <p>还没有学习对话</p>
        ) : (
          <ul>
            {recent.map(({ course, conversation }) => {
              const path = conversationPath(course.id, conversation.id);
              return (
                <li key={conversation.id}>
                  <Link
                    to={path}
                    onClick={(event) => {
                      if (pathname === path) event.preventDefault();
                      onNavigate();
                    }}
                    aria-current={pathname === path ? "page" : undefined}
                    title={`${conversation.title} · ${course.title}`}
                  >
                    <span className="recent-conversation-title">
                      {conversation.title}
                    </span>
                    <span className="recent-conversation-course">{course.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
