import { api, APIError } from "../../api";
import type {
  CourseConversationState,
  CourseCover,
  StoredCourse,
  CourseMaterial,
  StoredCourseConversation,
  OutlineClassification,
  OutlineReorganization,
} from "../../domain/learning";
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
    status?: "planned" | "active" | "complete" | "archived";
  }>,
) {
  return await api<
    | { course: StoredCourse }
    | { reorganization: OutlineReorganization }
  >(`/courses/${courseId}/outline`, "PUT", { sections });
}

export async function getCourseOutlineReorganization(courseId: string) {
  try {
    return (
      await api<{ reorganization: OutlineReorganization }>(
        `/courses/${courseId}/outline-reorganization`,
      )
    ).reorganization;
  } catch (error) {
    if (error instanceof APIError && error.status === 404) return null;
    throw error;
  }
}

export async function assignCourseOutlineConversation(
  courseId: string,
  reorganizationId: string,
  conversation: StoredCourseConversation,
  classification: OutlineClassification,
) {
  return await api<
    | { course: StoredCourse }
    | { reorganization: OutlineReorganization }
  >(
    `/courses/${courseId}/outline-reorganizations/${reorganizationId}/assignments/${conversation.id}`,
    "PUT",
    {
      ...classification,
      conversationUpdatedAt: conversation.updatedAt,
    },
  );
}

export type CourseOutlineClassifier = (
  reorganization: OutlineReorganization,
  conversation: StoredCourseConversation,
) => Promise<OutlineClassification>;

async function finishCourseOutlineReorganization(
  courseId: string,
  initial: OutlineReorganization,
  classify: CourseOutlineClassifier,
) {
  let reorganization = initial;
  classificationLoop: while (reorganization.pendingCount > 0) {
    const batch = reorganization.pending.slice(0, 3);
    if (!batch.length) throw new Error("课程大纲分类队列暂时不可用");
    const classifications = await Promise.all(
      batch.map(async (conversation) => ({
        conversation,
        classification: await classify(reorganization, conversation),
      })),
    );
    for (const { conversation, classification } of classifications) {
      let result;
      try {
        result = await assignCourseOutlineConversation(
          courseId,
          reorganization.id,
          conversation,
          classification,
        );
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 409) throw error;
        const refreshed = await getCourseOutlineReorganization(courseId);
        if (!refreshed) throw error;
        reorganization = refreshed;
        continue classificationLoop;
      }
      if ("course" in result) return result.course;
      reorganization = result.reorganization;
    }
  }
  throw new Error("课程大纲调整没有完成");
}

export async function reorganizeCourseOutline(
  courseId: string,
  sections: Parameters<typeof replaceCourseOutline>[1],
  classify: CourseOutlineClassifier,
) {
  const result = await replaceCourseOutline(courseId, sections);
  if ("course" in result) return result.course;
  return finishCourseOutlineReorganization(
    courseId,
    result.reorganization,
    classify,
  );
}

export async function resumeCourseOutlineReorganization(
  courseId: string,
  classify: CourseOutlineClassifier,
) {
  const reorganization = await getCourseOutlineReorganization(courseId);
  if (!reorganization) return null;
  return finishCourseOutlineReorganization(
    courseId,
    reorganization,
    classify,
  );
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
