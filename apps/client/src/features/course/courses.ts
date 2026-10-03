import { api } from "../../api";
import type {
  CourseConversationState,
  StoredCourse,
  CourseMaterial,
  MaterialPreparationProgress,
  StoredCourseConversation,
} from "../../../../../packages/learning/src/domain/learning";
import {
  ObjectStorageError,
  readObjectText,
  uploadObject,
} from "../../transport/object-storage";

export const emptyCourseState = (): CourseConversationState => ({
  messages: [],
  pages: [],
  presentations: [],
  currentPresentationId: "",
});

export async function listCourses() {
  return (await api<{ courses: StoredCourse[] }>("/courses")).courses;
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

export async function listCourseMaterials(courseId: string) {
  return (
    await api<{ materials: CourseMaterial[] }>(`/courses/${courseId}/materials`)
  ).materials;
}

export async function uploadCourseMaterial(
  courseId: string,
  file: File,
  onPhase?: (phase: "uploading" | "parsing") => void,
) {
  onPhase?.("uploading");
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
  onPhase?.("parsing");
  return (
    await api<{ material: CourseMaterial }>(
      `/courses/${courseId}/material-uploads/${upload.id}/complete`,
      "POST",
    )
  ).material;
}

export async function uploadCourseMaterials(
  courseId: string,
  files: File[],
  onProgress: (progress: MaterialPreparationProgress) => void,
) {
  const materials: CourseMaterial[] = [];
  for (const file of files) {
    const report = (phase: MaterialPreparationProgress["phase"]) =>
      onProgress({
        total: files.length,
        completed: materials.length,
        fileName: file.name,
        phase,
      });
    try {
      materials.push(await uploadCourseMaterial(courseId, file, report));
      if (materials.length === files.length) report("complete");
    } catch (error) {
      report("failed");
      throw error;
    }
  }
  return materials;
}

export async function getCourseMaterial(courseId: string, materialId: string) {
  const download = await api<{
    material: CourseMaterial;
    url: string;
    headers?: Record<string, string>;
  }>(`/courses/${courseId}/materials/${materialId}/download`);
  const content = await readObjectText(download);
  return { material: download.material, content };
}

export async function deleteCourseMaterial(
  courseId: string,
  materialId: string,
) {
  await api(`/courses/${courseId}/materials/${materialId}`, "DELETE");
}
