import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

const learner = {
  id: "learner",
  email: "learner@example.com",
  nickname: "小芽",
  avatar: "",
};

test("a saved conversation opens directly and returns through its course without creating data", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: learner }));
  const state = {
    messages: [
      { id: "answer", role: "assistant", text: "这是上次保存的讲解。" },
    ],
    pages: [],
    presentations: [],
    currentPresentationId: "",
  };
  const conversation = {
    id: "chat-1",
    title: "第一次学习",
    state,
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  const course = {
    id: "course-1",
    title: "认识人工智能",
    topic: "人工智能",
    conversationId: "chat-1",
    state,
    cover: { motif: "orbit", palette: "sprout", label: "AI" },
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
    sections: [
      {
        id: "section-1",
        title: "什么是人工智能",
        objective: "认识人工智能",
        status: "active",
        conversations: [conversation],
      },
    ],
  };
  const writes: string[] = [];
  await page.route("**/api/courses**", (route) => {
    if (route.request().method() !== "GET")
      writes.push(route.request().method());
    return route.fulfill({
      json: route.request().url().endsWith("/materials")
        ? { materials: [] }
        : { courses: [course] },
    });
  });
  await page.goto("/#/courses/course-1/conversations/chat-1");
  await expect(
    page.getByText("这是上次保存的讲解。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("这是上次保存的讲解。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回课程", exact: true }).click();
  await expect(page).toHaveURL(/#\/courses\/course-1$/);
  await expect(
    page.getByRole("heading", { name: "认识人工智能", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText("这是上次保存的讲解。", { exact: true }),
  ).toBeVisible();
  expect(writes.filter((method) => method === "POST")).toEqual([]);
  await page.goto("/#/courses/course-1/conversations/missing");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "学习对话不存在或无法访问" }),
  ).toBeVisible();
  await expect(
    page.getByText("这是上次保存的讲解。", { exact: true }),
  ).toHaveCount(0);
});

test("workspace navigation survives reload and history protects unsaved profile edits", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: learner }));
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  await page.goto("/#/explore");
  await expect(
    page.getByRole("heading", { name: "探索即将开放" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI 实验室" }).click();
  await expect(page).toHaveURL(/#\/lab$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "实验准备中" })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "探索即将开放" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await page.getByLabel("昵称", { exact: true }).fill("还没保存");
  await page.goBack();
  const dialog = page.getByRole("dialog", { name: "放弃未保存的修改？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "用户菜单" })).toBeFocused();
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "还没保存",
  );
  await page.goBack();
  await dialog.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "探索即将开放" }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("小芽");
});

test("authentication pages support direct entry, reload and history navigation", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "请登录" } }),
  );
  await page.goto("/#/register");
  await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
  await page.getByRole("button", { name: "返回登录" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
});

test("missing pages and conversations provide a way back to learning", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: learner }));
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  await page.goto("/#/courses/deleted/conversations/missing");
  await expect(
    page.getByRole("heading", { name: "课程不存在或无法访问" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回学习", exact: true }).click();
  await expect(page).toHaveURL(/#\/learn$/);
  await page.goto("/#/unknown");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
});

test("login returns to the requested page", async ({ page }) => {
  await completedOnboarding(page);
  let signedIn = false;
  await page.route("**/api/me", (route) =>
    route.fulfill(
      signedIn ? { json: learner } : { status: 401, json: { error: "请登录" } },
    ),
  );
  await page.route("**/api/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  await page.goto("/#/lab");
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await page.getByLabel("邮箱", { exact: true }).fill(learner.email);
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/#\/lab$/);
  await expect(page.getByRole("heading", { name: "实验准备中" })).toBeVisible();
});
