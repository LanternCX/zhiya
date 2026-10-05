import type {
  StoredCourse,
  CourseConversationState,
  CourseActivity,
  ModelRetryStatus,
  AnimationPlaybackCommand,
  AssistantOutput,
} from "./learning";
import type { Conversation } from "./conversation";
import type { DeliverableSelection } from "./deliverable";

export type CourseProjection = {
  deliverableSelection?: DeliverableSelection | null;
  deliverablesChanged?: number;
  course: StoredCourse | null;
  conversationId: string;
  lesson: CourseConversationState;
  busy: boolean;
  generating: boolean;
  running?: boolean;
  activity?: CourseActivity | null;
  retry?: ModelRetryStatus | null;
  error?: string;
  animations?: Array<{
    id: string;
    pageId: string;
    command: AnimationPlaybackCommand;
  }>;
};

export type ProfileProjection = {
  busy: boolean;
  conversation: Conversation;
  output?: AssistantOutput;
  retry?: ModelRetryStatus | null;
  error?: string;
};
