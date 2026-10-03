import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { MessageResponse } from "../../components/ai-elements/message";
import ChatComposer, {
  type ChatComposerMessage,
} from "../../components/ChatComposer";
import Confirmation from "../../components/Confirmation";
import type {
  CourseMaterial,
  MaterialPreparationProgress,
  CourseSection,
  InputMode,
  StoredCourse,
  StoredCourseConversation,
} from "../../../../../packages/learning/src/domain/learning";
import CourseCover from "./CourseCover";
import SectionHistory from "./SectionHistory";
import {
  acceptsCourseMaterial,
  courseMaterialAttachments,
  courseMaterialFormatHint,
  courseMaterialMaxSize,
  courseMaterialTypes,
} from "./course-composer";
import {
  deleteCourseMaterial,
  getCourseMaterial,
  listCourseMaterials,
  uploadCourseMaterials,
} from "./courses";
import MaterialParsingProgress from "./MaterialParsingProgress";

const statusLabel: Record<CourseSection["status"], string> = {
  planned: "待学习",
  active: "学习中",
  complete: "已完成",
  archived: "已归档",
};

export default function CourseOverview({
  course,
  onOpenSection,
  onStartLearning,
  courseError,
  onOpenConversation,
  onCreateConversation,
  onDeleteConversation,
}: {
  course: StoredCourse;
  onOpenSection: (section: CourseSection) => void;
  onStartLearning: (request: string, materialNames: string[], inputMode: InputMode, inputMethod?: ChatComposerMessage["inputMethod"]) => void;
  courseError: string;
  onOpenConversation: (conversation: StoredCourseConversation) => void;
  onCreateConversation: (
    section: CourseSection,
    request: string,
    materialNames: string[],
    inputMode: InputMode,
    inputMethod?: ChatComposerMessage["inputMethod"],
  ) => Promise<void>;
  onDeleteConversation: (
    section: CourseSection,
    conversation: StoredCourseConversation,
  ) => Promise<boolean>;
}) {
  const [view, setView] = useState<"outline" | "materials">("outline");
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    content: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [composerError, setComposerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [materialProgress, setMaterialProgress] =
    useState<MaterialPreparationProgress | null>(null);
  const [materialToDelete, setMaterialToDelete] =
    useState<CourseMaterial | null>(null);
  const [historySectionId, setHistorySectionId] = useState("");
  const sections = course.sections ?? [];
  const historySection = sections.find(({ id }) => id === historySectionId);
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
      const [material] = await uploadCourseMaterials(course.id, [file], setMaterialProgress);
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
    accept: courseMaterialTypes,
    maxSize: courseMaterialMaxSize,
    validator: file => acceptsCourseMaterial(file.name)
      ? null
      : { code: "file-invalid-type", message: courseMaterialFormatHint },
    multiple: false,
    maxFiles: 1,
    disabled: busy,
    onDropAccepted: ([file]) => void upload(file),
    onDropRejected: (rejections) => {
      const invalidType = rejections.some((rejection) =>
        rejection.errors.some((item) => item.code === "file-invalid-type"),
      );
      const tooLarge = rejections.some(rejection =>
        rejection.errors.some(item => item.code === "file-too-large"),
      );
      setError(
        invalidType
          ? courseMaterialFormatHint
          : tooLarge
            ? "单个课程材料不能超过 3 MB"
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
    ? "正在上传并解析材料…"
    : isDragReject
      ? "不支持这种文件"
      : isDragActive
        ? "松开即可上传"
        : "拖放材料到这里";
  const uploadHint = isDragReject
    ? courseMaterialFormatHint
    : isDragActive
      ? "材料会自动添加到当前课程"
      : `或点击选择文件；${courseMaterialFormatHint}`;

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

  const startLearning = async ({ text, files, speakReplies, inputMethod }: ChatComposerMessage) => {
    if (busy) throw new Error("The course overview is busy");
    setBusy(true);
    setComposerError("");
    try {
      let uploadedNames: string[];
      try {
        const uploaded = await uploadCourseMaterials(course.id, files, setMaterialProgress);
        uploadedNames = uploaded.map(material => material.name);
      } catch (error) {
        setComposerError("教学材料上传或解析失败，请处理后再发送");
        throw new Error("教学材料上传或解析失败，请处理后再发送", { cause: error });
      }
      const request =
        text.trim() ||
        (historySection
          ? `请根据我附带的教学材料继续学习${historySection.title}。`
          : "请根据我附带的教学材料继续这门课程。");
      if (historySection)
        await onCreateConversation(historySection, request, uploadedNames, speakReplies ? "speech" : "text", inputMethod);
      else onStartLearning(request, uploadedNames, speakReplies ? "speech" : "text", inputMethod);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`course-home ${historySection ? "has-history-open" : ""}`}
      aria-label="课程主页"
    >
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

      {materialProgress && <MaterialParsingProgress progress={materialProgress} />}
      {view === "outline" ? (
        <div className="course-home-sections">
          {sections.map((section) => (
            <article
              className="course-section-card"
              data-status={section.status}
              key={section.id}
            >
              <button
                aria-label={`打开小节：${section.title}`}
                className="course-section-open"
                onClick={() => onOpenSection(section)}
              >
                <span className="course-section-number">
                  {String(section.position + 1).padStart(2, "0")}
                </span>
                <span className="course-section-copy">
                  <strong>{section.title}</strong>
                  <span>{section.objective}</span>
                </span>
              </button>
              {section.conversations.length > 0 && (
                <button
                  aria-label={`查看${section.title}的 ${section.conversations.length} 次学习记录`}
                  aria-controls={`section-history-${section.id}`}
                  aria-expanded={historySectionId === section.id}
                  className="course-section-history"
                  onClick={() =>
                    setHistorySectionId((current) =>
                      current === section.id ? "" : section.id,
                    )
                  }
                >
                  查看 {section.conversations.length} 次学习记录
                </button>
              )}
              <span className="course-section-status">
                {statusLabel[section.status]}
              </span>
            </article>
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
            <small>每次上传一个文件，单个文件不超过 3 MB</small>
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
                    disabled={!/\.(md|txt)$/i.test(material.name)}
                    title={/\.(md|txt)$/i.test(material.name) ? undefined : "暂不支持预览，知芽可以读取解析后的内容"}
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
                    onClick={() => setMaterialToDelete(material)}
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {historySection && (
        <SectionHistory
          section={historySection}
          error={courseError}
          onClose={() => setHistorySectionId("")}
          onOpenConversation={onOpenConversation}
          onDeleteConversation={(conversation) =>
            onDeleteConversation(historySection, conversation)
          }
        />
      )}

      <ChatComposer
        attachments={courseMaterialAttachments}
        className="course-home-composer"
        disabled={busy}
        error={composerError}
        label={
          historySection
            ? `告诉知芽你想在${historySection.title}中学习什么`
            : "告诉知芽你想开始什么新的学习"
        }
        onError={setComposerError}
        onVoiceError={setComposerError}
        onSubmit={startLearning}
        submitLabel={historySection ? "开始新一轮学习" : "开始新的学习"}
      />

      {materialToDelete && (
        <Confirmation
          title="删除课程材料？"
          text={`“${materialToDelete.name}”将从这门课程中删除，删除后无法恢复。`}
          confirmLabel="删除材料"
          danger
          answer={(confirmed) => {
            const material = materialToDelete;
            setMaterialToDelete(null);
            if (confirmed) void remove(material);
          }}
        />
      )}

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
