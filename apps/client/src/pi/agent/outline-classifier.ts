import type { Agent, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  ModelInfo,
  ModelRetryListener,
  OutlineClassification,
  OutlineReorganization,
  StoredCourseConversation,
} from "../../domain/learning";
import { createAgent } from "../agent";
import type { ModelGateway } from "../gateway";

function classifierPrompt(reorganization: OutlineReorganization) {
  return `You classify one K12 course conversation into a revised course outline. Decide from the conversation's actual learning content, not its previous sectionId. Assign exactly one primary teaching objective. Cross-topic questions do not outweigh the main learning activity. Call assign_course_conversation exactly once and emit no prose. If no section is a reasonable fit, propose one concise new section instead.\nRevised outline:\n${JSON.stringify(reorganization.sections)}`;
}

function classificationContent(conversation: StoredCourseConversation) {
  const allMessages = conversation.state.messages.map(({ role, text }) => ({
    role,
    text: text.slice(0, 2_000),
  }));
  let messages = allMessages;
  if (JSON.stringify(allMessages).length > 24_000) {
    const head = allMessages.slice(0, 6);
    const tail: typeof allMessages = [];
    let characters = JSON.stringify(head).length;
    for (let index = allMessages.length - 1; index >= head.length; index--) {
      const size = JSON.stringify(allMessages[index]).length;
      if (characters + size > 24_000) break;
      tail.unshift(allMessages[index]);
      characters += size;
    }
    messages = [...head, ...tail];
  }
  return JSON.stringify({
    id: conversation.id,
    title: conversation.title,
    messages,
    pageTitles: conversation.state.pages.map(({ title }) => title).slice(-40),
    transcriptTruncated: messages.length < allMessages.length,
  });
}

export async function classifyCourseConversation(options: {
  model: ModelInfo;
  gateway: ModelGateway;
  reorganization: OutlineReorganization;
  conversation: StoredCourseConversation;
  onRetry: ModelRetryListener;
  register: (agent: Agent) => void;
  unregister: (agent: Agent) => void;
}) {
  let classification: OutlineClassification | null = null;
  const tool: AgentTool = {
    name: "assign_course_conversation",
    label: "分类历史学习",
    description:
      "Assign this conversation to one revised outline section, or propose a new section when none fits.",
    parameters: Type.Object({
      sectionId: Type.Optional(Type.String({ minLength: 1 })),
      newSection: Type.Optional(
        Type.Object({
          title: Type.String({ minLength: 1, maxLength: 100 }),
          objective: Type.String({ minLength: 1, maxLength: 500 }),
        }),
      ),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as {
        sectionId?: string;
        newSection?: { title: string; objective: string };
        reason: string;
      };
      if (Boolean(input.sectionId) === Boolean(input.newSection))
        throw new Error("必须选择一个已有小节或提出一个新小节");
      if (
        input.sectionId &&
        !options.reorganization.sections.some(
          (section) => section.id === input.sectionId,
        )
      )
        throw new Error("所选小节不在当前大纲草稿中，请重新分类");
      classification = input.sectionId
        ? { sectionId: input.sectionId, reason: input.reason }
        : { newSection: input.newSection!, reason: input.reason };
      return {
        content: [{ type: "text", text: "Conversation classified." }],
        details: {},
        terminate: true,
      };
    },
  };
  const agent = createAgent({
    model: options.model,
    tools: [tool],
    systemPrompt: classifierPrompt(options.reorganization),
    shouldStopAfterTurn: () => classification !== null,
    request: (payload, signal) => {
      payload.parallel_tool_calls = false;
      return options.gateway.course(
        "outline-classifier",
        payload,
        signal,
        options.onRetry,
      );
    },
  });
  options.register(agent);
  try {
    await agent.prompt(classificationContent(options.conversation));
    if (!classification) throw new Error("课程对话分类没有产生结果");
    return classification;
  } finally {
    options.unregister(agent);
  }
}
