import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DropdownMenu, Tabs } from "radix-ui";
import Icon from "../../components/Icon";
import { ClassDialog, errorText } from "./ClassDialog";
import MemberCard from "./MemberCard";
import { allowMember, classPath, dissolveClass, invitation, removedMembers, removeMember, renameClass, roleNames, transferClass, type Classroom, type ClassMember } from "./classes";

type Action = { kind: "invite" } | { kind: "transfer" } | { kind: "dissolve" } | { kind: "remove"; member: ClassMember } | { kind: "allow"; member: ClassMember };

export default function ClassManagement({ classroom, onChange }: { classroom: Classroom; onChange: (value: Classroom) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(classroom.name);
  const [action, setAction] = useState<Action | null>(null);
  const [code, setCode] = useState("");
  const [reset, setReset] = useState(false);
  const [target, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogNotice, setDialogNotice] = useState("");
  const [removed, setRemoved] = useState<ClassMember[]>([]);
  const [removedLoading, setRemovedLoading] = useState(false);
  const [removedError, setRemovedError] = useState("");
  const [tab, setTab] = useState("settings");
  const operation = useRef(false);
  const generation = useRef(0);
  const codeRequest = useRef(0);
  const removedRequest = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => { generation.current++; codeRequest.current++; removedRequest.current++; };
  }, []);

  async function loadRemoved() {
    const request = ++removedRequest.current;
    setRemovedLoading(true);
    setRemovedError("");
    try {
      const members = await removedMembers(classroom.id);
      if (request === removedRequest.current) setRemoved(members);
    } catch (error) { if (request === removedRequest.current) setRemovedError(errorText(error)); }
    finally { if (request === removedRequest.current) setRemovedLoading(false); }
  }
  function selectTab(value: string) {
    setTab(value);
    if (value === "removed") void loadRemoved();
  }
  async function loadCode() {
    const request = ++codeRequest.current;
    setLoadingCode(true);
    setDialogError("");
    try {
      const value = await invitation(classroom.id);
      if (request === codeRequest.current) setCode(value);
    } catch (error) { if (request === codeRequest.current) setDialogError(errorText(error)); }
    finally { if (request === codeRequest.current) setLoadingCode(false); }
  }
  function open(next: Action) {
    if (operation.current) return;
    setAction(next);
    setDialogError(""); setDialogNotice(""); setNotice(""); setError("");
    setReset(false); setTarget(""); setConfirmation(""); setCode("");
    if (next.kind === "invite") void loadCode();
  }
  function close() {
    if (operation.current) return;
    codeRequest.current++;
    setAction(null);
  }
  async function run(task: () => Promise<void>, inDialog: boolean) {
    if (operation.current) return;
    const request = generation.current;
    operation.current = true;
    setBusy(true);
    if (inDialog) { setDialogError(""); setDialogNotice(""); }
    else { setError(""); setNotice(""); }
    try { await task(); }
    catch (error) {
      if (request === generation.current) (inDialog ? setDialogError : setError)(errorText(error));
    } finally {
      operation.current = false;
      if (request === generation.current) setBusy(false);
    }
  }
  async function saveName() {
    const request = generation.current;
    await renameClass(classroom.id, name.trim());
    if (request !== generation.current) return;
    onChange({ ...classroom, name: name.trim() });
    setName(name.trim());
    setNotice("班级名称已保存");
  }
  async function confirm() {
    if (!action) return;
    const request = generation.current;
    if (action.kind === "invite") {
      const next = await invitation(classroom.id, true);
      if (request !== generation.current) return;
      setCode(next); setReset(false); setDialogNotice("邀请码已重置，旧码已失效");
      return;
    }
    if (action.kind === "dissolve") {
      await dissolveClass(classroom.id, confirmation);
      if (request === generation.current) void navigate("/classes", { replace: true });
      return;
    }
    if (action.kind === "transfer") {
      await transferClass(classroom.id, target);
      if (request === generation.current) void navigate(classPath(classroom.id), { replace: true });
      return;
    }
    if (action.kind === "remove") {
      await removeMember(classroom.id, action.member.id);
      if (request !== generation.current) return;
      const members = (classroom.members ?? []).filter(member => member.id !== action.member.id);
      onChange({ ...classroom, members, memberCount: members.length });
      setNotice(`已将${action.member.nickname}移出班级`);
    } else {
      await allowMember(classroom.id, action.member.id);
      if (request !== generation.current) return;
      setRemoved(values => values.filter(member => member.id !== action.member.id));
      setNotice(`${action.member.nickname}可以重新凭邀请码加入`);
    }
    setAction(null);
  }
  async function copyCode() {
    const request = codeRequest.current;
    try {
      await navigator.clipboard.writeText(code);
      if (request === codeRequest.current) setDialogNotice("邀请码已复制，可以分享给老师和学生");
    } catch { if (request === codeRequest.current) setDialogError("复制失败，请选中邀请码手动复制"); }
  }
  const teachers = (classroom.members ?? []).filter(member => member.role === "teacher");
  const title = action?.kind === "invite" ? reset ? "重置邀请码？" : "邀请成员" : action?.kind === "transfer" ? "转交班主任" : action?.kind === "dissolve" ? "解散班级？" : action?.kind === "remove" ? `移出${action.member.nickname}？` : "解除加入限制？";
  const description = action?.kind === "invite" ? reset ? "重置后，旧邀请码将无法加入班级。已经加入的成员不受影响。" : "把邀请码分享给老师和学生，他们会按账号身份加入班级。" : action?.kind === "transfer" ? "转交后，你将成为任课老师，失去班级管理权限。邀请码会同时重置。" : action?.kind === "dissolve" ? "班级和成员关系将被删除，无法恢复。所有成员的个人课程和学习记录会保留。" : action?.kind === "remove" ? "移出后，对方不能查看班级或再次凭码加入。个人课程和学习记录会保留。" : action?.kind === "allow" ? `${action.member.nickname}将可以重新凭邀请码加入，不会自动成为班级成员。` : "";

  return <div className="class-management">
    <header className="class-management-header"><p className="class-eyebrow">{classroom.name}</p><h1>班级管理</h1><p>管理班级设置与成员关系</p></header>
    <Tabs.Root value={tab} onValueChange={selectTab}>
      <Tabs.List className="class-management-tabs" aria-label="班级管理栏目">
        <Tabs.Trigger value="settings"><Icon name="settings" />基本设置</Tabs.Trigger>
        <Tabs.Trigger value="members"><Icon name="people" />成员管理</Tabs.Trigger>
        <Tabs.Trigger value="removed"><Icon name="remove" />已移出成员</Tabs.Trigger>
      </Tabs.List>
      {notice && <p className="class-success class-management-feedback" role="status"><Icon name="check" />{notice}</p>}
      {error && <p className="class-feedback" role="alert">{error}</p>}
      <Tabs.Content value="settings" className="class-settings">
        <section className="class-setting-row" aria-labelledby="class-name-heading">
          <div><h2 id="class-name-heading">班级名称</h2><p>让老师和学生一眼认出自己的班级。</p></div>
          <form onSubmit={event => { event.preventDefault(); void run(saveName, false); }} className="class-name-form">
            <label className="visually-hidden" htmlFor="class-name">班级名称</label>
            <input id="class-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy} />
            <button className="primary" disabled={busy || !name.trim() || name.trim() === classroom.name}>保存名称</button>
          </form>
        </section>
        <section className="class-setting-row"><div><h2><Icon name="invite" />邀请成员</h2><p>使用邀请码邀请任课老师和学生加入。</p></div><button className="secondary" disabled={busy} onClick={() => open({ kind: "invite" })}>邀请成员</button></section>
        <section className="class-setting-row"><div><h2><Icon name="transfer" />转交班主任</h2><p>{teachers.length ? "将班级交给本班的一位任课老师管理。" : "先邀请一位任课老师加入，才能转交班主任。"}</p></div><button className="secondary" disabled={busy || !teachers.length} onClick={() => open({ kind: "transfer" })}>转交班主任</button></section>
        <section className="class-setting-row class-danger-zone"><div><h2><Icon name="trash" />解散班级</h2><p>所有成员将离开这个班级，此操作无法恢复。</p></div><button className="secondary class-danger-button" disabled={busy} onClick={() => open({ kind: "dissolve" })}>解散班级</button></section>
      </Tabs.Content>
      <Tabs.Content value="members">
        {(["teacher", "student"] as const).map(role => {
          const members = (classroom.members ?? []).filter(member => member.role === role);
          return <section className="class-member-section" key={role} aria-label={roleNames[role]}>
            <div className="class-group-heading"><h2><Icon name={role} />{roleNames[role]}</h2><span>{members.length} 人</span></div>
            {members.length ? <div className="class-member-grid">{members.map(member => <MemberCard key={member.id} member={member}>
              <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button class-member-menu" aria-label={`管理${member.nickname}`} disabled={busy}><Icon name="more" /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="class-menu" align="end" sideOffset={6}><DropdownMenu.Item onSelect={() => open({ kind: "remove", member })}><Icon name="remove" />移出班级</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
            </MemberCard>)}</div> : <p className="class-group-empty">还没有{roleNames[role]}加入</p>}
          </section>;
        })}
      </Tabs.Content>
      <Tabs.Content value="removed" className="class-removed-section">
        <p className="class-management-hint">被移出的成员不能再次凭码加入。解除限制后，需要对方重新加入。</p>
        {removedLoading ? <p role="status">正在读取已移出成员…</p> : removedError ? <div><p role="alert">{removedError}</p><button className="secondary" onClick={() => void loadRemoved()}>重新读取</button></div> : removed.length ? <div className="class-member-grid">{removed.map(member => <MemberCard key={member.id} member={member}><button className="text-button class-member-allow" disabled={busy} onClick={() => open({ kind: "allow", member })} aria-label={`解除${member.nickname}的加入限制`}>解除限制</button></MemberCard>)}</div> : <p className="class-group-empty">没有被移出的成员</p>}
      </Tabs.Content>
    </Tabs.Root>
    {action && <ClassDialog title={title} description={description} busy={busy} close={close}>
      {action.kind === "invite" && !reset ? <div className="class-invitation">
        {loadingCode ? <p role="status">正在读取邀请码…</p> : code ? <><div className="class-invitation-code">{code}</div><button className="primary full" onClick={() => void copyCode()}><Icon name="copy" />复制邀请码</button><button className="text-button" onClick={() => { setReset(true); setDialogNotice(""); setDialogError(""); }}>重置邀请码</button></> : <button className="secondary" onClick={() => void loadCode()}>重新读取</button>}
      </div> : <form onSubmit={event => { event.preventDefault(); void run(confirm, true); }}>
        {action.kind === "transfer" && <><label htmlFor="class-transfer">新班主任</label><select id="class-transfer" required value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="">选择一位任课老师</option>{teachers.map(member => <option key={member.id} value={member.id}>{member.nickname}</option>)}</select></>}
        {action.kind === "dissolve" && <><p className="class-confirm-name">{classroom.name}</p><label htmlFor="class-confirmation">输入班级名称确认</label><input id="class-confirmation" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></>}
        <div className="class-actions"><button type="button" className="secondary" disabled={busy} onClick={() => reset ? setReset(false) : close()}>取消</button><button className={`primary ${action.kind === "dissolve" || action.kind === "remove" ? "class-danger-button" : ""}`} disabled={busy || (action.kind === "transfer" && !target) || (action.kind === "dissolve" && confirmation !== classroom.name)}>{busy ? "正在处理…" : action.kind === "invite" ? "重置" : action.kind === "transfer" ? "确认转交" : action.kind === "dissolve" ? "确认解散" : action.kind === "remove" ? "确认移出" : "解除限制"}</button></div>
      </form>}
      {dialogError && <p className="class-feedback" role="alert">{dialogError}</p>}
      {dialogNotice && <p className="class-feedback class-success" role="status">{dialogNotice}</p>}
    </ClassDialog>}
  </div>;
}
