import type {
  ModelInfo,
  ModelRetryListener,
  CourseMessage,
} from "../../domain/learning";
import type { ModelGateway } from "../gateway";
import { createAgent } from "../agent";
import type {
  CourseManagement,
  CodingTools,
  SlideTools,
  AnimationTools,
  AgentTaskTools,
  TeachingToolContext,
} from "../tool";
import {
  listCodingLanguagesTool,
  activityLabel as listCodingLanguagesLabel,
} from "../tools/list_coding_languages";
import {
  showCodingExerciseTool,
  activityLabel as showCodingExerciseLabel,
} from "../tools/show_coding_exercise";
import {
  readCodingExerciseTool,
  activityLabel as readCodingExerciseLabel,
} from "../tools/read_coding_exercise";
import {
  endCodingExerciseTool,
  activityLabel as endCodingExerciseLabel,
} from "../tools/end_coding_exercise";
import {
  createCourseTool,
  activityLabel as createCourseLabel,
} from "../tools/create_course";
import {
  renameCourseTool,
  activityLabel as renameCourseLabel,
} from "../tools/rename_course";
import {
  createSlidesTool,
  activityLabel as createSlidesLabel,
} from "../tools/create_slides";
import {
  createAnimationTool,
  activityLabel as createAnimationLabel,
} from "../tools/create_animation";
import { showLessonPageTool } from "../tools/show_lesson_page";
import { controlAnimationTool } from "../tools/control_animation";
import { readAnimationTool } from "../tools/read_animation";
import { readAgentTasksTool } from "../tools/read_agent_tasks";
import { cancelAgentTaskTool } from "../tools/cancel_agent_task";
import {
  showNextSlideTool,
  activityLabel as showNextSlideLabel,
} from "../tools/show_next_slide";
import {
  readSlidesTool,
  activityLabel as readSlidesLabel,
} from "../tools/read_slides";
import {
  cancelSlidesTool,
  activityLabel as cancelSlidesLabel,
} from "../tools/cancel_slides";
import {
  setCourseOutlineTool,
  activityLabel as setCourseOutlineLabel,
} from "../tools/set_course_outline";
import {
  listCourseMaterialsTool,
  activityLabel as listCourseMaterialsLabel,
} from "../tools/list_course_materials";
import {
  readCourseMaterialTool,
  activityLabel as readCourseMaterialLabel,
} from "../tools/read_course_material";
import {
  createCourseConversationTool,
  activityLabel as createCourseConversationLabel,
} from "../tools/create_course_conversation";
import {
  listCourseConversationsTool,
  activityLabel as listCourseConversationsLabel,
} from "../tools/list_course_conversations";
import {
  readCourseConversationTool,
  activityLabel as readCourseConversationLabel,
} from "../tools/read_course_conversation";

function teacherPrompt(
  courseManagement: CourseManagement,
  messages: CourseMessage[],
  memory: string,
) {
  const course = courseManagement.course;
  const activeSection = course?.sections?.find((section) =>
    section.conversations.some(
      (conversation) =>
        conversation.id === courseManagement.currentConversationId,
    ),
  );
  const activeCourse = course
    ? {
        title: course.title,
        topic: course.topic,
        activeConversationId: courseManagement.currentConversationId,
        activeSectionId: activeSection?.id ?? "",
        outline: (course.sections ?? []).map((section) => ({
          id: section.id,
          title: section.title,
          objective: section.objective,
          status: section.status,
          conversations: section.conversations.map(
            ({ id, title, createdAt, updatedAt }) => ({
              id,
              title,
              createdAt,
              updatedAt,
            }),
          ),
        })),
      }
    : null;
  const sessionRule = activeCourse
    ? courseManagement.currentConversationId
      ? "The student explicitly opened this historical conversation. Continue inside it and never call create_course_conversation to switch sessions."
      : "This is a new, unbound session. Use list_course_conversations and read_course_conversation when history would help, choose the appropriate outline section, then call create_course_conversation exactly once before teaching. Reading history never reopens or modifies it."
    : "Before teaching, you MUST call create_course exactly once using the student's first learning request, then call set_course_outline, then call create_course_conversation for the first section. Only teach after that conversation exists. Create a concise course title, stable topic, editorial cover direction, and an ordered initial outline without asking for confirmation.";
  return `You are Zhiya, a K12 learning companion and the sole controller of lesson playback. ${activeCourse ? `Use the active course and its outline as the source of teaching order and progress: ${JSON.stringify(activeCourse)}.` : "This student is starting a new course."} ${sessionRule} You decide each section's teaching-progress status from the actual learning context. Sections are not mutually exclusive: starting or continuing one section never requires completing or archiving another, and multiple sections may be active at once. A broad request to continue is not evidence that any section is complete. Use archived only when intentionally retaining a section and its history outside the current learning flow. When replacing an outline, omit obsolete categories so they are deleted after their conversations are reclassified; never use archival as replacement cleanup. Update the full outline with set_course_outline when actual teaching progress or the active sections change. Start teaching immediately after the current session has been persisted. Course materials are shared references: use list_course_materials and read_course_material when they are relevant, and only reorganize the outline around a material when the student explicitly asks. The student's explicit request for lesson pace and page count takes priority. A lesson is one ordered sequence of pages and may mix explanations, slides, animations, exercises, questions, and review. Generate the number of visual pages the student requests; when no count is given, choose an appropriate batch from the current request and learning memory. Use create_slides for text-led presentation pages; it starts a background task, but every generated page stays hidden until a show tool succeeds. Use create_animation only when one simple relationship or changing process benefits from a constrained interactive diagram; it starts one background task and returns immediately, so keep teaching and start multiple independent tasks when useful. Keep each animation goal within the create_animation tool's hard limits and never ask for unsupported visual styling or code. Background completion never changes the visible page. Call show_next_slide for the next ordered generated page, or show_lesson_page with a known pageId, and wait for the tool to succeed before narrating that page. The student and you share the same animation controls: use read_animation before narrating playback state and control_animation to play, pause, or reset; never assume a requested action succeeded. When a programming exercise would help, call list_coding_languages and then show_coding_exercise with an available language; you decide when to offer it without asking permission first. Once shown, the student controls whether to edit, run, skip, or ask for help. Do not read their current code during practice unless they explicitly ask for help. Running code does not require a response from you. When the student ends an exercise, call end_coding_exercise and review the returned final code even if it works. Keep playback and narration synchronized: show one page, explain that page with concise Markdown, and only then call show_next_slide. If the student asks for continuous teaching, repeat this cycle and do not wait for confirmation until the requested batch is complete or the student interrupts. If the student asks for one page at a time, explain the current page and wait for the student before advancing. Never advance while explaining, describe a page that is merely generated but not visible, or promise to continue without actually calling show_next_slide when another requested page remains. Do not require outline confirmation. Treat covered material and outline status as teaching progress, not proof of mastery. When feedback changes unfinished material, replace it; ordinary questions may leave preparation running. Speak the student's language.\nPrevious course transcript:\n${JSON.stringify(messages.map(({ role, text }) => ({ role, text })))}\nStudent learning memory:\n${memory || "No saved preferences yet."}`;
}

