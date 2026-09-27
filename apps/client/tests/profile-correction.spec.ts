import { expect, test } from "@playwright/test";
import { mockLearning } from "./mock-learning";

test("profile correction stays in the main panel and preserves the draft on failure", async ({
  page,
}) => {
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: {
        id: "student",
        nickname: "小芽",
        email: "student@example.com",
        avatar: "",
      },
    }),
  );
  const state = {
    id: "session",
    purpose: "onboarding",
    completed: true,
    question: null,
    messages: [],
    memory: "喜欢先看例子",
    memoryVersion: 1,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
  };
  await page.route("**/api/learning/model", (r) =>
    r.fulfill({ json: { id: "test", available: true } }),
  );
  let failClaim: () => void = () => {};
  const claim = new Promise<void>((resolve) => {
    failClaim = resolve;
  });
  await mockLearning(
    page,
    () => state,
    async (action) => {
      if (action.action === "end_correction") {
        return { state: { ...state, correctionEnded: true, revision: 1 } };
      }
      await claim;
      throw new Error("暂时无法修改，请重试");
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自由探索" }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dialog = page.getByRole("region", { name: "学习档案" });
  await dialog
    .getByRole("textbox", { name: "修改或忘记" })
    .fill("我想先自己试试");
  await dialog.getByRole("button", { name: "提交修改" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status", { name: "正在思考" })).toContainText(
    /正在整理你的学习档案… · \d+ 秒/,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "探索即将开放" })).toHaveCount(
    0,
  );
  failClaim();
  await expect(page.getByRole("alert")).toContainText("暂时无法修改");
  await expect(
    page.getByRole("banner").getByRole("button", { name: "停止对话" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", { name: "返回档案" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "停止对话" }).click();
  await expect(dialog.getByRole("textbox", { name: "修改或忘记" })).toBeEmpty();
});

test("profile correction retries after a partial model stream disconnects", async ({
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
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  let state = {
    id: "session",
    purpose: "onboarding",
    completed: true,
    correctionEnded: false,
    question: null,
    messages: [] as unknown[],
    memory: "喜欢先看例子",
    memoryVersion: 1,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
  };
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { id: "test", available: true } }),
  );
  await mockLearning(page, () => state, async (action) => {
    if (action.action === "claim") {
      state = {
        ...state,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: action.correctionText }],
            timestamp: 1,
          },
        ],
        messageSequence: 1,
        revision: state.revision + 1,
        status: "running",
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      };
      return {
        data: { runId: "correction-run" },
        state: { ...state, messages: state.messages.slice(-1) },
      };
    }
    if (action.action === "message") {
      state = {
        ...state,
        messages: [...state.messages, action.message],
        messageSequence: state.messageSequence + 1,
        revision: state.revision + 1,
      };
      return { state: { ...state, messages: [action.message] } };
    }
    if (action.action === "release") {
      state = {
        ...state,
        revision: state.revision + 1,
        status: "idle",
        leaseUntil: "",
      };
    }
    return { state: { ...state, messages: [] } };
  });

  await page.goto("/");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let requests = 0;
    Object.assign(window, { correctionModelRequests: () => requests });
    window.fetch = (input, init) => {
      if (
        init?.method !== "POST" ||
        !String(input).endsWith("/api/learning/model")
      )
        return originalFetch(input, init);
      requests++;
      const chunk = (content: string, finishReason: string | null = null) =>
        `data: ${JSON.stringify({
          id: `correction-${requests}`,
          object: "chat.completion.chunk",
          created: 1,
          model: "test",
          choices: [
            {
              index: 0,
              delta: content
                ? { role: "assistant", content }
                : {},
              finish_reason: finishReason,
            },
          ],
        })}\n\n`;
      if (requests === 1) {
        return Promise.resolve(
          new Response(
            chunk("还没有生成完") +
              `data: ${JSON.stringify({
                error: {
                  message: "模型连接中断，请重试",
                  type: "upstream_connection_error",
                },
              })}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          chunk("连接恢复了。") + chunk("", "stop") + "data: [DONE]\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    };
  });

  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "学习档案", exact: true }).click();
  const profile = page.getByRole("region", { name: "学习档案" });
  await profile
    .getByRole("textbox", { name: "修改或忘记" })
    .fill("我想先自己试试");
  await profile.getByRole("button", { name: "提交修改" }).click();

  await expect(
    page.getByText("连接不稳定，正在重新连接（1/5）", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { correctionModelRequests: () => number })
            .correctionModelRequests(),
      ),
    )
    .toBe(2);
  await expect(
    page.getByText("连接不稳定，正在重新连接（1/5）", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).not.toContainText("交流暂时中断");
});
