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

export type AnimationNode = {
  id: string;
  shape: "rectangle" | "circle" | "diamond" | "text" | "group";
  label: string;
  groupId?: string;
};

export type AnimationEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  arrow?: boolean;
};

export type AnimationAction =
  | { type: "show" | "hide" | "highlight"; targetId: string }
  | { type: "flow"; targetId: string }
  | { type: "update"; targetId: string; value: string };

export type AnimationButton = {
  id: string;
  label: string;
  steps: AnimationAction[][];
};

export type AnimationPage = {
  kind: "animation";
  id: string;
  title: string;
  layout: "horizontal" | "vertical" | "grid";
  nodes: AnimationNode[];
  edges: AnimationEdge[];
  buttons: AnimationButton[];
};

export type IllustrationPage = {
  kind: "illustration";
  id: string;
  title: string;
  alt: string;
  assetId: string;
};

export type AnimationPlaybackCommand =
  | { action: "play"; buttonId: string }
  | { action: "pause" }
  | { action: "reset" };

export type AnimationPlaybackState = {
  pageId: string;
  status: "idle" | "playing" | "paused" | "complete";
  buttonId?: string;
  step: number;
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

export type LessonPage =
  Slide | AnimationPage | IllustrationPage | CodingExercise;

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

export type CourseMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
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
