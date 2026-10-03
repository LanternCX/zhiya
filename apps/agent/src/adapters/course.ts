import { ToolAPI, ToolAPIError } from "./api";
import type { CourseManagement } from "../pi/tool";
import type { CourseProjection } from "../../../../packages/learning/src/domain/agent";
import type { StoredCourse, StoredCourseConversation, CourseCover, CourseMaterial, MaterialContent, OutlineReorganization } from "../../../../packages/learning/src/domain/learning";

type OutlineResult = { course?: StoredCourse; reorganization?: OutlineReorganization };

/** Adapt course tools to Go; execution and teaching stay in Pi. */
export class CourseAPI {
  readonly management: CourseManagement;
  materials: Array<{ name: string; content: string }> = [];
  constructor(
    private api: ToolAPI,
    readonly state: CourseProjection,
    private changed: () => void,
    private flush: () => Promise<void>,
  ) {
    const host = this;
    this.management = {
      get course() {
        return host.state.course;
      },
      get currentConversationId() {
        return host.state.conversationId || null;
      },
      create: async (title: string, topic: string, cover: CourseCover) => {
        const { course } = await this.api.json<{ course: StoredCourse }>(
          "/courses",
          "POST",
          { title, topic, cover },
        );
        await this.accept(course);
        for (const file of this.materials.splice(0)) {
          const { upload } = await this.api.json<{
            upload: {
              id: string;
              url: string;
              headers: Record<string, string>;
            };
          }>(`/courses/${course.id}/material-uploads`, "POST", {
            name: file.name,
            sizeBytes: Buffer.byteLength(file.content),
          });
          const response = await this.api.object(upload.url, {
            method: "PUT",
            headers: upload.headers,
            body: file.content,
          });
          if (!response.ok) throw new Error("课程材料上传失败");
          await this.api.json(
            `/courses/${course.id}/material-uploads/${upload.id}/complete`,
            "POST",
            {},
          );
        }
        return course;
      },
      rename: async (title, topic) =>
        this.accept(
          (
            await this.api.json<{ course: StoredCourse }>(
              `/courses/${this.courseId()}`,
              "PATCH",
              { title, topic },
            )
          ).course,
        ),
      setOutline: async (sections, classify) => {
        if (!classify) throw new Error("缺少课程分类器");
        await this.flush();
        return this.finishOutline(
          await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline`,
            "PUT",
            { sections },
          ),
          classify,
        );
      },
      resumeOutline: async (classify) => {
        if (!this.state.course) return null;
        try {
          return await this.finishOutline(
            await this.api.json<OutlineResult>(
              `/courses/${this.courseId()}/outline-reorganization`,
            ),
            classify,
          );
        } catch (error) {
          if (error instanceof ToolAPIError && error.status === 404)
            return null;
          throw error;
        }
      },
      createConversation: async (sectionId, title) => {
        if (
          this.state.course?.sections?.some((section) =>
            section.conversations.some(
              (conversation) => conversation.id === this.state.conversationId,
            ),
          )
        )
          throw new Error("当前学习对话已经归属章节");
        const conversation = await this.createConversation(sectionId, title);
        this.state.conversationId = conversation.id;
        await this.accept(this.state.course!);
        return conversation;
      },
      switchSection: async (sectionId, title) => {
        await this.flush();
        return this.createConversation(sectionId, title);
      },
      listConversations: async () =>
        this.state.course?.sections?.flatMap((s) => s.conversations) ?? [],
      readConversation: async (id) => {
        const { course } = await this.api.json<{ course: StoredCourse }>(
          `/courses/${this.courseId()}`,
        );
        const conversation = course.sections
          ?.flatMap((s) => s.conversations)
          .find((c) => c.id === id);
        if (!conversation) throw new Error("找不到这条历史学习记录");
        return conversation;
      },
      listMaterials: async () =>
        (
          await this.api.json<{ materials: CourseMaterial[] }>(
            `/courses/${this.courseId()}/materials`,
          )
        ).materials,
      readMaterial: async (id, range = {}) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(range)) {
          if (value !== undefined) query.set(key, String(value));
        }
        return this.api.json<MaterialContent>(
          `/courses/${this.courseId()}/materials/${encodeURIComponent(id)}/content?${query}`,
        );
      },
    };
  }
  private courseId() {
    if (!this.state.course) throw new Error("课程尚未建立");
    return this.state.course.id;
  }
  private async accept(course: StoredCourse) {
    this.state.course = {
      ...course,
      conversationId: this.state.conversationId,
      state: this.state.lesson,
    };
    this.changed();
    await this.flush();
    return this.state.course;
  }
  private async finishOutline(
    result: OutlineResult,
    classify: NonNullable<Parameters<CourseManagement["setOutline"]>[1]>,
  ): Promise<StoredCourse> {
    while (!result.course) {
      const reorganization = result.reorganization;
      if (!reorganization?.pending.length)
        throw new Error("课程大纲分类暂时不可用");
      const batch = await Promise.all(
        reorganization.pending.slice(0, 3).map(async (conversation) => ({
          conversation,
          classification: await classify(reorganization, conversation),
        })),
      );
      for (const { conversation, classification } of batch) {
        try {
          result = await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline-reorganizations/${reorganization.id}/assignments/${conversation.id}`,
            "PUT",
            {
              ...classification,
              conversationUpdatedAt: conversation.updatedAt,
            },
          );
        } catch (error) {
          if (!(error instanceof ToolAPIError) || error.status !== 409)
            throw error;
          result = await this.api.json<OutlineResult>(
            `/courses/${this.courseId()}/outline-reorganization`,
          );
          break;
        }
        if (result.course) break;
      }
    }
    return this.accept(result.course);
  }


  private async createConversation(sectionId: string, title: string) {
    const { conversation } = await this.api.json<{
      conversation: StoredCourseConversation;
    }>(
      `/courses/${this.courseId()}/sections/${sectionId}/conversations`,
      "POST",
      { title },
    );
    const course = this.state.course!;
    await this.accept({
      ...course,
      sections: course.sections?.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              conversations: [...section.conversations, conversation],
            }
          : section,
      ),
    });
    return conversation;
  }

}
