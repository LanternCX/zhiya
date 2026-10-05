import { usePolicy } from "./Policy";
import { api } from "../../api";
import type { User } from "../../api";
import { Field, Form } from "./Form";
import type { AccountController } from "./useAccount";
import { useEffect, useRef } from "react";
import Mark from "../../components/Mark";
type Props = Pick<
  AccountController,
  | "busy"
  | "avatarDraft"
  | "setAvatarDraft"
  | "setError"
  | "run"
  | "refresh"
  | "setNotice"
  | "nickname"
  | "setNickname"
> & { user: User };

export default function Profile({
  user,
  busy,
  avatarDraft,
  setAvatarDraft,
  setError,
  run,
  refresh,
  setNotice,
  nickname,
  setNickname,
}: Props) {
  const rules = usePolicy();
  const fileInput = useRef<HTMLInputElement>(null);
  const reader = useRef<FileReader | null>(null);
  useEffect(() => () => reader.current?.abort(), []);

  return (
    <>
      <p className="description">设置你在知芽使用的名字和头像。</p>
      <p className="registration-identity">账号身份：{user.role === "teacher" ? "老师" : "学生"}</p>
      <section className="avatar-section" aria-label="头像设置">
        <div className="avatar">
          {(avatarDraft ?? user.avatar) ? (
            <img src={avatarDraft ?? user.avatar} alt="当前头像" />
          ) : (
            <Mark />
          )}
        </div>
        <div>
          <p className="section-label">头像</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            aria-label="上传头像"
            className="file-input"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (
                file.size > rules.avatar_max_bytes ||
                !["image/png", "image/jpeg"].includes(file.type)
              ) {
                setError(
                  `请选择 ${rules.avatar_max_bytes / (1024 * 1024)} MB 以内的 PNG 或 JPEG 图片`,
                );
                event.target.value = "";
                return;
              }
              reader.current?.abort();
              const current = new FileReader();
              reader.current = current;
              current.onload = () => {
                if (reader.current === current) {
                  setAvatarDraft(String(current.result));
                  setError("");
                }
              };
              current.onerror = () => setError("无法读取图片，请重新选择");
              current.readAsDataURL(file);
              event.target.value = "";
            }}
          />
          <div className="inline-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              上传头像
            </button>
            {(user.avatar || avatarDraft) && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setAvatarDraft("")}
              >
                恢复默认头像
              </button>
            )}
          </div>
          <p className="hint">
            PNG 或 JPEG，最大 {rules.avatar_max_bytes / (1024 * 1024)} MB，边长不超过 {rules.avatar_max_dimension} 像素
          </p>
          {avatarDraft !== null && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/me/avatar", "PUT", {
                    avatar: avatarDraft,
                  });
                  await refresh();
                  setAvatarDraft(null);
                  setNotice("头像已保存");
                })
              }
            >
              保存头像
            </button>
          )}
        </div>
      </section>
      <Form
        busy={busy}
        submit={() =>
          run(async () => {
            await api("/me", "PATCH", { nickname });
            const saved = await refresh();
            setNickname(saved.nickname);
            setNotice("昵称已保存");
          })
        }
      >
        <Field
          label="昵称"
          name="nickname"
          autoComplete="nickname"
          maxLength={rules.nickname_max_characters}
          value={nickname}
          onChange={setNickname}
        />
        <button className="primary">保存昵称</button>
      </Form>
      <div className="email-summary">
        <span>登录邮箱</span>
        <strong>{user.email}</strong>
        <span className="verified">已验证</span>
      </div>
    </>
  );
}
