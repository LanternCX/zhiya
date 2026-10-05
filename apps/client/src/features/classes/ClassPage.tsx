import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { Link, useNavigate, useParams } from "react-router";
import type { User } from "../../api";
import Icon from "../../components/Icon";
import {
  createClass,
  getClass,
  invitation,
  joinClass,
  listClasses,
  roleNames,
  type Classroom,
  type ClassMember,
} from "./classes";
import "./classes.css";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "暂时无法完成操作，请重试";
}

export default function ClassPage({ user }: { user: User }) {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [all, setAll] = useState<Classroom[]>([]);
  const [current, setCurrent] = useState<Classroom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<"create" | "join" | "invite" | null>(null);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const operation = useRef(false);
  const invitationRequest = useRef(0);
  const pageGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    pageGeneration.current++;
    setLoading(true);
    setError("");
    setCurrent(null);
    setDialog(null);
    invitationRequest.current++;
    setBusy(false);
    setConfirmReset(false);
    const request = classId
      ? getClass(classId).then(value => { if (active) setCurrent(value); })
      : listClasses().then(value => { if (active) setAll(value); });
    request
      .catch(error => { if (active) setError(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      invitationRequest.current++;
      pageGeneration.current++;
    };
  }, [classId, user.id, reload]);

  function open(next: "create" | "join" | "invite") {
    setDraft("");
    setCode("");
    setDialogError("");
    setNotice("");
    setBusy(false);
    setDialog(next);
    if (next === "invite" && current) {
      const request = ++invitationRequest.current;
      setBusy(true);
      invitation(current.id)
        .then(code => { if (invitationRequest.current === request) setCode(code); })
        .catch(error => { if (invitationRequest.current === request) setDialogError(errorText(error)); })
        .finally(() => { if (invitationRequest.current === request) setBusy(false); });
    }
  }
  function close() {
    if (operation.current) return;
    invitationRequest.current++;
    setDialog(null);
    setBusy(false);
    setConfirmReset(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const generation = pageGeneration.current;
    operation.current = true;
    setBusy(true);
    setDialogError("");
    try {
      const classroom = dialog === "create" ? await createClass(draft.trim()) : await joinClass(draft.trim());
      if (generation !== pageGeneration.current) return;
      setDialog(null);
      setNotice("");
      if (classroom.id === classId) { setCurrent(classroom); }
      else void navigate(`/classes/${encodeURIComponent(classroom.id)}`);
    } catch (error) {
      if (generation === pageGeneration.current) setDialogError(errorText(error));
    } finally {
      operation.current = false;
      if (generation === pageGeneration.current) setBusy(false);
    }
  }
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("邀请码已复制，可以分享给老师和学生");
    } catch { setDialogError("复制失败，请选中邀请码手动复制"); }
  }
  async function resetInvitation() {
    if (!current || operation.current) return;
    const generation = pageGeneration.current;
    operation.current = true;
    setBusy(true);
    setDialogError("");
    setNotice("");
    try {
      const next = await invitation(current.id, true);
      if (generation !== pageGeneration.current) return;
      setCode(next);
      setNotice("邀请码已重置，旧码已失效");
    } catch (error) {
      if (generation === pageGeneration.current) setDialogError(errorText(error));
    } finally {
      operation.current = false;
      if (generation === pageGeneration.current) setBusy(false);
    }
  }
  const head = current?.headTeacherId === user.id;
  const title = confirmReset ? "重置邀请码？" : dialog === "create" ? "创建班级" : dialog === "join" ? "加入班级" : "邀请成员";

  return (
    <div className="classes-page">
      {classId && <button className="class-back text-button" onClick={() => void navigate("/classes")}><Icon name="back" />返回班级</button>}
      {loading ? <p role="status" className="class-empty">正在读取班级…</p> : error ? (
        <div className="class-empty"><Icon name="classroom" /><p role="alert">{error}</p><button className="secondary" onClick={()=>setReload(value=>value+1)}>重新读取</button></div>
      ) : current ? (
        <>
          <header className="class-detail-header">
            <div className="class-emblem"><Icon name="classroom" /></div>
            <div className="class-heading"><p className="class-eyebrow">一起探索，一起成长</p><h1>{current.name}</h1><p>{current.headTeacherName} · 班主任<span aria-hidden="true"> / </span>{current.memberCount} 位成员</p></div>
            {head && <button className="primary" onClick={()=>open("invite")}><Icon name="invite" />邀请成员</button>}
          </header>
          <div className="class-member-sections">
            {(["head_teacher","teacher","student"] as const).map(role => {
              const members=(current.members??[]).filter(member=>member.role===role);
              return <section className="class-member-section" key={role} aria-label={roleNames[role]}>
                <div className="class-group-heading"><h2><Icon name={role==="student"?"student":"teacher"} />{roleNames[role]}</h2><span>{members.length} 人</span></div>
                {members.length ? <div className="class-member-grid">{members.map(member=><MemberCard key={member.id} member={member} self={member.id===user.id}/>)}</div> : <p className="class-group-empty">{role==="teacher"?"还没有任课老师加入":"还没有学生加入"}</p>}
              </section>;
            })}
          </div>
        </>
      ) : (
        <>
          <header className="class-library-header">
            <div><p className="class-eyebrow">知芽 · 班级空间</p><h1>我的班级</h1><p>{user.role==="teacher"?"把老师和学生聚在一起，让探索有个共同的起点。":"找到你的班级，和老师、同学一起探索新知识。"}</p></div>
            <div className="class-actions"><button className="secondary" onClick={()=>open("join")}><Icon name="invite"/>加入班级</button>{user.role==="teacher"&&<button className="primary" onClick={()=>open("create")}><Icon name="plus"/>创建班级</button>}</div>
          </header>
          {all.length ? <div className="class-card-grid">{all.map(classroom=>(
            <Link className="class-card" key={classroom.id} to={`/classes/${encodeURIComponent(classroom.id)}`}>
              <div className="class-card-top"><div className="class-emblem"><Icon name="classroom"/></div><span className="class-role">{classroom.headTeacherId===user.id?"班主任":user.role==="teacher"?"任课老师":"学生"}</span></div>
              <h2>{classroom.name}</h2><p>{classroom.headTeacherName} · 班主任</p>
              <div className="class-card-footer"><span><Icon name="people"/>{classroom.memberCount} 位成员</span><Icon name="arrow"/></div>
            </Link>
          ))}</div> : <div className="class-empty"><div className="class-empty-art"><Icon name="classroom"/><span className="class-empty-sprout">✦</span></div><h2>你的班级故事，从这里开始</h2><p>{user.role==="teacher"?"创建自己的班级，或用邀请码加入其他老师的班级。":"向班主任获取邀请码，就能加入你的班级。"}</p><button className="secondary" onClick={()=>open(user.role==="teacher"?"create":"join")}>{user.role==="teacher"?"创建第一个班级":"输入邀请码"}</button></div>}
        </>
      )}
      <Dialog.Root open={dialog!==null} onOpenChange={value=>{if(!value)close();}}>
        <Dialog.Portal>
          <Dialog.Overlay className="class-dialog-overlay"/>
          <Dialog.Content className="class-dialog">
            <div className="class-dialog-heading"><Dialog.Title>{title}</Dialog.Title><button className="icon-button" aria-label="关闭" disabled={operation.current} onClick={close}><Icon name="close"/></button></div>
            <Dialog.Description>{confirmReset?"重置后，旧邀请码将无法加入班级。已经加入的成员不受影响。":dialog==="create"?"为新班级取一个名字。创建后，你就是这个班的班主任。":dialog==="join"?"输入班主任分享的邀请码，加入后即可看到班级成员。":"把邀请码分享给老师和学生，他们会按账号身份加入班级。"}</Dialog.Description>
            {confirmReset ? <div className="class-actions"><button className="secondary" onClick={()=>setConfirmReset(false)}>取消</button><button className="primary" onClick={()=>{setConfirmReset(false);void resetInvitation();}}>重置</button></div> : dialog==="invite"?<div className="class-invitation">
              {code?<><div className="class-invitation-code">{code}</div><button className="primary full" disabled={busy} onClick={()=>void copyInvitation()}><Icon name="copy"/>复制邀请码</button><button className="text-button" disabled={busy} onClick={()=>setConfirmReset(true)}>重置邀请码</button></>:busy?<p role="status">正在读取邀请码…</p>:<button className="secondary" onClick={()=>open("invite")}>重新读取</button>}
            </div>:<form onSubmit={event=>void submit(event)}>
              <label htmlFor="class-draft">{dialog==="create"?"班级名称":"邀请码"}</label>
              <input id="class-draft" autoFocus required maxLength={dialog==="create"?80:32} value={draft} onChange={event=>setDraft(event.target.value)} placeholder={dialog==="create"?"例如：人工智能探索班":"请输入邀请码"} autoComplete="off" autoCapitalize={dialog==="join"?"characters":"off"} spellCheck={false} disabled={busy}/>
              <button className="primary full" disabled={busy||!draft.trim()}>{busy?"正在提交…":title}</button>
            </form>}
            {dialogError&&<p className="class-feedback" role="alert">{dialogError}</p>}
            {notice&&<p className="class-feedback class-success" role="status">{notice}</p>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function MemberCard({member,self}:{member:ClassMember;self:boolean}) {
  return <article className="class-member-card" aria-label={member.nickname}>
    <div className={`class-avatar ${member.role==="head_teacher"?"is-head":""}`}>{member.avatar?<img src={member.avatar} alt=""/>:<Icon name={member.role==="student"?"student":"teacher"}/>}</div>
    <div className="class-member-info"><h3>{member.nickname}{self&&<small>你</small>}</h3><span>{roleNames[member.role]}</span></div>
  </article>;
}
