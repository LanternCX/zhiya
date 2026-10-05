import { useMemo, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { FileTextIcon, XIcon } from "lucide-react";
import {
  MessageResponse,
  type MessageResponseProps,
} from "../../components/ai-elements/message";
import { api } from "../../api";
import type { MaterialContent } from "../../domain/learning";
import {
  parseMaterialReference,
  type MaterialReference,
} from "./material-reference";

function Citation({
  courseId,
  reference,
  children,
}: {
  courseId: string;
  reference: MaterialReference;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<MaterialContent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    if (loading || content) return;
    setLoading(true);
    setError("");
    try {
      const excerpts = await Promise.all(
        reference.ranges.map(async (range) => {
          let startLine = range.startLine;
          const results: MaterialContent[] = [];
          while (startLine <= range.endLine) {
            const query = new URLSearchParams({
              revision: String(reference.revision),
              startLine: String(startLine),
              endLine: String(range.endLine),
            });
            const result = await api<MaterialContent>(
              `/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(reference.materialId)}/content?${query}`,
            );
            results.push(result);
            const next = result.excerpt.nextLine;
            if (!next || next <= startLine) break;
            startLine = next;
          }
          return results;
        }),
      );
      setContent(excerpts.flat());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法读取引用内容");
    } finally {
      setLoading(false);
    }
  };
  const warnings = [
    ...new Set(content?.flatMap((item) => item.excerpt.warnings) ?? []),
  ];
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void load();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`查看引用：${typeof children === "string" ? children : "文件"}`}
          className="mx-1 inline-flex max-w-56 items-center gap-1 rounded-full bg-muted px-2 py-0.5 align-baseline text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <FileTextIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{children}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="文件引用"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(26rem,calc(100vw-24px))] rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {content?.[0]?.material.name ?? children}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                版本 {reference.revision} ·{" "}
                {reference.ranges
                  .map((range) => `L${range.startLine}–${range.endLine}`)
                  .join("、")}
              </div>
            </div>
            <Popover.Close
              aria-label="关闭引用"
              className="rounded p-1 hover:bg-muted"
            >
              <XIcon className="size-4" />
            </Popover.Close>
          </div>
          <div className="max-h-80 overflow-y-auto overscroll-contain">
            {loading && <p role="status">正在读取引用…</p>}
            {error && (
              <div role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 underline"
                >
                  重试
                </button>
              </div>
            )}
            {warnings.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                解析提示：{warnings.join("；")}
              </p>
            )}
            {content?.map((item, index) => (
              <div key={index} className="mb-3 border-t pt-3">
                {item.excerpt.lines.length === 0 && (
                  <p>这个范围没有可引用的内容。</p>
                )}
                {item.excerpt.lines.map((line) => (
                  <div key={line.number} className="mb-2 flex gap-3">
                    <span className="w-9 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                      L{line.number}
                    </span>
                    <div className="min-w-0">
                      <div className="mb-1 text-xs text-muted-foreground">
                        {line.source.slide
                          ? `第 ${line.source.slide} 张幻灯片`
                          : line.source.page
                            ? `第 ${line.source.page} 页`
                            : line.source.image
                              ? "图片"
                              : ""}
                        {line.kind === "description"
                          ? " · 模型描述"
                          : line.kind === "transcription"
                            ? " · 图像文字识别"
                            : ""}
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        {line.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CourseMessageResponse({
  courseId,
  ...props
}: MessageResponseProps & { courseId?: string }) {
  const components = useMemo<MessageResponseProps["components"]>(
    () => ({
      a: ({ href, children, node: _node, ...attributes }) => {
        const reference = href ? parseMaterialReference(href) : null;
        if (reference && courseId)
          return (
            <Citation key={href} courseId={courseId} reference={reference}>
              {children}
            </Citation>
          );
        return (
          <a {...attributes} href={href} rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [courseId],
  );
  return <MessageResponse {...props} components={components} />;
}
