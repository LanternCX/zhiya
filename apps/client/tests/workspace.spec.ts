import { expect, test } from "@playwright/test";
import { mockLearning } from "./mock-learning";

for (const stage of ["welcome", "question"] as const) {
  test(`onboarding ${stage} can be canceled or exited to login, never to the workspace`, async ({
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
    const state = {
      id: "session",
      purpose: "onboarding",
      messages: [],
      completed: false,
      memory: "",
      memoryVersion: 0,
      messageSequence: 0,
      revision: 0,
      status: stage === "welcome" ? "idle" : "waiting",
      leaseUntil: "",
      question:
        stage === "welcome"
          ? null
          : {
              id: "q",
              text: "你想先学什么？",
              kind: "single",
              options: ["编程", "AI"],
            },
    };
    await page.route("**/api/learning/model", (route) =>
      route.fulfill({ json: { available: false } }),
    );
    await mockLearning(page, () => state);
    let failLogout = true;
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill(
        failLogout
          ? {
              status: 503,
              headers: { "X-Request-ID": "logout-request-id" },
              json: { error: "暂时无法退出，请重试" },
            }
          : { json: { ok: true } },
      ),
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: stage === "welcome" ? "欢迎来到知芽" : "你想先学什么？",
      }),
    ).toBeVisible();
    const exit = page.getByRole("button", { name: "退出建档" });
    await exit.click();
    const dialog = page.getByRole("dialog", { name: "退出登录？" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(exit).toBeFocused();
    await exit.click();
    await dialog.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "暂时无法退出，请重试（错误编号：logout-request-id）",
    );
    await expect(exit).toBeVisible();
    failLogout = false;
    await exit.click();
    await dialog.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(
      0,
    );
  });
}

test("mobile destinations show honest empty states and account pages can open the learning profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  const state = {
    id: "session",
    purpose: "onboarding",
    messages: [],
    completed: true,
    memory: "喜欢动手尝试",
    memoryVersion: 1,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
    question: null,
  };
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { available: false } }),
  );
  await mockLearning(page, () => state);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible();
  await page.getByRole("button", { name: "自由探索" }).click();
  await expect(
    page.getByRole("heading", { name: "探索即将开放" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI 实验室" }).click();
  await expect(page.getByRole("heading", { name: "实验准备中" })).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(page.getByRole("region", { name: "学习档案" })).toContainText(
    "喜欢动手尝试",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "返回学习", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible();
});

test("learning and profile pages share a quiet themed background", async ({
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
  const state = {
    id: "session",
    purpose: "onboarding",
    messages: [],
    completed: true,
    memory: "喜欢动手尝试",
    memoryVersion: 1,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
    question: null,
  };
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { available: false } }),
  );
  await mockLearning(page, () => state);
  await page.goto("/");

  const workspace = page.locator(".workspace-body");
  const background = async () =>
    workspace.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        image: style.backgroundImage,
        color: style.backgroundColor,
      };
    });

  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible();
  expect(await background()).toMatchObject({ color: "rgb(248, 250, 228)" });
  expect((await background()).image).toBe("none");

  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "学习档案", exact: true }).click();
  await expect(page.getByRole("region", { name: "学习档案" })).toBeVisible();
  expect(await background()).toMatchObject({ color: "rgb(248, 250, 228)" });
  expect((await background()).image).toBe("none");

  await page.getByRole("button", { name: "用户菜单" }).click();
  await page
    .getByRole("button", { name: "当前为自动主题，切换至浅色主题" })
    .click();
  await page
    .getByRole("button", { name: "当前为浅色主题，切换至深色主题" })
    .click();
  await expect(workspace).toHaveCSS("background-color", "rgb(30, 30, 30)");
  expect((await background()).image).toBe("none");
});

test("onboarding blocks navigation until completion, including reload and waiting", async ({
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
  let completed = false;
  let waiting = false;
  let attempts = 0;
  const state = () => ({
    id: "session",
    purpose: "onboarding",
    messages: [],
    completed,
    memory: "喜欢动手尝试",
    memoryVersion: 1,
    messageSequence: 0,
    revision: completed ? 2 : waiting ? 1 : 0,
    status: waiting ? "running" : "waiting",
    leaseUntil: "2099-01-01T00:00:00Z",
    question:
      waiting || completed
        ? null
        : {
            id: "question",
            text: "你想怎样认识 AI？",
            kind: "single",
            options: ["看个例子", "自己试试"],
          },
  });
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { available: false } }),
  );
  const learning = await mockLearning(page, state, (action) => {
    attempts++;
    if (attempts === 1) throw new Error("暂时无法提交");
    waiting = true;
    return { state: state() };
  });
  await page.goto("/#/lab");
  await expect(
    page.getByRole("heading", { name: "你想怎样认识 AI？" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/onboarding\?returnTo=%2Flab$/);
  await expect(page.getByRole("button", { name: "用户菜单" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("radio", { name: "自己试试", exact: true }).check();
  await page.getByRole("radio", { name: "自己填写", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "自己试试", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("textbox", { name: "你的回答" }).fill("我用过 Scratch");
  await page.screenshot({
    path: "test-results/onboarding-fullscreen-desktop.png",
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByRole("button", { name: "提交回答" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/onboarding-fullscreen-${width}.png`,
    });
  }
  const answer = page.getByRole("textbox", { name: "你的回答" });
  await answer.dispatchEvent("compositionstart");
  await answer.press("Enter");
  await answer.dispatchEvent("compositionend");
  expect(attempts).toBe(0);
  await answer.fill("我用过 Scratch");
  await answer.press("Shift+Enter");
  await expect(answer).toHaveValue("我用过 Scratch\n");
  await answer.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(answer).toHaveValue("我用过 Scratch\n");
  await expect(
    page.getByRole("radio", { name: "自己填写", exact: true }),
  ).toBeChecked();
  await answer.press("Enter");
  await expect(page.getByRole("status", { name: "正在思考" })).toBeVisible();
  await expect(page.getByRole("button", { name: "用户菜单" })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .getByRole("status", { name: "正在思考" })
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.screenshot({ path: "test-results/onboarding-wait-dark.png" });
  completed = true;
  waiting = false;
  learning.sync(state());
  await expect(page.getByRole("heading", { name: "实验准备中" })).toBeVisible();
  await expect(page).toHaveURL(/#\/lab$/);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("button", { name: "用户菜单" })).toBeVisible();
});
