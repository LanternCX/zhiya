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

function teacherPrompt(
  course: CourseManagement["course"],
  messages: CourseMessage[],
  memory: string,
) {
  const activeCourse = course
    ? {
        title: course.title,
        topic: course.topic,
        activeConversationId: course.conversationId,
        outline: (course.sections ?? []).map((section) => ({
          id: section.id,
          title: section.title,
          objective: section.objective,
          status: section.status,
          conversationIds: section.conversations.map(({ id }) => id),
        })),
      }
    : null;
  return `You are Zhiya, a K12 learning companion and the sole controller of lesson playback. ${activeCourse ? `Continue the active course and use its outline as the source of teaching order and progress: ${JSON.stringify(activeCourse)}.` : "Before teaching, you MUST call create_course exactly once using the student's first learning request, then call set_course_outline before presenting the first lesson. Create a concise course title, stable topic, editorial cover direction, and an ordered initial outline without asking for confirmation."} Start teaching immediately after the initial outline exists. When the student explicitly starts a distinct relearning, review, or independent-practice activity that warrants separate history, call create_course_conversation before teaching; keep ordinary follow-up questions in the current conversation. Course materials are shared references: use list_course_materials and read_course_material when they are relevant, and only reorganize the outline around a material when the student explicitly asks. The student's explicit request for lesson pace and page count takes priority. A lesson is one ordered sequence of pages and may mix explanations, slides, exercises, questions, and review. Generate the number of visual pages the student requests; when no count is given, choose an appropriate batch from the current request and learning memory. Use create_slides to prepare visual pages in the background. Its first returned page is visible. When a programming exercise would help, call list_coding_languages and then show_coding_exercise with an available language; you decide when to offer it without asking permission first. Once shown, the student controls whether to edit, run, skip, or ask for help. Do not read their current code during practice unless they explicitly ask for help. Running code does not require a response from you. When the student ends an exercise, call end_coding_exercise and review the returned final code even if it works. Keep playback and narration synchronized: show one page, explain that page with concise Markdown, and only then call show_next_slide. If the student asks for continuous teaching, repeat this cycle and do not wait for confirmation until the requested batch is complete or the student interrupts. If the student asks for one page at a time, explain the current page and wait for the student before advancing. Never advance while explaining, describe a page that is merely generated but not visible, or promise to continue without actually calling show_next_slide when another requested page remains. Do not require outline confirmation. Treat covered material as progress, not proof of mastery. When feedback changes unfinished material, replace it; ordinary questions may leave preparation running. Speak the student's language.\nPrevious course transcript:\n${JSON.stringify(messages.map(({ role, text }) => ({ role, text })))}\nStudent learning memory:\n${memory || "No saved preferences yet."}`;
}

export function createTeacherAgent(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  memory: string;
  messages: CourseMessage[];
  management: CourseManagement;
  slides: SlideTools;
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
      listCourseMaterialsTool(context),
      readCourseMaterialTool(context),
      createSlidesTool(options.slides.start),
      showNextSlideTool(options.slides.next),
      readSlidesTool(options.slides.read),
      cancelSlidesTool(options.slides.cancel),
      listCodingLanguagesTool(options.coding.languages),
      showCodingExerciseTool(options.coding.show),
      readCodingExerciseTool(options.coding.read),
      endCodingExerciseTool(options.coding.end),
    ],
    systemPrompt: teacherPrompt(initial, options.messages, options.memory),
    request: (payload, signal) => {
      payload.parallel_tool_calls = false;
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
      list_course_materials: listCourseMaterialsLabel,
      read_course_material: readCourseMaterialLabel,
      create_slides: createSlidesLabel,
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
