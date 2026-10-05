import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { CodingTools } from "../tool";
import type { CodingExercise } from "../../domain/learning";

export const activityLabel = "展示编程练习";

export function showCodingExerciseTool(show: CodingTools["show"]): AgentTool {
  return {
    name: "show_coding_exercise",
    label: "展示编程练习",
    description:
      "Create a new coding exercise and append its first presentation to the lecture history. To resume an existing exercise, call show_lesson_page with its page ID instead; that preserves the student's code and results. Always show the exercise before asking the student to write code.",
    parameters: Type.Object({
      title: Type.String(),
      instructions: Type.String(),
      languageId: Type.Integer({ minimum: 1 }),
      languageName: Type.String(),
      starterCode: Type.String(),
    }),
    executionMode: "sequential",
    execute: async (id, params) => {
      const exercise = await show(
        id,
        params as Pick<
          CodingExercise,
          | "title"
          | "instructions"
          | "languageId"
          | "languageName"
          | "starterCode"
        >,
      );
      return {
        content: [
          {
            type: "text",
            text: `The coding page is now visible: ${JSON.stringify({ id: exercise.id, title: exercise.title, language: exercise.languageName })}. Let the student choose whether to work on it, skip it, or ask for help.`,
          },
        ],
        details: { exerciseId: exercise.id },
      };
    },
  };
}
