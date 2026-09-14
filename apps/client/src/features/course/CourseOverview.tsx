import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { MessageResponse } from "../../components/ai-elements/message";
import Icon from "../../components/Icon";
import type {
  CourseMaterial,
  CourseSection,
  StoredCourse,
} from "../../domain/learning";
import CourseCover from "./CourseCover";
import {
  deleteCourseMaterial,
  getCourseMaterial,
  listCourseMaterials,
  uploadCourseMaterial,
} from "./courses";

const statusLabel: Record<CourseSection["status"], string> = {
  planned: "待学习",
  active: "学习中",
  complete: "已完成",
  archived: "已归档",
};

const materialTypes = {
  "text/markdown": [".md"],
  "text/plain": [".txt"],
};

export default function CourseOverview({
  course,
  onOpenSection,
  onStartLearning,
}: {
  course: StoredCourse;
  onOpenSection: (section: CourseSection) => void;
  onStartLearning: (request: string) => void;
}) {
  const [view, setView] = useState<"outline" | "materials">("outline");
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    content: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState("");
  const sections = course.sections ?? [];
  const progressSections = sections.filter(
    (section) => section.status !== "archived",
  );
  const complete = progressSections.filter(
    (section) => section.status === "complete",
  ).length;

  useEffect(() => {
    if (view !== "materials") return;
    let current = true;
    void listCourseMaterials(course.id)
      .then((items) => current && setMaterials(items))
      .catch(() => current && setError("暂时无法读取课程材料"));
    return () => {
      current = false;
    };
  }, [course.id, view]);

  const upload = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const material = await uploadCourseMaterial(course.id, file);
      setMaterials((items) => [
        material,
        ...items.filter(({ id }) => id !== material.id),
      ]);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "暂时无法上传课程材料",
      );
    } finally {
      setBusy(false);
    }
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
  } = useDropzone({
    accept: materialTypes,
    multiple: false,
    maxFiles: 1,
    disabled: busy,
    onDropAccepted: ([file]) => void upload(file),
    onDropRejected: (rejections) => {
      const invalidType = rejections.some((rejection) =>
        rejection.errors.some((item) => item.code === "file-invalid-type"),
      );
      setError(
        invalidType
          ? "目前仅支持 Markdown 和 TXT 文件"
          : "每次只能上传一个课程材料",
      );
    },
  });

  const uploadState = busy
    ? "busy"
    : isDragReject
      ? "reject"
      : isDragActive
        ? "active"
        : "idle";
  const uploadTitle = busy
    ? "正在上传材料…"
    : isDragReject
      ? "不支持这种文件"
      : isDragActive
        ? "松开即可上传"
        : "拖放材料到这里";
  const uploadHint = isDragReject
    ? "目前仅支持 Markdown 和 TXT 文件"
    : isDragActive
      ? "材料会自动添加到当前课程"
      : "或点击选择 Markdown、TXT 文件";

  const remove = async (material: CourseMaterial) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteCourseMaterial(course.id, material.id);
      setMaterials((items) => items.filter(({ id }) => id !== material.id));
      if (preview?.id === material.id) setPreview(null);
    } catch {
      setError("暂时无法删除课程材料");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="course-home" aria-label="课程主页">
      <header className="course-home-hero">
        <div className="course-home-cover">
          <CourseCover title={course.title} cover={course.cover} />
        </div>
        <div className="course-home-intro">
          <span className="course-home-kicker">你的课程</span>
          <h1>{course.title}</h1>
          <p>{course.topic}</p>
          <div className="course-home-progress" aria-label="课程进度">
            <span
              style={{
                width: `${progressSections.length ? (complete / progressSections.length) * 100 : 0}%`,
              }}
            />
          </div>
          <small>
            {progressSections.length} 个小节 · {complete} 个已完成
          </small>
        </div>
      </header>

      <div className="course-home-tabs" aria-label="课程管理">
        <button
          aria-pressed={view === "outline"}
          onClick={() => setView("outline")}
        >
          课程大纲
        </button>
        <button
          aria-pressed={view === "materials"}
          onClick={() => setView("materials")}
        >
          课程材料
        </button>
      </div>

      {view === "outline" ? (
        <div className="course-home-sections">
          {sections.map((section) => (
            <button
              key={section.id}
              className="course-section-card"
              data-status={section.status}
              aria-label={`打开小节：${section.title}`}
              onClick={() => onOpenSection(section)}
            >
              <span className="course-section-number">
                {String(section.position + 1).padStart(2, "0")}
              </span>
              <span className="course-section-copy">
                <strong>{section.title}</strong>
                <span>{section.objective}</span>
              </span>
              <span className="course-section-meta">
                {statusLabel[section.status]} · {section.conversations.length}{" "}
                次学习
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      ) : (
        <section className="course-home-materials" aria-label="课程材料列表">
          <header>
            <div>
              <h2>课程材料</h2>
              <p>材料属于整门课程，所有小节和对话都可以按需使用。</p>
            </div>
          </header>
          <div
            {...getRootProps({
              className: "course-material-upload",
              role: "button",
              "aria-label": "上传课程材料",
              "aria-disabled": busy,
              "data-state": uploadState,
            })}
          >
            <input {...getInputProps({ "aria-label": "选择课程材料" })} />
            <span className="course-material-upload-mark" aria-hidden="true">
              ↑
            </span>
            <strong>{uploadTitle}</strong>
            <span>{uploadHint}</span>
            <small>每次上传一个文件</small>
          </div>
          {error && (
            <p className="course-context-error" role="alert">
              {error}
            </p>
          )}
          {materials.length === 0 ? (
            <div className="course-material-empty">
              <strong>还没有课程材料</strong>
              <span>上传讲义或笔记后，Agent 会在需要时读取。</span>
            </div>
          ) : (
            <div className="course-material-list">
              {materials.map((material) => (
                <article key={material.id} className="course-material-item">
                  <button
                    aria-label={material.name}
                    onClick={async () => {
                      setError("");
                      try {
                        const result = await getCourseMaterial(
                          course.id,
                          material.id,
                        );
                        setPreview({
                          id: result.material.id,
                          name: result.material.name,
                          content: result.content,
                        });
                      } catch {
                        setError("暂时无法读取课程材料");
                      }
                    }}
                  >
                    <strong>{material.name}</strong>
                    <span>
                      {Math.max(1, Math.ceil(material.sizeBytes / 1024))} KB
                    </span>
                  </button>
                  <button
                    aria-label={`删除材料：${material.name}`}
                    disabled={busy}
                    onClick={() => void remove(material)}
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <form
        className="course-home-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const value = request.trim();
          if (!value) return;
          onStartLearning(value);
        }}
      >
        <label className="sr-only" htmlFor="course-guide-request">
          告诉知芽你想怎样继续这门课程
        </label>
        <textarea
          id="course-guide-request"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="例如：我想继续之前的学习"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" aria-label="开始学习" disabled={!request.trim()}>
          <Icon name="send" />
        </button>
      </form>

      {preview && (
        <section
          className="course-material-preview"
          aria-label={`材料预览：${preview.name}`}
        >
          <header>
            <strong>{preview.name}</strong>
            <button aria-label="关闭材料预览" onClick={() => setPreview(null)}>
              ×
            </button>
          </header>
          <MessageResponse>{preview.content}</MessageResponse>
        </section>
      )}
    </section>
  );
}
