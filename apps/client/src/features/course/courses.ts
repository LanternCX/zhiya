import { api } from "../../api";
import type {
  CourseConversationState,
  CourseCover,
  StoredCourse,
  CourseMaterial,
  StoredCourseConversation,
} from "../../domain/learning";

export const emptyCourseState = (): CourseConversationState => ({
  messages: [],
  pages: [],
  presentedPageIds: [],
  currentPageId: "",
});

export async function listCourses() {
  return (await api<{ courses: StoredCourse[] }>("/courses")).courses;
}

export async function createCourse(
  title: string,
  topic: string,
  cover: CourseCover,
) {
  return (
    await api<{ course: StoredCourse }>("/courses", "POST", {
      title,
      topic,
      cover,
    })
  ).course;
}

export async function updateCourse(
  id: string,
  changes: { title?: string; topic?: string },
) {
  return (
    await api<{ course: StoredCourse }>(`/courses/${id}`, "PATCH", changes)
  ).course;
}

export async function deleteCourse(id: string) {
  await api(`/courses/${id}`, "DELETE");
}

export async function saveCourseConversation(
  course: StoredCourse,
  state: CourseConversationState,
) {
  await api(`/courses/${course.id}/conversation`, "PUT", {
    conversationId: course.conversationId,
    state,
  });
}

export async function createCourseConversation(
  courseId: string,
  sectionId: string,
  title: string,
) {
  return (
    await api<{ conversation: StoredCourseConversation }>(
      `/courses/${courseId}/sections/${sectionId}/conversations`,
      "POST",
      { title },
    )
  ).conversation;
}

export async function deleteCourseConversation(
  courseId: string,
  sectionId: string,
  conversationId: string,
) {
  return (
    await api<{ course: StoredCourse }>(
      `/courses/${courseId}/sections/${sectionId}/conversations/${conversationId}`,
      "DELETE",
    )
  ).course;
}

export async function replaceCourseOutline(
  courseId: string,
  sections: Array<{
    id?: string;
    title: string;
    objective: string;
    status?: "planned" | "active" | "complete";
  }>,
) {
  return (
    await api<{ course: StoredCourse }>(`/courses/${courseId}/outline`, "PUT", {
      sections,
    })
  ).course;
}

export async function listCourseMaterials(courseId: string) {
  return (
    await api<{ materials: CourseMaterial[] }>(`/courses/${courseId}/materials`)
  ).materials;
}

export async function uploadCourseMaterial(courseId: string, file: File) {
  return (
    await api<{ material: CourseMaterial }>(
      `/courses/${courseId}/materials`,
      "POST",
      { name: file.name, content: await file.text() },
    )
  ).material;
}

export async function getCourseMaterial(courseId: string, materialId: string) {
  return api<{ material: CourseMaterial; content: string }>(
    `/courses/${courseId}/materials/${materialId}`,
  );
}

export async function deleteCourseMaterial(
  courseId: string,
  materialId: string,
) {
  await api(`/courses/${courseId}/materials/${materialId}`, "DELETE");
}
