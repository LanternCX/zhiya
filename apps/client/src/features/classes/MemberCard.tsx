import type { ReactNode } from "react";
import Icon from "../../components/Icon";
import { roleNames, type ClassMember } from "./classes";

export default function MemberCard({ member, self, children }: { member: ClassMember; self?: boolean; children?: ReactNode }) {
  return <article className="class-member-card" aria-label={member.nickname}>
    <div className={`class-avatar ${member.role === "head_teacher" ? "is-head" : ""}`}>{member.avatar ? <img src={member.avatar} alt="" /> : <Icon name={member.role === "student" ? "student" : "teacher"} />}</div>
    <div className="class-member-info"><h3>{member.nickname}{self && <small>你</small>}</h3><span>{roleNames[member.role]}</span></div>
    {children}
  </article>;
}
