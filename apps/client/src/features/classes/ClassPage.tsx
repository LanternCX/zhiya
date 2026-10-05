import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { User } from "../../api";
import Icon from "../../components/Icon";
import { createClass, getClass, joinClass, leaveClass, listClasses, classPath, roleNames, type Classroom } from "./classes";
import { ClassDialog, errorText } from "./ClassDialog";
import ClassManagement from "./ClassManagement";
import MemberCard from "./MemberCard";
import "./classes.css";

export default function ClassPage({ user, management = false }: { user: User; management?: boolean }) {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [all, setAll] = useState<Classroom[]>([]);
  const [current, setCurrent] = useState<Classroom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<"create" | "join" | "leave" | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const operation = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    setCurrent(null);
    setDialog(null);
    setBusy(false);
    const load = classId
      ? getClass(classId).then(value => { if (generation.current === request) setCurrent(value); })
      : listClasses().then(value => { if (generation.current === request) setAll(value); });
    void load.catch(error => { if (generation.current === request) setError(errorText(error)); })
      .finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current++; };
  }, [classId, user.id, reload]);

  function open(next: typeof dialog) { setDraft(""); setDialogError(""); setDialog(next); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const request = generation.current;
    operation.current = true;
    setBusy(true);
    setDialogError("");
    try {
      if (dialog === "leave" && current) {
        await leaveClass(current.id);
        if (request === generation.current) void navigate("/classes");
      } else {
        const classroom = dialog === "create" ? await createClass(draft.trim()) : await joinClass(draft.trim());
        if (request !== generation.current) return;
        setDialog(null);
        if (classroom.id === classId) setCurrent(classroom);
        else void navigate(classPath(classroom.id));
      }
    } catch (error) { if (request === generation.current) setDialogError(errorText(error)); }
    finally { operation.current = false; if (request === generation.current) setBusy(false); }
  }
  const head = current?.headTeacherId === user.id;
  const title = dialog === "create" ? "创建班级" : dialog === "join" ? "加入班级" : "退出班级？";

  return <div className="classes-page">
    {classId && (management ? <Link className="class-back text-button" to={classPath(classId)}><Icon name="back" />返回班级面板</Link> : <button className="class-back text-button" onClick={() => void navigate("/classes")}><Icon name="back" />返回班级</button>)}
    {loading ? <p role="status" className="class-empty">正在读取班级…</p> : error ? <div className="class-empty"><Icon name="classroom" /><p role="alert">{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>重新读取</button></div> : current ? (
      management ? head ? <ClassManagement classroom={current} onChange={setCurrent} /> : <div className="class-empty"><Icon name="shield" /><p role="alert">只有本班班主任可以管理班级</p></div> : <>
        <header className="class-detail-header">
          <div className="class-emblem"><Icon name="classroom" /></div>
          <div className="class-heading"><p className="class-eyebrow">一起探索，一起成长</p><h1>{current.name}</h1><p>{current.headTeacherName} · 班主任<span aria-hidden="true"> / </span>{current.memberCount} 位成员</p></div>
          {head && <Link className="secondary class-manage-link" to={`${classPath(current.id)}/manage`}><Icon name="settings" />管理班级</Link>}
        </header>
        <div className="class-member-sections">
          {(["head_teacher", "teacher", "student"] as const).map(role => {
            const members = (current.members ?? []).filter(member => member.role === role);
            return <section className="class-member-section" key={role} aria-label={roleNames[role]}>
              <div className="class-group-heading"><h2><Icon name={role === "student" ? "student" : "teacher"} />{roleNames[role]}</h2><span>{members.length} 人</span></div>
              {members.length ? <div className="class-member-grid">{members.map(member => <MemberCard key={member.id} member={member} self={member.id === user.id} />)}</div> : <p className="class-group-empty">{role === "teacher" ? "还没有任课老师加入" : "还没有学生加入"}</p>}
            </section>;
          })}
        </div>
        {!head && user.role === "teacher" && <div className="class-leave"><button className="text-button" onClick={() => open("leave")}><Icon name="logout" />退出班级</button></div>}
      </>
    ) : <>
      <header className="class-library-header">
        <div><p className="class-eyebrow">知芽 · 班级空间</p><h1>我的班级</h1><p>{user.role === "teacher" ? "把老师和学生聚在一起，让探索有个共同的起点。" : "找到你的班级，和老师、同学一起探索新知识。"}</p></div>
        <div className="class-actions"><button className="secondary" onClick={() => open("join")}><Icon name="invite" />加入班级</button>{user.role === "teacher" && <button className="primary" onClick={() => open("create")}><Icon name="plus" />创建班级</button>}</div>
      </header>
      {all.length ? <div className="class-card-grid">{all.map(classroom => <Link className="class-card" key={classroom.id} to={classPath(classroom.id)}>
        <div className="class-card-top"><div className="class-emblem"><Icon name="classroom" /></div><span className="class-role">{classroom.headTeacherId === user.id ? "班主任" : user.role === "teacher" ? "任课老师" : "学生"}</span></div>
        <h2>{classroom.name}</h2><p>{classroom.headTeacherName} · 班主任</p>
        <div className="class-card-footer"><span><Icon name="people" />{classroom.memberCount} 位成员</span><Icon name="arrow" /></div>
      </Link>)}</div> : <div className="class-empty"><div className="class-empty-art"><Icon name="classroom" /><span className="class-empty-sprout">✦</span></div><h2>你的班级故事，从这里开始</h2><p>{user.role === "teacher" ? "创建自己的班级，或用邀请码加入其他老师的班级。" : "向班主任获取邀请码，就能加入你的班级。"}</p><button className="secondary" onClick={() => open(user.role === "teacher" ? "create" : "join")}>{user.role === "teacher" ? "创建第一个班级" : "输入邀请码"}</button></div>}
    </>}
    {dialog && <ClassDialog title={title} description={dialog === "create" ? "为新班级取一个名字。创建后，你就是这个班的班主任。" : dialog === "join" ? "输入班主任分享的邀请码，加入后即可看到班级成员。" : `退出“${current?.name}”后，你将无法查看班级成员。个人课程和学习记录会保留。`} busy={busy} close={() => { if (!operation.current) setDialog(null); }}>
      <form onSubmit={event => void submit(event)}>
        {dialog !== "leave" && <><label htmlFor="class-draft">{dialog === "create" ? "班级名称" : "邀请码"}</label><input id="class-draft" required maxLength={dialog === "create" ? 80 : 32} value={draft} onChange={event => setDraft(event.target.value)} placeholder={dialog === "create" ? "例如：人工智能探索班" : "请输入邀请码"} autoComplete="off" autoCapitalize={dialog === "join" ? "characters" : "off"} spellCheck={false} disabled={busy} /></>}
        <button className="primary full" disabled={busy || (dialog !== "leave" && !draft.trim())}>{busy ? "正在提交…" : dialog === "leave" ? "确认退出" : title}</button>
      </form>
      {dialogError && <p className="class-feedback" role="alert">{dialogError}</p>}
    </ClassDialog>}
  </div>;
}
