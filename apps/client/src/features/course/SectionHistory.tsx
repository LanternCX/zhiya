import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import type {
  CourseSection,
  StoredCourseConversation,
} from "../../domain/learning";

export default function SectionHistory({
  section,
  error,
  onClose,
  onOpenConversation,
  onDeleteConversation,
}: {
  section: CourseSection;
  error: string;
  onClose: () => void;
  onOpenConversation: (conversation: StoredCourseConversation) => void;
  onDeleteConversation: (
    conversation: StoredCourseConversation,
  ) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const card = useRef<HTMLElement>(null);
  const historyId = `section-history-${section.id}`;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        card.current?.contains(target) ||
        target.closest(`[aria-controls="${historyId}"]`) ||
        target.closest(".course-home-composer")
      )
        return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        document
          .querySelector<HTMLElement>(`[aria-controls="${historyId}"]`)
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyId, onClose]);

  return (
    <div className="section-history-backdrop" onPointerDown={onClose}>
      <section
        aria-label={`${section.title}的学习记录`}
        className="section-history-card"
        id={historyId}
        onPointerDown={(event) => event.stopPropagation()}
        ref={card}
        role="dialog"
      >
        <header className="section-history-header">
          <div>
            <span>{section.title}</span>
            <h2>学习记录</h2>
            <p>{section.objective}</p>
          </div>
          <button
            aria-label="关闭学习记录"
            className="icon-button"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="section-history-list">
          {section.conversations.length === 0 ? (
            <p className="section-conversations-empty">还没有学习记录</p>
          ) : (
            [...section.conversations].reverse().map((conversation) => (
              <article
                className="section-conversation-row"
                data-menu-open={menu === conversation.id}
                key={conversation.id}
              >
                <button
                  className="section-conversation-open"
                  aria-label={`打开学习记录：${conversation.title}`}
                  onClick={() => onOpenConversation(conversation)}
                >
                  <span>
                    {new Intl.DateTimeFormat("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                    }).format(new Date(conversation.updatedAt))}
                  </span>
                  <strong>{conversation.title}</strong>
                  <small>
                    {conversation.state.messages.length} 条交流 ·{" "}
                    {conversation.state.pages.length} 个课堂页面
                  </small>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  className="section-conversation-menu-trigger"
                  aria-label={`管理学习记录：${conversation.title}`}
                  aria-expanded={menu === conversation.id}
                  disabled={busy}
                  onClick={() => {
                    setMenu(menu === conversation.id ? "" : conversation.id);
                    setConfirmDelete("");
                  }}
                >
                  <Icon name="more" />
                </button>
                {menu === conversation.id && (
                  <div className="section-conversation-menu">
                    {confirmDelete === conversation.id ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setMenu("");
                            setConfirmDelete("");
                          }}
                        >
                          取消
                        </button>
                        <button
                          className="danger-text"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const deleted =
                              await onDeleteConversation(conversation);
                            setBusy(false);
                            if (deleted) {
                              setMenu("");
                              setConfirmDelete("");
                            }
                          }}
                        >
                          确认删除记录
                        </button>
                      </>
                    ) : (
                      <button
                        className="danger-text"
                        onClick={() => setConfirmDelete(conversation.id)}
                      >
                        删除记录
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        {error && (
          <p className="course-context-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
