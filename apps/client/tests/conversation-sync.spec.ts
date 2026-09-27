import { expect, test } from "@playwright/test";
import { mockLearning } from "./mock-learning";

test("a completed message is synchronized without replacing the conversation", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        id: "student",
        nickname: "小芽",
        email: "student@example.com",
        avatar: "",
      },
    }),
  );
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { id: "test", available: false } }),
  );
  const assistant = (text: string) => ({
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: 1,
  });
  const initial = {
    id: "conversation",
    purpose: "onboarding",
    messages: [assistant("第一条完整回复")],
    messageSequence: 1,
    completed: false,
    correctionEnded: false,
    question: null,
    memory: "",
    memoryVersion: 0,
    revision: 1,
    status: "idle",
    leaseUntil: "",
  };
  const learning = await mockLearning(page, () => initial);
  await page.goto("/");
  await expect(page.getByText("第一条完整回复", { exact: true })).toBeVisible();
  learning.sync({
    ...initial,
    messages: [assistant("第二条完整回复")],
    messageSequence: 2,
    revision: 2,
  });
  await expect(page.getByText("第二条完整回复", { exact: true })).toBeVisible();
});

test("an unconfirmed action is retried with the same request id after reconnecting", async ({
  page,
}) => {
  const state = {
    id: "conversation",
    purpose: "onboarding",
    messages: [],
    messageSequence: 0,
    completed: true,
    correctionEnded: false,
    question: null,
    memory: "",
    memoryVersion: 0,
    revision: 1,
    status: "idle",
    leaseUntil: "",
  };
  await page.route("**/api/socket-ticket", (route) =>
    route.fulfill({ json: { ticket: crypto.randomUUID() } }),
  );
  const requestIds: string[] = [];
  let connections = 0;
  await page.routeWebSocket("**/api/learning/socket*", (ws) => {
    connections++;
    const connection = connections;
    ws.send(JSON.stringify({ type: "snapshot", state }));
    ws.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      requestIds.push(request.requestId);
      if (connection === 1) {
        void ws.close();
        return;
      }
      ws.send(
        JSON.stringify({
          type: "response",
          requestId: request.requestId,
          data: { ok: true },
          state,
        }),
      );
    });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ConversationChannel } = await import("/src/features/profile/channel.ts");
    const channel = new ConversationChannel();
    try {
      return await channel.answer("question", {
        selected: [],
        text: "喜欢动手尝试",
        skipped: false,
      });
    } finally {
      channel.close();
    }
  });
  expect(result).toEqual({ ok: true });
  expect(requestIds).toHaveLength(2);
  expect(requestIds[1]).toBe(requestIds[0]);
});