export function createTeacherAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  messages: CourseMessage[];
  management: CourseManagement;
  slides: SlideTools;
  animations: AnimationTools;
  tasks: AgentTaskTools;
  coding: CodingTools;
  onRetry: ModelRetryListener;
}) {
  const initial = options.management.course;
  const context: TeachingToolContext = {
    course: {
      id: initial?.id ?? "",
      title: initial?.title ?? "",
      topic: initial?.topic ?? "",
    },
    management: options.management,
  };
  return createAgent({
    model: options.model,
    tools: [
      createCourseTool(context),
      renameCourseTool(context),
      setCourseOutlineTool(context),
      createCourseConversationTool(context),
      listCourseConversationsTool(context),
      readCourseConversationTool(context),
      listCourseMaterialsTool(context),
      readCourseMaterialTool(context),
      createSlidesTool(options.slides.start),
      showNextSlideTool(options.slides.next),
      readSlidesTool(options.slides.read),
      cancelSlidesTool(options.slides.cancel),
      createAnimationTool(options.animations.start),
      showLessonPageTool(options.animations.show),
      readAnimationTool(options.animations.playback),
      controlAnimationTool(options.animations.control),
      readAgentTasksTool(options.tasks.read),
      cancelAgentTaskTool(options.tasks.cancel),
      listCodingLanguagesTool(options.coding.languages),
      showCodingExerciseTool(options.coding.show),
      readCodingExerciseTool(options.coding.read),
      endCodingExerciseTool(options.coding.end),
    ],
    systemPrompt: teacherPrompt(
      options.management,
      options.messages,
      options.memory,
    ),
    request: (payload, signal) => {
      return options.gateway.course(
        "teacher",
        payload,
        signal,
        options.onRetry,
      );
    },
  });
}

export function teacherToolLabel(name: string) {
  return (
    {
      create_course: createCourseLabel,
      rename_course: renameCourseLabel,
      set_course_outline: setCourseOutlineLabel,
      create_course_conversation: createCourseConversationLabel,
      list_course_conversations: listCourseConversationsLabel,
      read_course_conversation: readCourseConversationLabel,
      list_course_materials: listCourseMaterialsLabel,
      read_course_material: readCourseMaterialLabel,
      create_slides: createSlidesLabel,
      create_animation: createAnimationLabel,
      show_lesson_page: "展示课堂页面",
      read_animation: "查看动画状态",
      control_animation: "控制动画",
      read_agent_tasks: "查看后台任务",
      cancel_agent_task: "停止后台任务",
      show_next_slide: showNextSlideLabel,
      read_slides: readSlidesLabel,
      cancel_slides: cancelSlidesLabel,
      list_coding_languages: listCodingLanguagesLabel,
      show_coding_exercise: showCodingExerciseLabel,
      read_coding_exercise: readCodingExerciseLabel,
      end_coding_exercise: endCodingExerciseLabel,
    }[name] ?? "使用教学工具"
  );
}
