import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import MarkdownIt from "markdown-it";
import {
  FileText,
  Presentation,
  PanelTop,
  PanelRightClose,
  PanelRightOpen,
  Download,
  Upload,
  RefreshCw,
} from "lucide-react";
import { api } from "../../api";
import {
  readObjectBlob,
  type ObjectRequest,
} from "../../transport/object-storage";
import type {
  Deliverable,
  DeliverableSelection,
} from "../../domain/deliverable";
import type { ExportImage } from "./export";
import { saveDeliverable } from "./download";
import "./deliverables.css";

const SlideCanvas = lazy(() => import("../course/SlideCanvas"));
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  _env,
  renderer,
) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};
type Area = "classroom" | "presentation" | "document";

async function picture(course: string, id: string): Promise<ExportImage> {
  const request = await api<ObjectRequest>(
    `/courses/${course}/deliverable-images/${id}`,
  );
  const blob = await readObjectBlob(request);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片暂时无法处理");
    context.drawImage(bitmap, 0, 0);
    return {
      data: canvas.toDataURL("image/png"),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function Pictures({
  courseId,
  ids,
  title,
}: {
  courseId: string;
  ids: string[];
  title: string;
}) {
  const [images, setImages] = useState<ExportImage[]>([]);
  const [error, setError] = useState("");
  const key = ids.join(",");
  useEffect(() => {
    let active = true;
    setImages([]);
    setError("");
    void Promise.all(
      (key ? key.split(",") : []).map((id) => picture(courseId, id)),
    ).then(
      (value) => {
        if (active) setImages(value);
      },
      (reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "图片加载失败");
      },
    );
    return () => {
      active = false;
    };
  }, [courseId, key]);
  return (
    <div className="deliverable-pictures">
      {error && <p role="alert">{error}</p>}
      {ids.length > 0 && !images.length && !error && (
        <p role="status">正在加载图片…</p>
      )}
      {images.map((image, index) => (
        <img
          key={ids[index]}
          src={image.data}
          alt={`${title} · 配图 ${index + 1}`}
        />
      ))}
    </div>
  );
}

export default function DeliverableWorkspace({
  courseId,
  changed,
  sourceChanged,
  selection,
  onSelect,
  onClassroomVisibilityChange,
  classroomPresentationId,
  children,
}: {
  courseId?: string;
  changed: number;
  sourceChanged?: string;
  selection: DeliverableSelection | null;
  onSelect: (id: string, blockId?: string) => Promise<void>;
  onClassroomVisibilityChange?: (visible: boolean) => void;
  classroomPresentationId?: string;
  children: ReactNode;
}) {
  const [area, setArea] = useState<Area>("classroom");
  useEffect(() => {
    onClassroomVisibilityChange?.(area === "classroom");
  }, [area, onClassroomVisibilityChange]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [items, setItems] = useState<Deliverable[]>([]);
  const [selected, setSelected] = useState<DeliverableSelection | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const sourceCourse = useRef(courseId);
  sourceCourse.current = courseId;
  const load = useCallback(async () => {
    const run = ++generation.current;
    if (!courseId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ deliverables: Deliverable[] }>(
        `/courses/${courseId}/deliverables`,
      );
      if (run === generation.current) {
        setItems(result.deliverables);
        setError("");
      }
    } catch (reason) {
      if (run === generation.current)
        setError(reason instanceof Error ? reason.message : "产物加载失败");
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [courseId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load, changed, sourceChanged]);
  useEffect(() => {
    setSelected(null);
    setArea("classroom");
  }, [courseId]);
  useEffect(() => {
    if (!selection) return;
    const item = items.find((item) => item.id === selection.id);
    if (item) {
      setSelected(selection);
      setArea(item.source === "classroom" ? "classroom" : item.kind);
    }
  }, [selection?.id, selection?.blockId, items]);
  const previousPresentation = useRef(classroomPresentationId);
  useEffect(() => {
    if (previousPresentation.current === classroomPresentationId) return;
    previousPresentation.current = classroomPresentationId;
    if (classroomPresentationId) {
      setSelected(null);
      setArea("classroom");
    }
  }, [classroomPresentationId]);
  const item = items.find(
    (item) => item.id === selected?.id && item.kind === (area === "classroom" ? "presentation" : area),
  ) ?? items.find((item) => item.source === (area === "document" ? "course-document" : "classroom"));
  const block =
    item?.blocks.find((b) => b.id === selected?.blockId) ?? item?.blocks[0];
  useEffect(() => {
    if (area === "document")
      preview.current
        ?.querySelector(".is-selected")
        ?.scrollIntoView({ block: "nearest" });
  }, [area, item?.id, block?.id]);
  const choose = useCallback(
    async (item: Deliverable, blockId = item.blocks[0]?.id) => {
      setSelected({ id: item.id, blockId });
      setArea(item.source === "classroom" ? "classroom" : item.kind);
      setError("");
      try {
        await onSelect(item.id, blockId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "选择失败，请重试");
      }
    },
    [onSelect],
  );
  useEffect(() => {
    if (area === "classroom" || selected || loading) return;
    const existing = items.find((item) => item.kind === area);
    if (existing) void choose(existing);
  }, [area, items, loading, selected, choose]);
  const switchArea = (next: Area) => {
    if (next === area) return;
    const existing = items.find((item) => item.source === (next === "classroom" ? "classroom" : "course-document"));
    if (existing) {
      void choose(existing);
      return;
    }
    setArea(next);
    setSelected(null);
    void onSelect("").catch((reason) =>
      setError(reason instanceof Error ? reason.message : "选择失败"),
    );
  };
  const download = async () => {
    const target = area === "document" ? item : items.find((item) => item.source === "classroom");
    if (!target || !courseId) return;
    setWorking(true);
    setError("");
    try {
      // Download a fresh, immutable local snapshot, including its own image references.
      const { deliverable } = await api<{ deliverable: Deliverable }>(
        `/courses/${courseId}/deliverables/${target.id}`,
      );
      const { exportDeliverable } = await import("./export");
      const blob = await exportDeliverable(deliverable, (id) =>
        picture(courseId, id),
      );
      if (sourceCourse.current !== courseId) return;
      await saveDeliverable(
        blob,
        `${deliverable.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.${deliverable.kind === "presentation" ? "pptx" : "docx"}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "下载失败，请重试");
    } finally {
      setWorking(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file || !courseId) return;
    setWorking(true);
    setError("");
    try {
      if (!/\.pptx?$/i.test(file.name) || file.size > 24 * 1024 * 1024)
        throw new Error("请选择不超过 24 MB 的 PPT 或 PPTX 文件");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsDataURL(file);
      });
      const { deliverable } = await api<{ deliverable: Deliverable }>(
        `/courses/${courseId}/deliverables/import`,
        "POST",
        { name: file.name, base64, requestId: crypto.randomUUID() },
      );
      if (sourceCourse.current !== courseId) return;
      await load();
      await choose(deliverable);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败，请重试");
    } finally {
      setWorking(false);
      if (upload.current) upload.current.value = "";
    }
  };
  return (
    <section
      className="deliverable-workspace"
      aria-label="课堂与交付产物"
      data-sidebar-collapsed={sidebarCollapsed}
    >
      <aside className="deliverable-sidebar" aria-label="交付产物侧栏">
        <div className="deliverable-sidebar-header">
          <span className="deliverable-kicker">学习与交付</span>
          <button
            aria-label={
              sidebarCollapsed ? "展开交付产物侧栏" : "收起交付产物侧栏"
            }
            title={
              sidebarCollapsed ? "展开交付产物侧栏" : "收起交付产物侧栏"
            }
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? (
              <PanelRightOpen size={17} />
            ) : (
              <PanelRightClose size={17} />
            )}
          </button>
        </div>
        <nav aria-label="工作区区域">
          {(
            [
              { id: "classroom", label: "课堂展示", Icon: PanelTop },
              { id: "document", label: "文档", Icon: FileText },
            ] as const
          ).map(({ id, label, Icon }) => {
            const count = id === "document" ? items.filter((item) => item.kind === "document").length : 0;
            return (
              <button
                key={id}
                aria-label={label}
                title={count ? `${label} · ${count} 份产物` : label}
                aria-pressed={id === "classroom" ? area !== "document" : area === id}
                onClick={() => switchArea(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                {count > 0 && (
                  <small className="deliverable-count" aria-hidden="true">
                    {count}
                  </small>
                )}
              </button>
            );
          })}
        </nav>
        <div className="deliverable-sidebar-content" hidden={sidebarCollapsed}>
          {(
            <>
              <div className="deliverable-list-heading">
                <span>{area === "document" ? "文档" : "课堂材料"}</span>
                <button
                  aria-label="刷新产物"
                  title="刷新产物"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="deliverable-list">
                {items
                  .filter((i) => i.kind === (area === "document" ? "document" : "presentation"))
                  .map((i) => (
                    <button
                      key={i.id}
                      aria-label={i.source === "classroom" ? "当前课堂" : i.title}
                      aria-current={i.id === item?.id ? "true" : undefined}
                      onClick={() => void choose(i)}
                    >
                      <span>{i.source === "classroom" ? "当前课堂" : i.title}</span>
                      <small>
                        {i.blocks.length}{" "}
                        {i.kind === "presentation" ? "页" : "节"}
                      </small>
                    </button>
                  ))}
                {!loading && !items.some((i) => i.kind === (area === "document" ? "document" : "presentation")) && (
                  <p className="deliverable-empty-list">
                    建立课程后，课堂 PPT 和课程文档会自动形成。
                  </p>
                )}
              </div>
              {item && item.source !== "classroom" && (
                <nav className="deliverable-outline" aria-label="产物目录">
                  {item.blocks.map((b, index) => (
                    <button
                      key={b.id}
                      aria-current={b.id === block?.id ? "location" : undefined}
                      onClick={() => void choose(item, b.id)}
                    >
                      <small>{index + 1}</small>
                      <span>{b.title}</span>
                    </button>
                  ))}
                </nav>
              )}
              {area !== "document" && (
                <>
                  <input
                    hidden
                    ref={upload}
                    type="file"
                    accept=".ppt,.pptx"
                    aria-label="导入 PPT 文件"
                    onChange={(e) => void importFile(e.target.files?.[0])}
                  />
                  <button
                    className="deliverable-import"
                    disabled={!courseId || working}
                    onClick={() => upload.current?.click()}
                  >
                    <Upload size={15} />
                    导入 PPT
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </aside>
      <div className="deliverable-main" ref={preview}>
        {error && (
          <div className="deliverable-error" role="alert">
            {error}
          </div>
        )}
        {area === "classroom" && (
          <header className="deliverable-toolbar">
            <div>
              <span className="deliverable-kicker">课堂 · 图文与练习同步收录到 PPT</span>
              <h2>{item?.title ?? "课堂展示"}</h2>
            </div>
            <button disabled={working || !item || !courseId} onClick={() => void download()}>
              <Download size={16} />
              {working ? "正在处理…" : "下载 PPTX"}
            </button>
          </header>
        )}
        <div className="deliverable-classroom" hidden={area !== "classroom"}>
          {children || (
            <div className="deliverable-placeholder">
              <PanelTop size={30} />
              <h2>课堂展示</h2>
              <p>讲解、课件与互动练习会在这里展开。</p>
            </div>
          )}
        </div>
        {area !== "classroom" &&
          (item && block && courseId ? (
            <>
              <header className="deliverable-toolbar">
                <div>
                  <span className="deliverable-kicker">
                    {item.kind === "presentation" ? "课堂材料" : "文档"}
                    {item.source === "course-document" ? " · 随课程更新" : ` · 修订 ${item.revision}`}
                  </span>
                  <h2>{item.title}</h2>
                </div>
                <button disabled={working} onClick={() => void download()}>
                  <Download size={16} />
                  {working
                    ? "正在处理…"
                    : item.kind === "presentation"
                      ? "下载 PPTX"
                      : "下载 Word"}
                </button>
              </header>
              <div className="deliverable-review-hint">
                {item.source === "course-document" ? "文档随课程内容更新；在对话中提出修改要求。" : `已选中：${block.title} · 在对话中告诉知芽需要怎样修改。`}
              </div>
              {item.importNotes?.length ? (
                <details className="deliverable-import-notes">
                  <summary>导入说明 · 请核对原课件</summary>
                  <ul>
                    {item.importNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {item.kind === "presentation" ? (
                <section className="deliverable-preview" aria-label="PPT 预览">
                  <div className="deliverable-slide">
                    <Suspense fallback={<p>正在排版课件…</p>}>
                      <SlideCanvas
                        slide={{
                          id: block.id,
                          kind: "slide",
                          title: block.title,
                          markdown: `# ${block.title.replace(/[\\`*_{}\[\]()#+.!>|$-]/g, "\\$&")}\n\n${block.markdown}`,
                        }}
                      />
                    </Suspense>
                  </div>
                  <details className="deliverable-full-content">
                    <summary>完整内容 · 下载时自动续页</summary>
                    <div
                      className="deliverable-prose"
                      dangerouslySetInnerHTML={{
                        __html: markdown.render(block.markdown),
                      }}
                    />
                  </details>
                  <Pictures
                    courseId={courseId}
                    ids={block.imageIds}
                    title={block.title}
                  />
                </section>
              ) : (
                <section className="deliverable-preview" aria-label="文档预览">
                  <article className="deliverable-paper">
                    <h1>{item.title}</h1>
                    {item.blocks.map((b) => (
                      <section
                        key={b.id}
                        className={b.id === block.id ? "is-selected" : ""}
                        onClick={() => void choose(item, b.id)}
                      >
                        <h2>{b.title}</h2>
                        <div
                          className="deliverable-prose"
                          dangerouslySetInnerHTML={{
                            __html: markdown.render(b.markdown),
                          }}
                        />
                        <Pictures
                          courseId={courseId}
                          ids={b.imageIds}
                          title={b.title}
                        />
                      </section>
                    ))}
                  </article>
                </section>
              )}
            </>
          ) : (
            <div className="deliverable-placeholder">
              {area === "presentation" ? (
                <Presentation size={32} />
              ) : (
                <FileText size={32} />
              )}
              <h2>
                {area === "presentation"
                  ? "把想法整理成演示文稿"
                  : "把知识整理成一份文档"}
              </h2>
              <p>
                {area === "presentation"
                  ? "通过对话制作图文课件，或导入已有 PPT 继续修改。"
                  : "课程文档随教学内容自动形成，也可以通过对话补充教程、教案或练习。"}
              </p>
              <small>
                {working
                  ? "正在导入课件…"
                  : "选择右侧产物，审阅后通过对话修改。"}
              </small>
            </div>
          ))}
      </div>
    </section>
  );
}
