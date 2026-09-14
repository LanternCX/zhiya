import type {
  CodeLanguage,
  CodingExercise,
  CourseCover,
  CourseMaterial,
  StoredCourseConversation,
  StoredCourse,
  Slide,
  LessonPage,
} from "../domain/learning";
import type { SlideRequest } from "./tools/create_slides";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

export type PersistedToolExecutor = (id: string) => Promise<ToolResultMessage>;

/** The host executes acknowledged calls; PI receives the persisted result or a tool error. */
export function bindPersistedTool(
  definition: Pick<AgentTool, "name" | "label" | "description" | "parameters">,
  execute: PersistedToolExecutor,
): AgentTool {
  return {
    ...definition,
    execute: async (id) => {
      const result = await execute(id);
      if (result.isError)
        throw new Error(
          result.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        );
      return { content: result.content, details: result.details };
    },
  };
}

export type CourseManagement = {
  course: StoredCourse | null;
  currentConversationId: string | null;
  create: (
    title: string,
    topic: string,
    cover: CourseCover,
  ) => Promise<StoredCourse>;
  rename: (title: string, topic?: string) => Promise<StoredCourse>;
  setOutline: (
    sections: Array<{
      id?: string;
      title: string;
      objective: string;
      status?: "planned" | "active" | "complete";
    }>,
  ) => Promise<StoredCourse>;
  createConversation: (
    sectionId: string,
    title: string,
  ) => Promise<StoredCourseConversation>;
  listConversations: () => Promise<StoredCourseConversation[]>;
  readConversation: (
    conversationId: string,
  ) => Promise<StoredCourseConversation>;
  listMaterials: () => Promise<CourseMaterial[]>;
  readMaterial: (
    materialId: string,
  ) => Promise<{ material: CourseMaterial; content: string }>;
};

export type SlideTools = {
  start: (request: SlideRequest) => Promise<Slide>;
  cancel: () => void;
  read: () => { pages: Slide[]; generating: boolean };
  next: () => Promise<LessonPage>;
};

export type TeachingToolContext = {
  course: { id: string; title: string; topic: string };
  management: CourseManagement;
};

export type CodingTools = {
  languages: () => Promise<CodeLanguage[]>;
  show: (
    id: string,
    exercise: Pick<
      CodingExercise,
      "title" | "instructions" | "languageId" | "languageName" | "starterCode"
    >,
  ) => CodingExercise;
  read: () => CodingExercise;
  end: () => CodingExercise;
};
