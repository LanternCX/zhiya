import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { QuestionTools } from "../tool";

export const activityLabel = "展示练习题";

export function showQuestionTool(show: QuestionTools["show"]): AgentTool {
  return {
    name: "show_question",
    label: activityLabel,
    description: "Create and show exactly one interactive question page in the lesson. Use one call per question. The title supports inline Markdown; the question text and choice options support Markdown, including code. Put only the question and necessary context in text. Put choices only in options; the page renders them separately. Never enumerate or repeat choices in text. Do not provide a correct answer; the student's response will be sent to you for review. For true_false and blank questions, omit options.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 100, description: "Short question label. Inline Markdown is supported." }),
      text: Type.String({ minLength: 1, maxLength: 1000, description: "Question stem and necessary context only, in Markdown. Do not list or repeat any answer options here." }),
      kind: Type.Union([
        Type.Literal("single"),
        Type.Literal("multiple"),
        Type.Literal("true_false"),
        Type.Literal("blank"),
      ]),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 8, description: "Answer choices for single or multiple choice; shown below the stem automatically. Do not also put them in text." })),
    }),
    executionMode: "sequential",
    execute: async (id, params) => {
      const draft = params as { title: string; text: string; kind: "single" | "multiple" | "true_false" | "blank"; options?: string[] };
      const options = draft.kind === "true_false" ? ["对", "错"] : draft.options ?? [];
      if ((draft.kind === "single" || draft.kind === "multiple") && options.length < 2)
        throw new Error("选择题至少需要两个选项");
      if ((draft.kind === "blank" || draft.kind === "true_false") && draft.options?.length)
        throw new Error("判断题和填空题不需要选项");
      if (new Set(options).size !== options.length)
        throw new Error("选项不能重复");
      if (draft.kind === "single" || draft.kind === "multiple") {
        const compact = (value: string) => value.replace(/[`*_~\s]/g, "");
        const stem = compact(draft.text);
        if (options.some((option) => {
          const choice = compact(option);
          return choice.length >= 4 && stem.includes(choice);
        })) throw new Error("题干不能重复列出选项；请只在 options 中提供选项");
      }
      const page = show(id, { title: draft.title, text: draft.text, questionKind: draft.kind, options });
      return {
        content: [{ type: "text", text: `The question page is now visible: ${JSON.stringify({ id: page.id, title: page.title })}. The student may answer now, ask for help, or defer it and answer later. Do not review until a response is submitted.` }],
        details: { pageId: page.id },
      };
    },
  };
}
