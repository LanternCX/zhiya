import { useState } from "react";
import ChatComposer, {
  type ChatComposerMessage,
} from "../../components/ChatComposer";
import Icon from "../../components/Icon";
import type {
  CourseSection,
  StoredCourse,
  StoredCourseConversation,
} from "../../domain/learning";
import { courseMaterialAttachments } from "./course-composer";
import { uploadCourseMaterial } from "./courses";

export default function SectionOverview({
  course,
  section,
  error,
  onOpenConversation,
  onCreateConversation,
  onDeleteConversation,
}: {
  course: StoredCourse;
  section: CourseSection;
  error: string;
  onOpenConversation: (conversation: StoredCourseConversation) => void;
  onCreateConversation: (
    request: string,
    materialNames: string[],
  ) => Promise<void>;
  onDeleteConversation: (
    conversation: StoredCourseConversation,
  ) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [composerError, setComposerError] = useState("");

  const startConversation = async ({ text, files }: ChatComposerMessage) => {
    if (busy) throw new Error("The section overview is busy");
    setBusy(true);
    setComposerError("");
    try {
      const uploads = await Promise.allSettled(
        files.map((file) => uploadCourseMaterial(course.id, file)),
      );
      const uploadedNames = uploads.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.name] : [],
      );
      const failed = uploads.length - uploadedNames.length;
      if (files.length > 0 && uploadedNames.length === 0) {
        setComposerError("教学材料上传失败，请重试");
        throw new Error("No course material was uploaded");
      }
      if (failed > 0) setComposerError(`${failed} 个教学材料上传失败`);
      await onCreateConversation(
        text.trim() || "请根据我附带的教学材料学习这个小节。",
        uploadedNames,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-home" aria-label="小节主页">
      <header className="section-home-header">
        <span className="section-home-index">
          小节 {String(section.position + 1).padStart(2, "0")}
        </span>
        <h1>{section.title}</h1>
        <p>{section.objective}</p>
        <span className="section-home-course">来自《{course.title}》</span>
      </header>

      {error && (
        <p className="course-context-error" role="alert">
          {error}
        </p>
      )}

      <section className="section-conversations" aria-label="小节对话">
        <header>
          <h2>学习记录</h2>
          <span>{section.conversations.length} 次对话</span>
        </header>
        {section.conversations.length === 0 ? (
          <p className="section-conversations-empty">还没有学习记录</p>
        ) : (
          <div>
            {[...section.conversations].reverse().map((conversation, index) => (
              <article
                className="section-conversation-row"
                key={conversation.id}
              >
                <button
                  className="section-conversation-open"
                  aria-label={`打开对话：${conversation.title}`}
                  onClick={() => onOpenConversation(conversation)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{conversation.title}</strong>
                  <small>
                    {conversation.state.messages.length} 条消息 ·{" "}
                    {conversation.state.pages.length} 个课堂页面
                  </small>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  className="section-conversation-menu-trigger"
                  aria-label={`管理对话：${conversation.title}`}
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
                            const deleted = await onDeleteConversation(
                              conversation,
                            );
                            setBusy(false);
                            if (deleted) {
                              setMenu("");
                              setConfirmDelete("");
                            }
                          }}
                        >
                          确认删除对话
                        </button>
                      </>
                    ) : (
                      <button
                        className="danger-text"
                        onClick={() => setConfirmDelete(conversation.id)}
                      >
                        删除对话
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <ChatComposer
        attachments={courseMaterialAttachments}
        className="course-home-composer"
        disabled={busy}
        error={composerError}
        label="告诉知芽你想在此小节学习什么"
        onError={setComposerError}
        onSubmit={startConversation}
        placeholder="例如：再讲一遍这个概念，或者出一道练习题"
        submitLabel="开始新的小节对话"
      />
    </section>
  );
}
