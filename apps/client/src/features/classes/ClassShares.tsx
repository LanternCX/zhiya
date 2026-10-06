import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, FileText, Presentation, RefreshCw, FolderOpen } from "lucide-react";
import { api } from "../../api";
import { classPath } from "./classes";
import { errorText } from "./ClassDialog";

type Share = {
  token: string;
  title: string;
  kind: string;
  teacherName: string;
  updatedAt: string;
};

export default function ClassShares({ classId, className, preview = false }: { classId: string; className: string; preview?: boolean }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setShares([]);
    void api<{ shares: Share[] }>(`${classPath(classId)}/shares`).then(
      result => { if (!cancelled) setShares(result.shares); },
      reason => { if (!cancelled) setError(errorText(reason)); },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [classId, reload]);
  if (preview) return <Link className="class-materials-entry" to={`${classPath(classId)}/shares`}>
    <FolderOpen size={22} aria-hidden="true" />
    <span>教师分享</span><small>{loading ? "正在读取…" : error ? "查看材料" : `${shares.length} 份材料`}</small>
    <ArrowRight size={18} aria-hidden="true" />
  </Link>;
  return <section className="class-materials-page">
    <header className="class-library-header">
      <div><p className="class-eyebrow">{className}</p><h1>教师分享</h1><p>本班的 PPT 与文档，打开查看最新内容{!loading && !error ? ` · ${shares.length} 份材料` : ""}</p></div>
      <button className="icon-button" aria-label="刷新材料" aria-busy={loading} title="刷新材料" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button>
    </header>
    {loading ? <p role="status" className="class-empty">正在读取分享材料…</p> : error ? <p role="alert" className="class-feedback">{error}</p> : shares.length ? <ul className="class-material-grid" aria-label="分享材料">
      {shares.map(share => <li key={share.token}>
        <Link className="class-material-card" aria-label={share.title} to={`/shares/${encodeURIComponent(share.token)}`} target="_blank" rel="noopener noreferrer">
          <div className="class-material-cover" data-kind={share.kind}>
            {share.kind === "document" ? <FileText size={44} strokeWidth={1.4} aria-hidden="true" /> : <Presentation size={44} strokeWidth={1.4} aria-hidden="true" />}
            <span>{share.kind === "document" ? "文档" : "PPT 演示"}</span>
          </div>
          <div className="class-material-info"><h2>{share.title}</h2><p>{share.teacherName}</p><time dateTime={share.updatedAt}>{new Date(share.updatedAt).toLocaleDateString("zh-CN")} 更新</time></div>
        </Link>
      </li>)}
    </ul> : <div className="class-empty"><FolderOpen size={40} aria-hidden="true" /><h2>还没有教师分享材料</h2><p>老师分享给本班的 PPT 和文档会出现在这里。</p></div>}
  </section>;
}
