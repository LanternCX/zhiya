import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AgentTaskTools } from "../tool";

export function readAgentTasksTool(read: AgentTaskTools["read"]): AgentTool {
  return {
    name: "read_agent_tasks",
    label: "查看后台任务",
    description:
      "Read all background child-agent tasks and their actual states. Use this before referring to results that may still be generating.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const tasks = read();
      return {
        content: [{ type: "text", text: JSON.stringify(tasks) }],
        details: { tasks },
      };
    },
  };
}
