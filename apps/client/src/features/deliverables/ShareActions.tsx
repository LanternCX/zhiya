import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  ChevronDown,
  Copy,
  Download,
  Globe,
  Lock,
  Share2,
  X,
} from "lucide-react";
import { api } from "../../api";
import type { Deliverable } from "../../domain/deliverable";
import "./sharing.css";

type Settings = { token: string; visibility: "private" | "public" };

function shareURL(token: string): string {
  const origin = isTauri()
    ? __ZHIYA_CLIENT_CONFIG__.apiOrigin
    : window.location.origin;
  return `${origin}/#/shares/${encodeURIComponent(token)}`;
}

function ShareSettings({
  courseId,
  item,
}: {
  courseId: string;
  item: Deliverable;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const link = useRef<HTMLInputElement>(null);
  const path = `/courses/${courseId}/deliverables/${item.id}/share`;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void api<Settings>(path).then(
      (result) => {
        if (!cancelled) setSettings(result);
      },
      (reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "分享设置加载失败",
          );
      },
    );
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [path]);
  const change = async (visibility: Settings["visibility"]) => {
    if (saving || !settings || settings.visibility === visibility) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Settings>(path, "PUT", { visibility });
      if (active.current) {
        setSettings(result);
        setNotice(
          visibility === "public"
            ? "已开放分享，可复制链接。"
            : "已关闭外部访问，链接保持不变。",
        );
      }
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error ? reason.message : "权限保存失败，请重试",
        );
    } finally {
      if (active.current) setSaving(false);
    }
  };
  const url = settings?.token ? shareURL(settings.token) : "";
  const copy = async () => {
    setNotice("");
    try {
      await navigator.clipboard.writeText(url);
      if (active.current) setNotice("链接已复制。");
    } catch {
      if (active.current) {
        link.current?.focus();
        link.current?.select();
        setNotice("请复制已选中的链接。");
      }
    }
  };
  return (
    <>
      <Dialog.Title className="share-title">分享设置</Dialog.Title>
      <Dialog.Description className="share-description">
        {item.title} · 链接始终显示最新保存内容
      </Dialog.Description>
      {!settings && !error && <p role="status">正在加载分享设置…</p>}
      {settings && (
        <fieldset className="share-options" disabled={saving}>
          <legend>谁可以查看</legend>
          {(
            [
              {
                value: "private",
                title: "仅自己可见",
                description: "外部用户无法通过链接查看",
                Icon: Lock,
              },
              {
                value: "public",
                title: "获得链接的任何人可见",
                description: "无需登录，分享页仅供查看",
                Icon: Globe,
              },
            ] as const
          ).map(({ value, title, description, Icon }) => (
            <label
              key={value}
              className="share-option"
              data-selected={settings.visibility === value}
            >
              <input
                type="radio"
                name="share-visibility"
                value={value}
                checked={settings.visibility === value}
                onChange={() => void change(value)}
              />
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {url && (
        <div className="share-link-row">
          <label htmlFor="share-link">固定分享链接</label>
          <div>
            <input
              ref={link}
              id="share-link"
              value={url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button
              onClick={() => void copy()}
              disabled={saving}
              aria-label="复制分享链接"
            >
              <Copy size={16} />
              复制
            </button>
          </div>
          {settings?.visibility === "private" && (
            <small>当前仅自己可见，开放后可通过此链接分享。</small>
          )}
        </div>
      )}
      {!url && settings && (
        <p className="share-description">
          选择“获得链接的任何人可见”后生成分享链接。
        </p>
      )}
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
      <p className="share-status" role="status">
        {saving ? "正在保存权限…" : notice}
      </p>
      <Dialog.Close className="share-done">完成</Dialog.Close>
    </>
  );
}

export default function ShareActions({
  courseId,
  item,
  working,
  onDownload,
}: {
  courseId?: string;
  item?: Deliverable;
  working: boolean;
  onDownload: (format: "office" | "html") => void;
}) {
  const [sharing, setSharing] = useState(false);
  useEffect(() => setSharing(false), [courseId, item?.id]);
  return (
    <Dialog.Root open={sharing} onOpenChange={setSharing}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="share-actions-trigger"
          disabled={working || !item || !courseId}
        >
          <Download size={16} aria-hidden="true" />
          {working ? "正在处理…" : "导出与分享"}
          <ChevronDown size={14} aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="share-menu"
            align="end"
            sideOffset={6}
          >
            <DropdownMenu.Item
              className="share-menu-item"
              onSelect={() => onDownload("office")}
            >
              <Download size={16} />
              {item?.kind === "document" ? "下载 Word" : "下载 PPTX"}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="share-menu-item"
              onSelect={() => onDownload("html")}
            >
              <Download size={16} />
              下载 HTML 单文件
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="share-menu-rule" />
            <DropdownMenu.Item
              className="share-menu-item"
              onSelect={() => setSharing(true)}
            >
              <Share2 size={16} />
              分享设置
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog.Portal>
        <Dialog.Overlay className="share-overlay" />
        <Dialog.Content className="share-dialog">
          {sharing && item && courseId && (
            <ShareSettings
              key={`${courseId}:${item.id}`}
              courseId={courseId}
              item={item}
            />
          )}
          <Dialog.Close className="share-close" aria-label="关闭分享设置">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
