import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, APIError } from "../../api";
import type { Deliverable } from "../../domain/deliverable";
import { renderBlock } from "./html";
import "./reader.css";

function SharedPicture({
  token,
  id,
  title,
}: {
  token: string;
  id: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="alert">图片暂时无法加载，请刷新重试。</p>
  ) : (
    <img
      src={`/api/shares/${encodeURIComponent(token)}/images/${encodeURIComponent(id)}`}
      alt={title}
      onError={() => setFailed(true)}
    />
  );
}

export default function SharedDeliverable() {
  const { token = "" } = useParams();
  const [item, setItem] = useState<Deliverable | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [current, setCurrent] = useState(0);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let active = true;
    setItem(null);
    setError("");
    setCurrent(0);
    setReading(false);
    void api<{ deliverable: Deliverable }>(
      `/shares/${encodeURIComponent(token)}`,
    ).then(
      ({ deliverable }) => {
        if (active) {
          setItem(deliverable);
          document.title = `${deliverable.title} · 知芽`;
        }
      },
      (reason) => {
        if (active)
          setError(
            reason instanceof APIError && reason.status === 404
              ? "分享未开放、已关闭或内容不存在。仅自己可见的内容需要所有者登录后查看。"
              : reason instanceof Error
                ? reason.message
                : "分享内容加载失败，请重试",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [token, refresh]);
  useEffect(() => {
    if (item?.kind !== "presentation" || reading) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button, a, input, textarea, select")
      )
        return;
      if (event.key === "ArrowRight")
        setCurrent((index) => Math.min(item.blocks.length - 1, index + 1));
      if (event.key === "ArrowLeft")
        setCurrent((index) => Math.max(0, index - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [item, reading]);
  return (
    <div className="reader-page">
      <header className="reader-header">
        <span className="reader-brand">知芽 · 分享阅读</span>
        <h1>{item?.title ?? "分享内容"}</h1>
        <p>
          {item
            ? "只读分享 · 刷新查看最新保存内容"
            : error
              ? "暂时无法查看"
              : "正在加载…"}
        </p>
        <button
          onClick={() => setRefresh((value) => value + 1)}
          disabled={!item && !error}
        >
          刷新内容
        </button>
      </header>
      {error && (
        <main className="reader-content">
          <section className="reader-section">
            <p role="alert">{error}</p>
            <Link
              className="reader-link"
              to={`/login?returnTo=${encodeURIComponent(`/shares/${token}`)}`}
            >
              登录知芽
            </Link>
          </section>
        </main>
      )}
      {!item && !error && (
        <p className="reader-content" role="status">
          正在加载分享内容…
        </p>
      )}
      {item && (
        <>
          <main className="reader-content">
            {item.blocks.map((block, index) => (
              <section
                className="reader-section"
                key={block.id}
                hidden={
                  item.kind === "presentation" && !reading && current !== index
                }
              >
                <p className="reader-kicker">
                  {index + 1} / {item.blocks.length}
                </p>
                <h2>{block.title}</h2>
                <div dangerouslySetInnerHTML={{ __html: renderBlock(block) }} />
                {block.imageIds.map((id) => (
                  <SharedPicture
                    key={`${refresh}:${id}`}
                    token={token}
                    id={id}
                    title={block.title}
                  />
                ))}
              </section>
            ))}
          </main>
          {item.kind === "presentation" && item.blocks.length > 0 && (
            <nav className="reader-controls" aria-label="翻页">
              <button
                disabled={reading || current === 0}
                onClick={() => setCurrent((index) => index - 1)}
              >
                上一页
              </button>
              <output aria-live="polite">
                {reading
                  ? `共 ${item.blocks.length} 页`
                  : `${current + 1} / ${item.blocks.length}`}
              </output>
              <button
                disabled={reading || current === item.blocks.length - 1}
                onClick={() => setCurrent((index) => index + 1)}
              >
                下一页
              </button>
              <button onClick={() => setReading((value) => !value)}>
                {reading ? "分页演示" : "阅读全部"}
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
