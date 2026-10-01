import { Link, useLocation } from "react-router";
import type { StoredCourse } from "../../../../packages/learning/src/domain/learning";
import { conversationPath, independentConversationPath } from "../routes";
import Icon from "./Icon";
import { Spinner } from "./ui/spinner";
import type { AgentStatus, ConversationSummary } from "../transport/agent";

export default function LearningNavigation({
  courses,
  statuses,
  conversations,
  ready,
  loadError,
  onNavigate,
  onLearn,
}: {
  courses: StoredCourse[];
  statuses: AgentStatus[];
  conversations: ConversationSummary[];
  ready: boolean;
  loadError: boolean;
  onNavigate: () => void;
  onLearn: () => void;
}) {
  const { pathname } = useLocation();
  const running = new Set(
    statuses
      .filter((status) => status.running)
      .map((status) => status.conversationId),
  );
  const assigned = courses.flatMap((course) =>
    (course.sections ?? []).flatMap((section) =>
      section.conversations.map((conversation) => ({
        course,
        conversation,
        path: conversationPath(course.id, conversation.id),
      })),
    ),
  );
  const recent = [
    ...assigned,
    ...conversations
      .filter(
        (item) =>
          !assigned.some(({ conversation }) => conversation.id === item.id),
      )
      .map((conversation) => ({
        conversation,
        course: courses.find((item) => item.id === conversation.courseId),
        path: independentConversationPath(conversation.id),
      })),
  ]
    .sort(
      (a, b) =>
        Date.parse(b.conversation.updatedAt) -
          Date.parse(a.conversation.updatedAt) ||
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
            {recent.map(({ course, conversation, path }) => {
              return (
                <li key={conversation.id}>
                  <Link
                    to={path}
                    onClick={(event) => {
                      if (pathname === path) event.preventDefault();
                      onNavigate();
                    }}
                    aria-current={
                      pathname === path ||
                      pathname ===
                        `/conversations/${encodeURIComponent(conversation.id)}`
                        ? "page"
                        : undefined
                    }
                    title={
                      course
                        ? `${conversation.title} · ${course.title}`
                        : conversation.title
                    }
                  >
                    <span className="recent-conversation-title">
                      {conversation.title || "新对话"}
                    </span>
                    {course && (
                      <span className="recent-conversation-course">
                        {course.title}
                      </span>
                    )}
                    {running.has(conversation.id) && (
                      <span
                        className="recent-conversation-progress"
                        role="status"
                        aria-label="正在生成"
                        title="正在生成"
                      >
                        <Spinner
                          aria-hidden="true"
                          role={undefined}
                          aria-label={undefined}
                        />
                      </span>
                    )}
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
