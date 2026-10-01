import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AgentTaskTools } from "../tool";

export function cancelAgentTaskTool(cancel: AgentTaskTools["cancel"]): AgentTool {
  return {
    name: "cancel_agent_task",
    label: "停止后台任务",
    description:
      "Cancel one running child-agent task by taskId. The operation is immediate and never waits for the child.",
    parameters: Type.Object({ taskId: Type.String({ minLength: 1, maxLength: 100 }) }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const task = cancel((params as { taskId: string }).taskId);
      return {
        content: [{ type: "text", text: `Task cancelled: ${JSON.stringify(task)}` }],
        details: task,
      };
    },
  };
}
