import { ToolAPI } from "./api";
import type { Conversation, ConversationStore } from "../pi/contracts";

export function profileStore(
  api: ToolAPI,
  receive: (state: Conversation) => void,
  active: () => boolean,
  waiting: (controller?: AbortController) => void,
) {
  let operations = Promise.resolve();
  const apply = <T>(action: object): Promise<T> => {
    const result = operations.then(() =>
      api.json<{ state: Conversation; data: T }>(
        "/learning/action",
        "POST",
        { requestId: crypto.randomUUID(), action },
      ),
    );
    operations = result.then(
      (response) => {
        receive(response.state);
      },
      () => {},
    );
    return result.then((response) => response.data);
  };
  const current = async () => {
    await operations;
    const state = await api.json<Conversation>("/learning");
    receive(state);
    return state;
  };
  const store: ConversationStore = {
    open: current,
    current,
    waitForChange: async (revision) => {
      const controller = new AbortController();
      waiting(controller);
      try {
        while (active()) {
          const state = (await (
            await api.request(
              `/learning?after=${revision}`,
              "GET",
              undefined,
              controller.signal,
            )
          ).json()) as Conversation;
          if (state.revision > revision) return state;
        }
        throw new Error("执行已停止");
      } finally {
        waiting();
      }
    },
    claim: (correction) => apply({ action: "claim", ...correction }),
    release: (runId) => apply({ action: "release", runId }),
    heartbeat: (runId) => apply({ action: "heartbeat", runId }),
    saveMessage: (runId, message) =>
      apply({ action: "message", runId, message }),
    executeTool: (runId, toolCallId) =>
      apply({ action: "tool", runId, toolCallId }),
    recordToolError: (runId, toolCallId) =>
      apply({ action: "tool_error", runId, toolCallId }),
  };

  return { store, settled: () => operations };
}
