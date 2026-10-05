import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  ChevronDown,
  Copy,
  Download,
  Globe,
  Lock,
  Users,
  Share2,
  X,
} from "lucide-react";
import { api } from "../../api";
import type { Deliverable } from "../../domain/deliverable";
import { listClasses, type Classroom } from "../classes/classes";
import "./sharing.css";

type Settings = { token: string; visibility: "private" | "public" | "class"; classIds?: string[] };

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
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [classLoading, setClassLoading] = useState(true);
  const [classError, setClassError] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Settings["visibility"]>("private");
  const active = useRef(false);
  const link = useRef<HTMLInputElement>(null);
  const path = `/courses/${courseId}/deliverables/${item.id}/share`;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void api<Settings>(path).then(
      (result) => {
        if (!cancelled) {
          setSettings(result);
          setSelectedClasses(result.classIds ?? []);
          setVisibility(result.visibility);
        }
      },
      (reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "分享设置加载失败",
          );
      },
    );
    void listClasses().then(
      result => { if (!cancelled) setClasses(result); },
      () => { if (!cancelled) setClassError("班级列表加载失败，请重新打开分享设置。其他分享权限仍可使用。"); },
    ).finally(() => { if (!cancelled) setClassLoading(false); });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [path]);
  const change = async (visibility: Settings["visibility"], classIds: string[] = []) => {
    if (saving || !settings) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Settings>(path, "PUT", { visibility, classIds });
      if (active.current) {
        setSettings(result);
        setVisibility(result.visibility);
        setSelectedClasses(result.classIds ?? []);
        setNotice(
          visibility === "public"
            ? "已开放分享，可复制链接。"
            : visibility === "class"
              ? "已分享给所选班级，成员登录后可查看。"
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
              data-selected={visibility === value}
            >
              <input
                type="radio"
                name="share-visibility"
                value={value}
                checked={visibility === value}
                onChange={() => void change(value)}
              />
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
          <label className="share-option" data-selected={visibility === "class"}>
            <input type="radio" name="share-visibility" value="class" checked={visibility === "class"}
              onChange={() => { setVisibility("class"); setNotice(""); setError(""); }} />
            <Users size={20} aria-hidden="true" />
            <span><strong>分享到班级</strong><small>任一所选班级的当前成员登录后可查看</small></span>
          </label>
          {visibility === "class" && <fieldset className="share-class-choice" disabled={classLoading || !!classError}>
            <legend>分享到哪些班级</legend>
            {classes.map(classroom => <label key={classroom.id} className="share-class-option">
              <input type="checkbox" checked={selectedClasses.includes(classroom.id)} onChange={event => {
                setNotice("");
                setSelectedClasses(current => event.target.checked ? [...current, classroom.id] : current.filter(id => id !== classroom.id));
              }} />
              <span>{classroom.name}</span>
            </label>)}
            <small>{classLoading ? "正在读取班级…" : classError || (classes.length ? "可多选，保存后生效；未保存时保持原权限。" : "先加入或创建班级，即可使用班级分享。")}</small>
            {selectedClasses.some(id => !classes.some(classroom => classroom.id === id)) && !classLoading && !classError && <small>部分原班级已不可用，保存时将移除这些班级。</small>}
            <button type="button" className="primary share-done" disabled={saving || !selectedClasses.some(id => classes.some(classroom => classroom.id === id))}
              onClick={() => void change("class", selectedClasses.filter(id => classes.some(classroom => classroom.id === id)))}>保存班级分享</button>
          </fieldset>}
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
              className="secondary"
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
          选择班级分享或公开分享后生成分享链接。
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
      <Dialog.Close className="secondary share-done">完成</Dialog.Close>
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
          className="secondary share-actions-trigger"
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
          <Dialog.Close className="icon-button share-close" aria-label="关闭分享设置">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
