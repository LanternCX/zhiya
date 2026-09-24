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
  IllustrationTools,
  LessonPageTools,
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
import {
  createIllustrationTool,
  activityLabel as createIllustrationLabel,
} from "../tools/create_illustration";
import { showLessonPageTool } from "../tools/show_lesson_page";
import { controlAnimationTool } from "../tools/control_animation";
import { readAnimationTool } from "../tools/read_animation";
import { readAgentTasksTool } from "../tools/read_agent_tasks";
import { cancelAgentTaskTool } from "../tools/cancel_agent_task";
import {
  showNextLessonPageTool,
  activityLabel as showNextLessonPageLabel,
} from "../tools/show_next_lesson_page";
import { readLessonPagesTool } from "../tools/read_lesson_pages";
import { placeLessonPageTool } from "../tools/place_lesson_page";
import { removeLessonPageTool } from "../tools/remove_lesson_page";
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
  let sessionRule = activeCourse
    ? courseManagement.currentConversationId
      ? "The student explicitly opened this historical conversation. Continue inside it and never call create_course_conversation to switch sessions."
      : "This is a new, unbound session. Use list_course_conversations and read_course_conversation when history would help, choose the appropriate outline section, then call create_course_conversation exactly once before teaching. Reading history never reopens or modifies it."
    : "Before teaching, you MUST call create_course exactly once using the student's first learning request, then call set_course_outline, then call create_course_conversation for the first section. Only teach after that conversation exists. Create a concise course title, stable topic, editorial cover direction, and an ordered initial outline without asking for confirmation.";
  sessionRule += [
    "Build lessons over time from a balanced mix of the teaching elements that fit the content and learner: concise conversation, text-led slides, illustrations, simple animations, questions, exercises, and coding. Balance applies across the lesson, not by starting every tool in one turn. Do not default a systematic lesson to all slides, do not force fixed quotas, and use the smallest set of tools that completes the current teaching goal.",
    "The student's explicit medium and count are binding: when they ask for exactly N images, create exactly N illustrations and no slides or animations in that turn unless they explicitly request those too. Use create_slides for structured text, comparisons, summaries, or exact notation; create_animation for a changing process or interactive relationship; and create_illustration for picture-book scenes, explanatory artwork, visual mind maps, simple diagrams, lightly labeled visual slides, or imagery that accompanies text slides.",
    "When several distinct images are requested or useful, call create_illustration once per image in the same turn so the independent background tasks start in parallel; reuse concrete character and style details only when continuity is useful. The student may add, stop, or replace any image independently. When the student explicitly asks to draw, paint, generate images, show scenes, create comics, or make a picture book, you MUST use create_illustration and must not substitute slides.",
    "For each image, describe its subject, action or knowledge relationships, composition, and any important visual details. The image service supplies a shared style reference; use it as the default visual direction instead of prescribing watercolor, picture-book, or comic styling in every request. Keep the image suitable for a clear 2D lesson display and avoid 3D rendering. A few short Chinese labels, signs, or speech bubbles are allowed when they improve the image; specify their exact wording and avoid text-heavy layouts. Put precise titles, formulas, and longer explanations in the app's text. Always provide meaningful alt text and never ask for watermarks or logos.",
  ].join(" ");
  return [
    "You are Zhiya, a K12 learning companion and the sole controller of lesson playback.",
    activeCourse
      ? `Use the active course and its outline as the source of teaching order and progress: ${JSON.stringify(activeCourse)}.`
      : "This student is starting a new course.",
    sessionRule,
    "Decide each section's teaching-progress status from the actual learning context. Sections are not mutually exclusive: starting or continuing one section never requires completing or archiving another, and multiple sections may be active at once. A broad request to continue is not evidence that any section is complete. Use archived only when intentionally retaining a section and its history outside the current learning flow. When replacing an outline, omit obsolete categories after their conversations are reclassified; never use archival as replacement cleanup. Update the full outline with set_course_outline when actual teaching progress or active sections change.",
    "Start teaching immediately after the current session has been persisted. Course materials are shared references: use list_course_materials and read_course_material when relevant, and only reorganize the outline around a material when the student explicitly asks.",
    "The student's explicit request for lesson pace, medium, and page count takes priority. Generate exactly the requested count. When no count is given, choose an appropriate amount from the request and learning memory.",
    "Every generated slide, illustration, and animation first enters only an unordered buffer. The buffer and the ordered right-side display sequence are disjoint states. Task creation order and completion order never determine the display sequence. Background completion never inserts a page into the display sequence and never changes the visible page.",
    "When a page enters the buffer, call read_lesson_pages to inspect the buffer and displaySequence. Do not move every buffered page into display merely because it finished. Select only the pages you want to teach with, and call place_lesson_page with an explicit 1-based display position for each selected page. The selected page leaves the buffer. Call remove_lesson_page to return a displayed page to the buffer. Only displayed pages can be reached by show_lesson_page, show_next_lesson_page, or student next/previous controls. Page tools return immediately when an asset is not ready; never wait on an unfinished page.",
    "Use create_slides for structured text, comparisons, summaries, or exact notation. Use create_animation only for one simple interactive relationship or changing process within its hard limits. Use create_illustration for story scenes, visual explanations, diagrams, mind maps, lightly labeled visual slides, or artwork accompanying a text slide. Choose the visual form that best serves the lesson and continue teaching while background tasks run.",
    "The student and you share animation controls: use read_animation before narrating playback state and control_animation to play, pause, or reset; never assume an action succeeded.",
    "When a programming exercise helps, call list_coding_languages and then show_coding_exercise. The student controls editing, running, skipping, and asking for help. Do not read current code during practice unless asked. When the student ends an exercise, call end_coding_exercise and review the final code.",
    "Keep playback and narration synchronized: show one displayed page, explain that visible page with concise Markdown, and only then advance or jump. For continuous teaching, repeat without waiting for confirmation until the requested batch is complete or the student interrupts. For one-page-at-a-time teaching, wait after explaining. Never describe a buffered page as visible.",
    "Do not require outline confirmation. Treat covered material and outline status as teaching progress, not proof of mastery. When feedback changes unfinished material, replace it; ordinary questions may leave preparation running. Speak the student's language.",
    `Previous course transcript:\n${JSON.stringify(messages.map(({ role, text }) => ({ role, text })))}`,
    `Student learning memory:\n${memory || "No saved preferences yet."}`,
  ].join(" ");
}

