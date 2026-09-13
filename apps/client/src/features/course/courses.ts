import { api } from "../../api";
import type {
  CourseConversationState,
  CourseCover,
  StoredCourse,
  CourseMaterial,
  StoredCourseConversation,
} from "../../domain/learning";
import {
  ObjectStorageError,
  readObjectText,
  uploadObject,
} from "../../transport/object-storage";

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
  const { upload } = await api<{
    upload: {
      id: string;
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
  }>(`/courses/${courseId}/material-uploads`, "POST", {
    name: file.name,
    sizeBytes: file.size,
  });
  try {
    await uploadObject(upload, file);
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw new Error(
        error.kind === "network"
          ? "课程材料传输失败，请检查网络后重试"
          : "课程材料传输失败，请重新上传",
      );
    }
    throw error;
  }
  return (
    await api<{ material: CourseMaterial }>(
      `/courses/${courseId}/material-uploads/${upload.id}/complete`,
      "POST",
    )
  ).material;
}

export async function getCourseMaterial(courseId: string, materialId: string) {
  const download = await api<{
    material: CourseMaterial;
    url: string;
    headers?: Record<string, string>;
  }>(
    `/courses/${courseId}/materials/${materialId}/download`,
  );
  const content = await readObjectText(download);
  return { material: download.material, content };
}

export async function deleteCourseMaterial(
  courseId: string,
  materialId: string,
) {
  await api(`/courses/${courseId}/materials/${materialId}`, "DELETE");
}
