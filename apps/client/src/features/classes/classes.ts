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
