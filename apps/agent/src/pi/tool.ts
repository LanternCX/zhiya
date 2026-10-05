import type {
  CodeLanguage,
  CodingExercise,
  CourseCover,
  CourseMaterial,
  MaterialContent,
  MaterialRange,
  StoredCourseConversation,
  StoredCourse,
  OutlineClassification,
  OutlineReorganization,
  Slide,
  AnimationPlaybackCommand,
  AnimationPlaybackState,
  LessonPage,
  LessonPresentation,
  QuestionPage,
} from "../domain/learning";
import type { SlideRequest } from "./tools/create_slides";
import type { DeliverableTools } from "./tools/deliverables";

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
  deliverables: DeliverableTools;
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
      status?: "planned" | "active" | "complete" | "archived";
    }>,
    classify?: (
      reorganization: OutlineReorganization,
      conversation: StoredCourseConversation,
    ) => Promise<OutlineClassification>,
  ) => Promise<
    | StoredCourse
    | { taskId: string; status: "running"; kind: "outline-classifier" }
  >;
  resumeOutline: (
    classify: (
      reorganization: OutlineReorganization,
      conversation: StoredCourseConversation,
    ) => Promise<OutlineClassification>,
  ) => Promise<StoredCourse | null>;
  createConversation: (
    sectionId: string,
    title: string,
  ) => Promise<StoredCourseConversation>;
  switchSection: (
    sectionId: string,
    title: string,
    handoff: string,
  ) => Promise<StoredCourseConversation>;
  listConversations: () => Promise<StoredCourseConversation[]>;
  readConversation: (
    conversationId: string,
  ) => Promise<StoredCourseConversation>;
  listMaterials: () => Promise<CourseMaterial[]>;
  readMaterial: (
    materialId: string,
    range?: MaterialRange,
  ) => Promise<MaterialContent>;
};

export type SlideTools = {
  start: (
    id: string,
    request: SlideRequest,
    signal?: AbortSignal,
  ) => Promise<{
    taskId: string;
    status: AgentTaskSummary["status"];
    pageIds: string[];
    page?: Slide;
  }>;
  cancel: () => void;
  read: () => { pages: Slide[]; generating: boolean };
};

export type AnimationTools = {
  start: (request: { pageId: string; goal: string }) => {
    taskId: string;
    pageId: string;
    status: "running";
  };
  read: () => Array<{
    taskId: string;
    pageId: string;
    status: "running" | "complete" | "failed" | "cancelled";
    error?: string;
  }>;
  cancel: (taskId: string) => void;
  control: (
    pageId: string,
    command: AnimationPlaybackCommand,
  ) => AnimationPlaybackState;
  playback: (pageId: string) => AnimationPlaybackState;
};

export type LessonPageSummary = {
  pageId: string;
  kind: LessonPage["kind"];
  title: string;
};

export type LessonPageState = {
  pages: LessonPageSummary[];
  presentations: Array<LessonPresentation & { position: number }>;
  currentPresentationId: string;
  currentPageId: string;
  tasks: AgentTaskSummary[];
};

export type LessonPageTools = {
  read: () => LessonPageState;
  readPage: (pageId: string) => { page: LessonPage; version: string; editableFields: string[] };
  patch: (pageId: string, version: string, changes: Array<{ field: string; oldText: string; newText: string }>) => { page: LessonPage; version: string; diff: Array<{ field: string; oldText: string; newText: string }> };
  show: (
    id: string,
    pageId: string,
    signal?: AbortSignal,
  ) => Promise<LessonPage>;
};

export type QuestionTools = {
  show: (
    id: string,
    draft: Pick<QuestionPage, "title" | "text" | "questionKind" | "options">,
  ) => Promise<QuestionPage>;
  read: (pageId: string) => QuestionPage;
};

export type IllustrationTools = {
  start: (request: {
    pageId: string;
    title: string;
    description: string;
    alt: string;
  }) => Promise<{ taskId: string; pageId: string; status: "running" }>;
};

export type AgentTaskSummary = {
  taskId: string;
  kind: "slides" | "animation" | "illustration" | "outline-classifier";
  status: "running" | "complete" | "failed" | "cancelled";
  pageId?: string;
  pageIds?: string[];
  sections?: Array<{
    id: string;
    title: string;
    objective: string;
    status: "planned" | "active" | "complete" | "archived";
  }>;
  error?: string;
};

export type AgentTaskTools = {
  read: () => AgentTaskSummary[];
  cancel: (taskId: string) => AgentTaskSummary;
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
  ) => Promise<CodingExercise>;
  read: () => CodingExercise;
  end: () => CodingExercise;
};
