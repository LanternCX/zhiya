import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AnimationPage } from "../../domain/learning";

const nodeId = Type.String({ minLength: 1, maxLength: 48 });
export const animationLimits = {
  nodes: 8,
  edges: 10,
  buttons: 3,
  stepsPerButton: 4,
  actionsPerStep: 2,
  actionsPerPage: 12,
} as const;

type AnimationDraft = Omit<AnimationPage, "kind" | "id"> & { pageId: string };

function assertSimpleAnimation(page: AnimationDraft) {
  const nodes = new Map(page.nodes.map(node => [node.id, node]));
  const ids = new Set<string>();
  for (const item of [...page.nodes, ...page.edges]) {
    if (ids.has(item.id)) throw new Error(`图示对象 ID 重复：${item.id}`);
    ids.add(item.id);
  }
  for (const edge of page.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      throw new Error(`连线 ${edge.id} 引用了不存在的图形`);
  }
  for (const node of page.nodes) {
    if (node.groupId && (node.shape === "group" || nodes.get(node.groupId)?.shape !== "group"))
      throw new Error(`图形 ${node.id} 的分组无效：分组必须存在且不能嵌套`);
  }
  const buttons = new Set<string>();
  for (const button of page.buttons) {
    if (buttons.has(button.id)) throw new Error(`按钮 ID 重复：${button.id}`);
    buttons.add(button.id);
    for (const action of button.steps.flat()) {
      if (!ids.has(action.targetId)) throw new Error(`动作引用了不存在的对象 ${action.targetId}`);
      if (action.type === "flow" && !page.edges.some(edge => edge.id === action.targetId))
        throw new Error(`流动动作必须引用连线：${action.targetId}`);
    }
  }
  const actionCount = page.buttons.reduce(
    (total, button) =>
      total +
      button.steps.reduce((buttonTotal, step) => buttonTotal + step.length, 0),
    0,
  );
  if (actionCount > animationLimits.actionsPerPage)
    throw new Error(
      `动画整页最多包含 ${animationLimits.actionsPerPage} 个动作，当前为 ${actionCount} 个。请删减并重新发布。`,
    );
}

const action = Type.Union([
  Type.Object(
    {
      type: Type.Union([
        Type.Literal("show"),
        Type.Literal("hide"),
        Type.Literal("highlight"),
      ]),
      targetId: nodeId,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("flow"), targetId: nodeId },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("update"),
      targetId: nodeId,
      value: Type.String({ maxLength: 80 }),
    },
    { additionalProperties: false },
  ),
]);

export function publishAnimationTool(
  publish: (page: AnimationDraft) => void,
): AgentTool {
  return {
    name: "publish_animation",
    label: "发布动画页",
    description:
      "Publish one complete structured diagram or animation. Static diagrams use buttons: []. Cycles and self-loops are allowed. Groups are non-nested visual containers. Every edge must reference nodes, and flow actions must reference edges. The app computes sizes and routes. This releases any wait for the scene but never presents it automatically. Never supply SVG, code, styles, colors, or coordinates.",
    parameters: Type.Object(
      {
        pageId: Type.String({ minLength: 1, maxLength: 64 }),
        title: Type.String({ minLength: 1, maxLength: 48 }),
        layout: Type.Union([
          Type.Literal("horizontal"),
          Type.Literal("vertical"),
          Type.Literal("grid"),
        ]),
        nodes: Type.Array(
          Type.Object(
            {
              id: nodeId,
              shape: Type.Union([
                Type.Literal("rectangle"),
                Type.Literal("circle"),
                Type.Literal("diamond"),
                Type.Literal("text"),
                Type.Literal("group"),
              ]),
              label: Type.String({ minLength: 1, maxLength: 80 }),
              groupId: Type.Optional(nodeId),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: animationLimits.nodes },
        ),
        edges: Type.Array(
          Type.Object(
            {
              id: nodeId,
              source: nodeId,
              target: nodeId,
              label: Type.Optional(Type.String({ maxLength: 48 })),
              arrow: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
          { maxItems: animationLimits.edges },
        ),
        buttons: Type.Array(
          Type.Object(
            {
              id: nodeId,
              label: Type.String({ minLength: 1, maxLength: 32 }),
              steps: Type.Array(
                Type.Array(action, {
                  minItems: 1,
                  maxItems: animationLimits.actionsPerStep,
                }),
                {
                  minItems: 1,
                  maxItems: animationLimits.stepsPerButton,
                },
              ),
            },
            { additionalProperties: false },
          ),
          { maxItems: animationLimits.buttons },
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const page = params as AnimationDraft;
      assertSimpleAnimation(page);
      publish(page);
      return {
        content: [
          {
            type: "text",
            text: "Animation page is ready for the teacher.",
          },
        ],
        details: {},
      };
    },
  };
}
