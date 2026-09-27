import { expect, test } from "@playwright/test";
import { mockLearning } from "./mock-learning";

for (const kind of ["multiple", "text", "skip"] as const) {
  test(`standard answer controls preserve ${kind} submission semantics`, async ({
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
    let completed = false;
    const state = () => ({
      id: "session",
      purpose: "onboarding",
      completed,
      messages: [],
      memory: "",
      memoryVersion: 0,
      messageSequence: 0,
      revision: completed ? 1 : 0,
      status: "waiting",
      leaseUntil: "",
      question: completed
        ? null
        : {
            id: "q",
            text: "你用过哪些工具？",
            kind: kind === "skip" ? "single" : kind,
            options: kind === "text" ? [] : ["Scratch", "Python"],
          },
    });
    await page.route("**/api/learning/model", (r) =>
      r.fulfill({ json: { available: false } }),
    );
    await mockLearning(page, state, (action) => {
      expect(action.answer).toEqual({
        selected: kind === "multiple" ? ["Scratch", "Python"] : [],
        text: kind === "text" ? "我用过 Scratch" : "",
        skipped: kind === "skip",
      });
      completed = true;
      return { state: state() };
    });
    await page.goto("/");
    if (kind === "multiple") {
      await page.getByRole("radio", { name: "自己填写", exact: true }).check();
      await page
        .getByRole("textbox", { name: "你的回答" })
        .fill("不应随选择一起发送");
      await page
        .getByRole("checkbox", { name: "Scratch", exact: true })
        .check();
      await page.getByRole("checkbox", { name: "Python", exact: true }).check();
      await expect(page.getByRole("textbox")).toHaveCount(0);
    } else if (kind === "text") {
      await page
        .getByRole("textbox", { name: "你的回答" })
        .fill("我用过 Scratch");
    } else {
      await page.getByRole("radio", { name: "还不确定", exact: true }).check();
    }
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今天想学什么？" }),
    ).toBeVisible();
  });
}

test("AI reasoning is shown only when returned, can be opened, and normal waiting has no empty disclosure", async ({
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
  let hasReasoning = false;
  let running = true;
  const state = () => ({
    id: "session",
    purpose: "onboarding",
    completed: false,
    question: null,
    memory: "",
    memoryVersion: 0,
    messageSequence: hasReasoning ? 1 : 0,
    revision: hasReasoning ? (running ? 1 : 2) : 0,
    status: running ? "running" : "idle",
    leaseUntil: "2099-01-01T00:00:00Z",
    messages: hasReasoning
      ? [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "先了解学习经验，再选择合适的起点。",
              },
              ...(!running
                ? [{ type: "text", text: "我们从**学习经验**聊起。" }]
                : []),
            ],
          },
        ]
      : [],
  });
  await page.route("**/api/learning/model", (r) =>
    r.fulfill({ json: { available: false } }),
  );
  const learning = await mockLearning(page, state);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "正在思考" })).toContainText(
    /正在了解你的学习方式… · \d+ 秒/,
  );
  await expect(page.getByRole("button", { name: /思考/ })).toHaveCount(0);
  hasReasoning = true;
  learning.sync(state());
  const streamingTrigger = page.getByRole("button", {
    name: /正在了解你的学习方式/,
  });
  await expect(streamingTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(streamingTrigger).toContainText(
    /正在了解你的学习方式… · \d+ 秒/,
  );
  const livePreview = streamingTrigger.locator(".reasoning-live-preview");
  await expect(livePreview).toHaveText("先了解学习经验，再选择合适的起点。");
  await expect(livePreview).toHaveCSS("white-space", "nowrap");
  await expect(livePreview).toHaveCSS("overflow-x", "hidden");
  const reasoningContent = streamingTrigger
    .locator("xpath=..")
    .locator('[data-slot="collapsible-content"]');
  await expect(reasoningContent).not.toBeVisible();
  running = false;
  await page.reload();
  const trigger = page.getByRole("button", { name: "思路已整理" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(
    trigger
      .locator("xpath=..")
      .locator('[data-slot="collapsible-content"]'),
  ).toContainText("先了解学习经验，再选择合适的起点。");
  await expect(page.getByText("我们从", { exact: false })).toContainText(
    "学习经验",
  );
  await expect(page.getByRole("button", { name: "退出建档" })).toBeVisible();
});
