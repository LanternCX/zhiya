import { expect, test } from "@playwright/test";
import { mockLearning } from "./mock-learning";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { root } from "../../../scripts/config.mjs";

test("Pi resumes a persisted question across devices and saves memory before completing", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90000);
  const email = `onboarding-${Date.now()}@example.com`;
  const headers = {
    "Content-Type": "application/json",
    "X-Zhiya-Request": "1",
  };
  const started = await context.request.post("/api/auth/register/start", {
    headers,
    data: { email },
  });
  expect(started.ok()).toBeTruthy();
  const { flow } = await started.json();
  const services = parseEnv(
    readFileSync(
      resolve(root, process.env.ZHIYA_SERVICES_ENV ?? "dev-services.env"),
      "utf8",
    ),
  );
  const mailpit =
    "http://" + (process.env.MAILPIT_HTTP_BIND ?? services.MAILPIT_HTTP_BIND);
  let code = "";
  await expect
    .poll(async () => {
      const inbox = await (
        await request.get(mailpit + "/api/v1/messages")
      ).json();
      const message = inbox.messages.find((m: { To: { Address: string }[] }) =>
        m.To.some((t) => t.Address === email),
      );
      if (!message) return false;
      const detail = await (
        await request.get(mailpit + "/api/v1/message/" + message.ID)
      ).json();
      code = detail.Text.match(/验证码：(\d{8})/)?.[1] ?? "";
      return !!code;
    })
    .toBeTruthy();
  const password = "Onboarding-password-123";
  expect(
    (
      await context.request.post("/api/auth/register/complete", {
        headers,
        data: { flow, code, password },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await context.request.post("/api/auth/login", {
        headers,
        data: { email, password },
      })
    ).ok(),
  ).toBeTruthy();
  let textOnlyCorrection = true;
  let correctionCall = 0;
  let holdCorrection = false;
  let releaseCorrection: () => void = () => {};
  const heldCorrection = new Promise<void>((resolve) => {
    releaseCorrection = resolve;
  });
  await context.route("**/api/learning/model", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { id: "gpt-5.6-luna", available: true } });
      return;
    }
    const payload = route.request().postDataJSON().payload;
    const correctionIndex = payload.messages.findLastIndex(
      (m: { role: string; content: unknown }) =>
        m.role === "user" &&
        JSON.stringify(m.content).includes("我现在更喜欢自己尝试"),
    );
    if (correctionIndex >= 0) {
      if (
        payload.tool_choice !== undefined &&
        payload.tool_choice !== "auto" &&
        payload.thinking?.type !== "disabled"
      ) {
        await route.fulfill({
          status: 400,
          json: {
            error: {
              message: "Thinking mode does not support this tool_choice",
              type: "invalid_request_error",
            },
          },
        });
        return;
      }
      correctionCall++;
      if (holdCorrection) {
        holdCorrection = false;
        await heldCorrection;
      }
      if (textOnlyCorrection) {
        textOnlyCorrection = false;
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ id: "text-only", object: "chat.completion.chunk", created: 1, model: "gpt-5.6-luna", choices: [{ index: 0, delta: { role: "assistant", content: "我已经了解了，档案修改好了。" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "text-only", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        });
        return;
      }
      const correctionResults = payload.messages
        .slice(correctionIndex)
        .filter((m: { role: string }) => m.role === "tool").length;
      const updated = correctionResults >= 3;
      const chunk = {
        id: "correction",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-5.6-luna",
        choices: [
          {
            index: 0,
            delta: updated
              ? { role: "assistant", content: "学习档案已更新。" }
              : {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id:
                        correctionResults < 2
                          ? `q-correction-${correctionCall}`
                          : `memory-correction-${correctionCall}`,
                      type: "function",
                      function: {
                        name:
                          correctionResults < 2
                            ? "ask_student"
                            : "update_memory",
                        arguments: JSON.stringify(
                          correctionResults < 2
                            ? {
                                text:
                                  correctionResults === 0
                                    ? "遇到困难时，你想怎么继续？"
                                    : "你希望提示是什么样的？",
                                kind: "single",
                                options: ["给我一点提示", "先自己想想"],
                              }
                            : {
                                content: "学生现在更喜欢自己尝试。",
                                version: 1,
                              },
                        ),
                      },
                    },
                  ],
                },
            finish_reason: null,
          },
        ],
      };
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: updated ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
      });
      return;
    }
    const results = payload.messages.filter(
      (m: { role: string }) => m.role === "tool",
    );
    const calls = [
      {
        id: "q-first",
        name: "ask_student",
        arguments: JSON.stringify({
          text: "你以前用过 Scratch 吗？",
          kind: "single",
          options: ["用过", "还没用过"],
        }),
      },
      {
        id: "memory-first",
        name: "update_memory",
        arguments: JSON.stringify({
          content: "学生自述用过 Scratch。",
          version: 0,
        }),
      },
      { id: "complete-first", name: "complete_onboarding", arguments: "{}" },
    ];
    const call = calls[results.length];
    const delta = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            },
          ],
        }
      : { role: "assistant", content: "我们开始慢慢探索吧。" };
    const chunk = {
      id: "mock-completion",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-5.6-luna",
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    const end = {
      ...chunk,
      choices: [
        { index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎来到知芽" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你以前用过 Scratch 吗？" }),
  ).toBeVisible();
  const other = await context.newPage();
  const renderingErrors: string[] = [];
  other.on("pageerror", (error) => renderingErrors.push(error.message));
  await other.setViewportSize({ width: 390, height: 844 });
  await other.goto("/");
  await expect(
    other.getByRole("heading", { name: "你以前用过 Scratch 吗？" }),
  ).toBeVisible();
  expect(
    await other.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await other.screenshot({
    path: "test-results/onboarding-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.screenshot({
    path: "test-results/onboarding-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await other.reload();
  await expect(
    other.getByRole("heading", { name: "你以前用过 Scratch 吗？" }),
  ).toBeVisible();
  await other.getByRole("radio", { name: "用过", exact: true }).check();
  await other.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    other.getByRole("heading", { name: "今天想学什么？" }),
  ).toBeVisible();
  await other.getByRole("button", { name: "用户菜单" }).click();
  await other.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(
    other.getByText("学生自述用过 Scratch。", { exact: true }),
  ).toBeVisible();
  const editor = other.getByRole("region", { name: "学习档案" });
  await editor
    .getByRole("textbox", { name: "修改或忘记" })
    .fill("我现在更喜欢自己尝试");
  await editor.getByRole("button", { name: "提交修改" }).click();
  await expect(editor).not.toBeVisible();
  await expect(other.getByRole("status", { name: "正在思考" })).toContainText(
    /正在整理你的学习档案… · \d+ 秒/,
  );
  await expect(other.getByRole("alert")).toContainText("尚未完成");
  await expect(
    other.getByText("我已经了解了，档案修改好了。", { exact: true }),
  ).not.toBeVisible();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect(editor).not.toBeVisible();
  await other.getByRole("button", { name: "停止对话", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "修改或忘记" })
    .fill("我现在更喜欢自己尝试");
  await editor.getByRole("button", { name: "提交修改" }).click();
  await expect(
    other.getByRole("heading", { name: "遇到困难时，你想怎么继续？" }),
  ).toBeVisible();
  await expect(editor).not.toBeVisible();
  holdCorrection = true;
  await other.getByRole("radio", { name: "给我一点提示", exact: true }).check();
  const generating = other.waitForRequest(
    (request) =>
      request.url().endsWith("/api/learning/model") &&
      request.method() === "POST",
  );
  await other.getByRole("button", { name: "提交回答", exact: true }).click();
  await generating;
  await expect(other.getByRole("status", { name: "正在思考" })).toContainText(
    /正在整理你的学习档案… · \d+ 秒/,
  );
  const canceled = other.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/learning/model"),
  });
  await other.screenshot({
    path: "test-results/correction-end-mobile.png",
    animations: "disabled",
  });
  await other.getByRole("button", { name: "停止对话", exact: true }).click();
  releaseCorrection();
  await canceled;
  await expect(editor).toBeVisible();
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect(other.getByRole("button", { name: "继续交流" })).toHaveCount(0);
  await other.reload();
  await other.getByRole("button", { name: "用户菜单" }).click();
  await other.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "修改或忘记" })).toBeEmpty();
  await editor
    .getByRole("textbox", { name: "修改或忘记" })
    .fill("我现在更喜欢自己尝试");
  await editor.getByRole("button", { name: "提交修改" }).click();
  await expect(
    other.getByRole("heading", { name: "遇到困难时，你想怎么继续？" }),
  ).toBeVisible();
  await other.getByRole("radio", { name: "给我一点提示", exact: true }).check();
  await other.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(
    other.getByRole("heading", { name: "你希望提示是什么样的？" }),
  ).toBeVisible();
  await expect(editor).not.toBeVisible();
  await other.getByRole("radio", { name: "给我一点提示", exact: true }).check();
  await other.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(other.getByRole("heading", { name: "档案已更新" })).toBeVisible({
    // Reload can leave the previous runner's 45-second lease until it expires.
    timeout: 60000,
  });
  await expect(editor).not.toBeVisible();
  await other.getByRole("button", { name: "查看档案", exact: true }).click();
  await expect(editor).toContainText("学生现在更喜欢自己尝试。");
  await expect(editor.getByRole("textbox", { name: "修改或忘记" })).toBeEmpty();
  expect(renderingErrors).toEqual([]);
  await other.close();
});

test("a student answers one concrete question and sees the overview when the agent finishes", async ({
  page,
}) => {
  let completed = false;
  const state = () => ({
    id: "00000000-0000-4000-8000-000000000001",
    purpose: "onboarding",
    messages: [],
    completed,
    memory: "喜欢先看一个例子，再自己试试。",
    memoryVersion: 1,
    messageSequence: 0,
    revision: completed ? 1 : 0,
    status: completed ? "idle" : "waiting",
    leaseUntil: "2099-01-01T00:00:00Z",
    question: completed
      ? null
      : {
          id: "question-1",
          text: "学一个新东西时，你想先试哪一种？",
          kind: "single",
          options: ["看一个例子", "自己试一试"],
        },
  });
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
  await mockLearning(page, state, (action) => {
    expect(action.action).toBe("answer");
    expect((action.answer as { selected: string[] }).selected).toEqual([
      "看一个例子",
    ]);
    completed = true;
    return { state: state() };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "学一个新东西时，你想先试哪一种？" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交回答", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "看一个例子" }).check();
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(
    page.getByText("喜欢先看一个例子，再自己试试。", { exact: true }),
  ).toBeVisible();
});
