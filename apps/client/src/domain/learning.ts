export type Question = {
  id: string;
  text: string;
  description?: string;
  kind: "single" | "multiple" | "text";
  options: string[];
};
export type Answer = { selected: string[]; text: string; skipped: boolean };
export type ModelInfo = { id: string; available: boolean };
export type AssistantOutput = {
  text: string;
  reasoning: string;
  isReasoning: boolean;
};

export type Slide = {
  kind: "slide";
  id: string;
  title: string;
  kicker?: string;
  body: string;
  bullets: string[];
  layout: "explain" | "steps" | "compare";
};

export type CodingExercise = {
  kind: "coding";
  id: string;
  title: string;
  instructions: string;
  languageId: number;
  languageName: string;
  starterCode: string;
  code: string;
  stdin: string;
  status: "active" | "ended";
  result?: CodeRunResult;
};

export type LessonPage = Slide | CodingExercise;

export type CodeLanguage = { id: number; name: string };
export type CodeRunResult = {
  stdout: string;
  stderr: string;
  compileOutput: string;
  message: string;
  status: { description: string };
  time: string;
  memory: number;
};

export type InputMode = "text" | "speech";

export type UserMessage = {
  role: "user";
  text: string;
  input_mode: InputMode;
  materials?: string[];
};

export type CourseMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  input_mode?: InputMode;
  materials?: string[];
  streaming?: boolean;
  pageId?: string;
};

export type CourseActivity =
  | { kind: "thinking"; text: string; active: boolean }
  | {
      kind: "tool";
      name: string;
      label: string;
      status: "running" | "complete" | "error";
    };

export type CourseConversationState = {
  messages: CourseMessage[];
  pages: LessonPage[];
  presentedPageIds: string[];
  currentPageId: string;
};

export type StoredCourseConversation = {
  id: string;
  sectionId: string;
  title: string;
  state: CourseConversationState;
  createdAt: string;
  updatedAt: string;
};

export type CourseSection = {
  id: string;
  title: string;
  objective: string;
  position: number;
  status: "planned" | "active" | "complete" | "archived";
  conversations: StoredCourseConversation[];
};

export type OutlineDraftSection = Pick<
  CourseSection,
  "id" | "title" | "objective" | "status"
>;

export type OutlineReorganization = {
  id: string;
  sections: OutlineDraftSection[];
  pending: StoredCourseConversation[];
  pendingCount: number;
};

export type OutlineClassification =
  | { sectionId: string; reason: string }
  | {
      newSection: { title: string; objective: string };
      reason: string;
    };

export type CourseMaterial = {
  id: string;
  name: string;
  mediaType: "text/markdown" | "text/plain";
  sizeBytes: number;
  createdAt: string;
};

export type CourseCover = {
  motif:
    | "code"
    | "orbit"
    | "geometry"
    | "language"
    | "nature"
    | "history"
    | "abstract";
  palette: "sprout" | "sunrise" | "ocean" | "berry" | "clay";
  label: string;
};

export type StoredCourse = {
  id: string;
  conversationId: string;
  title: string;
  topic: string;
  cover: CourseCover;
  status: "active";
  state: CourseConversationState;
  sections?: CourseSection[];
  createdAt: string;
  updatedAt: string;
};

export type ModelRetryStatus = { attempt: number; maxRetries: number };
export type ModelRetryListener = (status: ModelRetryStatus | null) => void;

export type ConversationView = {
  id: string;
  question: Question | null;
  completed: boolean;
  correctionEnded: boolean;
  memory: string;
  revision: number;
  status: "idle" | "running" | "waiting";
  leaseUntil: string;
  messageCount: number;
  lastAssistant: boolean;
  output: AssistantOutput;
  correction: { answered: boolean; saved: boolean } | null;
};
