import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ChevronDownIcon, FileTextIcon, SearchIcon, XIcon } from "lucide-react";
import { api } from "../../api";
import {
  readObjectBlob,
  type ObjectRequest,
} from "../../transport/object-storage";
import type { KnowledgeSource, KnowledgeSearch } from "../../domain/knowledge";
import { Spinner } from "../../components/ui/spinner";

function locationText(source: KnowledgeSource) {
  if (source.location.page) return `第 ${source.location.page} 页`;
  if (source.location.start_seconds !== undefined)
    return `${source.location.start_seconds.toFixed(1)}–${source.location.end_seconds?.toFixed(1) ?? "?"} 秒`;
  return source.modality === "image"
    ? "图片"
    : source.modality === "video"
      ? "视频"
      : "文本";
}

export function KnowledgeCitation({
  version,
  blockId,
  children,
}: {
  version: string;
  blockId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState<KnowledgeSource | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [image, setImage] = useState(""),
    [original, setOriginal] = useState("");
  const blobURL = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (blobURL.current) URL.revokeObjectURL(blobURL.current);
    };
  }, []);
  async function load() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const path = `/knowledge/${encodeURIComponent(version)}/blocks/${encodeURIComponent(blockId)}`;
      const result = await api<KnowledgeSource>(path);
      if (!mounted.current) return;
      setSource(result);
      const file = await api<ObjectRequest>(path + "/original");
      if (!mounted.current) return;
      setOriginal(file.url);
      if (result.hasAsset && result.modality === "image") {
        const request = await api<ObjectRequest>(path + "/asset");
        const blob = await readObjectBlob(request);
        if (!mounted.current) return;
        if (blobURL.current) URL.revokeObjectURL(blobURL.current);
        blobURL.current = URL.createObjectURL(blob);
        setImage(blobURL.current);
      }
    } catch (failure) {
      if (mounted.current) {
        setSource(null);
        setError(
          failure instanceof Error ? failure.message : "无法读取知识库引用",
        );
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
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
          aria-label={`查看引用：${typeof children === "string" ? children : "知识库资料"}`}
          className="mx-1 inline-flex max-w-56 items-center gap-1 rounded-full bg-muted px-2 py-0.5 align-baseline text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <FileTextIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{children}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="知识库引用"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(26rem,calc(100vw-24px))] rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {source?.title ?? children}
              </div>
              {source && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {locationText(source)}
                </div>
              )}
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
            {image && (
              <img
                src={image}
                alt={`${source?.title ?? "知识库资料"}的来源页面`}
                className="mb-3 w-full rounded-lg border"
              />
            )}
            {source?.text && (
              <p className="whitespace-pre-wrap break-words">{source.text}</p>
            )}
            {source?.visual && (
              <div className="mt-3 border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  页面文字与视觉解析 · 模型描述
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {source.visual.transcription}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {source.visual.description}
                </p>
              </div>
            )}
            {source && !source.text && !source.visual && (
              <p className="text-muted-foreground">
                请查看来源页面或原文件。此资料没有可读取的文本。
              </p>
            )}
            {source?.warnings.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                资料提示：{source.warnings.join("；")}
              </p>
            ) : null}
          </div>
          {original && (
            <a
              href={original}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs underline"
            >
              查看原文件
            </a>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function KnowledgeSearchProgress({
  searches,
}: {
  searches: KnowledgeSearch[];
}) {
  const active = searches.some((search) => search.status === "running");
  const [expanded, setExpanded] = useState(active);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) setExpanded(true);
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [searches, active]);
  if (!searches.length) return null;
  const count = new Set(
    searches.flatMap((search) =>
      search.sources.map((source) => source.version + "/" + source.blockId),
    ),
  ).size;
  return (
    <div
      className="my-2 rounded-xl border border-border/60 bg-muted/20 text-sm"
      aria-label="知识库搜索过程"
    >
      <button
        type="button"
        aria-label={
          active ? "正在搜索知识库" : `已搜索知识库 · ${count} 份资料`
        }
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        {active ? <Spinner /> : <SearchIcon className="size-4" />}
        <span role="status">
          {active ? "正在搜索知识库" : `已搜索知识库 · ${count} 份资料`}
        </span>
        <ChevronDownIcon
          className={`ml-auto size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div
          ref={scroll}
          className="max-h-48 overflow-y-auto overscroll-contain border-t border-border/60 px-3 py-2"
          role="log"
          aria-live="polite"
        >
          {searches.map((search) => (
            <div key={search.id} className="mb-3 last:mb-0">
              <p className="mb-1 break-words text-xs text-muted-foreground">
                {search.query}
              </p>
              {search.status === "running" && (
                <p className="text-xs text-muted-foreground">
                  正在查找相关资料…
                </p>
              )}
              {search.status === "error" && (
                <p className="text-xs text-destructive">
                  搜索失败：{search.error ?? "请稍后重试"}
                </p>
              )}
              {search.status === "complete" && !search.sources.length && (
                <p className="text-xs text-muted-foreground">未找到相关资料</p>
              )}
              {search.sources.map((source) => (
                <div
                  key={source.version + source.blockId}
                  className="flex min-w-0 items-center gap-1 py-1"
                >
                  <KnowledgeCitation
                    version={source.version}
                    blockId={source.blockId}
                  >
                    {source.title}
                  </KnowledgeCitation>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {locationText(source)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
