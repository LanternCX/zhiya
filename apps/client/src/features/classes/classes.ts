import { api } from "../../api";

export type ClassMember = {
  id: string;
  nickname: string;
  avatar: string;
  role: "head_teacher" | "teacher" | "student";
};
export type Classroom = {
  id: string;
  name: string;
  headTeacherId: string;
  headTeacherName: string;
  memberCount: number;
  members?: ClassMember[];
};
export const roleNames = { head_teacher: "班主任", teacher: "任课老师", student: "学生" };
export async function listClasses() {
  return (await api<{ classes: Classroom[] }>("/classes")).classes;
}
export async function getClass(id: string) {
  return (await api<{ class: Classroom }>(`/classes/${encodeURIComponent(id)}`)).class;
}
export async function createClass(name: string) {
  return (await api<{ class: Classroom }>("/classes", "POST", { name })).class;
}
export async function joinClass(code: string) {
  return (await api<{ class: Classroom }>("/classes/join", "POST", { code })).class;
}
export async function invitation(id: string, reset = false) {
  return (await api<{ code: string }>(`/classes/${encodeURIComponent(id)}/invitation`, reset ? "POST" : "GET")).code;
}

export function classPath(id: string) { return `/classes/${encodeURIComponent(id)}`; }
export function renameClass(id: string, name: string) { return api(classPath(id), "PATCH", { name }); }
export function dissolveClass(id: string, name: string) { return api(classPath(id), "DELETE", { name }); }
export function leaveClass(id: string) { return api(`${classPath(id)}/leave`, "POST"); }
export function transferClass(id: string, memberId: string) { return api(`${classPath(id)}/transfer`, "POST", { memberId }); }
export function removeMember(id: string, memberId: string) { return api(`${classPath(id)}/members/${encodeURIComponent(memberId)}`, "DELETE"); }
export function allowMember(id: string, memberId: string) { return api(`${classPath(id)}/removed-members/${encodeURIComponent(memberId)}`, "DELETE"); }
export async function removedMembers(id: string) { return (await api<{members: ClassMember[]}>(`${classPath(id)}/removed-members`)).members; }