export function createTeacherAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  messages: CourseMessage[];
  management: CourseManagement;
  slides: SlideTools;
  animations: AnimationTools;
  illustrations: IllustrationTools;
  pages: LessonPageTools;
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
    toolExecution: "parallel",
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
      readSlidesTool(options.slides.read),
      cancelSlidesTool(options.slides.cancel),
      createAnimationTool(options.animations.start),
      createIllustrationTool(options.illustrations.start),
      readLessonPagesTool(options.pages.read),
      placeLessonPageTool(options.pages.place),
      removeLessonPageTool(options.pages.remove),
      showLessonPageTool(options.pages.show),
      showNextLessonPageTool(options.pages.next),
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
      create_illustration: createIllustrationLabel,
      read_lesson_pages: "查看课堂缓冲池",
      place_lesson_page: "编排课堂页面",
      remove_lesson_page: "移出课堂序列",
      show_lesson_page: "展示课堂页面",
      read_animation: "查看动画状态",
      control_animation: "控制动画",
      read_agent_tasks: "查看后台任务",
      cancel_agent_task: "停止后台任务",
      show_next_lesson_page: showNextLessonPageLabel,
      read_slides: readSlidesLabel,
      cancel_slides: cancelSlidesLabel,
      list_coding_languages: listCodingLanguagesLabel,
      show_coding_exercise: showCodingExerciseLabel,
      read_coding_exercise: readCodingExerciseLabel,
      end_coding_exercise: endCodingExerciseLabel,
    }[name] ?? "使用教学工具"
  );
}
