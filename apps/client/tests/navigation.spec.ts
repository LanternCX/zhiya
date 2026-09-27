import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type { StoredCourse } from "../src/domain/learning";

function historyCourses(): StoredCourse[] {
  return ["甲", "乙"].map((name, courseIndex) => {
    const conversations = Array.from({ length: 11 }, (_, index) => ({
      id: `chat-${index + 1}`,
      sectionId: `section-${name}`,
      title: `第${index + 1}次学习`,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      state: {
        messages: [{ id: index + 1, role: "assistant" as const, text: `保存的第${index + 1}次讲解` }],
        pages: [], presentations: [], currentPresentationId: "",
      },
    })).filter((_, index) => index % 2 === courseIndex);
    return {
      id: `course-${name}`, title: `课程${name}`, topic: "AI", status: "active",
      cover: { motif: "orbit", palette: "sprout", label: "AI" },
      conversationId: conversations[0].id, state: conversations[0].state,
      createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-11T00:00:00Z",
      sections: [{ id: `section-${name}`, title: "认识 AI", objective: "认识 AI", position: 0, status: "active", conversations }],
    };
  });
}

test.beforeEach(async ({ page }) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    id: "learner", email: "learner@example.com", nickname: "小芽", avatar: "",
  } }));
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses: [] } }));
  await page.route("**/api/courses/*/conversation", (route) => route.fulfill({ json: { ok: true } }));
});

test("recent conversations span courses, open saved content and follow browser history", async ({ page }) => {
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses: historyCourses() } }));
  await page.goto("/#/learn");
  const recent = page.getByRole("navigation", { name: "最近对话" });
  const links = recent.getByRole("link");
  await expect(links).toHaveCount(10);
  await expect(links.first()).toContainText("第11次学习");
  await expect(links.nth(1)).toContainText("第10次学习");
  await expect(links.last()).toContainText("第2次学习");
  await expect(links.first()).toContainText("课程甲");
  await expect(links.nth(1)).toContainText("课程乙");
  await links.nth(1).click();
  await expect(page).toHaveURL(/conversations\/chat-10$/);
  await expect(page.getByText("保存的第10次讲解", { exact: true })).toBeVisible();
  await expect(links.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(links.first()).toContainText("第11次学习");
  await links.first().click();
  await expect(page.getByText("保存的第11次讲解", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("保存的第10次讲解", { exact: true })).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByText("保存的第11次讲解", { exact: true })).toBeVisible();
  await expect(links.first()).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(recent).toBeHidden();
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(links.first()).toBeVisible();
});

test("removed destinations are absent and their URLs no longer open a workspace feature", async ({ page }) => {
  await page.goto("/#/learn");
  await expect(page.getByRole("heading", { name: "今天想学什么？" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).not.toContainText(/探索|实验|回顾/);
  for (const path of ["explore", "lab", "review"]) {
    await page.goto(`/#/${path}`);
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
    await page.getByRole("button", { name: "返回学习", exact: true }).click();
    await expect(page).toHaveURL(/#\/learn$/);
  }
});

test("phone drawer opens recent conversations, traps focus and restores focus when dismissed", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses: historyCourses() } }));
  await page.goto("/#/learn");
  const trigger = page.getByRole("button", { name: "打开侧栏" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "学习导航" });
  await expect(drawer).toBeVisible();
  const recent = drawer.getByRole("navigation", { name: "最近对话" });
  await expect(recent.getByRole("link")).toHaveCount(10);
  await drawer.getByRole("button", { name: "关闭侧栏" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(recent.getByRole("link").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "关闭侧栏" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("mobile-sidebar.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await recent.getByRole("link").first().click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText("保存的第11次讲解", { exact: true })).toBeVisible();
  await trigger.click();
  await page.mouse.click(380, 400);
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("opening and leaving a saved conversation does not update its activity time", async ({ page }) => {
  const writes: string[] = [];
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses: historyCourses() } }));
  await page.route("**/api/courses/*/conversation", (route) => {
    writes.push(route.request().url());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#/learn");
  await page.getByRole("navigation", { name: "最近对话" }).getByRole("link").nth(1).click();
  await expect(page.getByText("保存的第10次讲解", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回课程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "课程乙", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("continuing an older conversation moves it to the top and persists the new order", async ({ page }) => {
  const courses = historyCourses();
  await page.route("**/api/learning/model", (route) => route.fulfill({ json: { available: true, id: "test-model" } }));
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses } }));
  await page.route("**/api/courses/*/materials", (route) => route.fulfill({ json: { materials: [] } }));
  await page.route("**/api/courses/*/outline-reorganization", (route) => route.fulfill({ status: 404, json: { error: "没有待处理任务" } }));
  let saved = false;
  await page.route("**/api/courses/*/conversation", (route) => {
    const { conversationId, state } = route.request().postDataJSON();
    const conversation = courses.flatMap((course) => course.sections!.flatMap((section) => section.conversations))
      .find((item) => item.id === conversationId)!;
    conversation.state = state;
    conversation.updatedAt = new Date().toISOString();
    saved = state.messages.some((message: { text: string }) => message.text === "我们继续学习。");
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/learning/course/model", (route) => {
    const chunk = (delta: object, finishReason: string | null = null) => `data: ${JSON.stringify({
      id: "reply", object: "chat.completion.chunk", created: 1, model: "test-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
    return route.fulfill({ contentType: "text/event-stream", body:
      chunk({ role: "assistant", content: "我们继续学习。" }) + chunk({}, "stop") + "data: [DONE]\n\n",
    });
  });
  await page.goto("/#/learn");
  const links = page.getByRole("navigation", { name: "最近对话" }).getByRole("link");
  await links.nth(1).click();
  await expect(page.getByText("保存的第10次讲解", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("接着讲吧");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("我们继续学习。", { exact: true })).toBeVisible();
  await expect(links.first()).toContainText("第10次学习");
  await expect.poll(() => saved).toBe(true);
  await page.reload();
  await expect(links.first()).toContainText("第10次学习");
  await expect(page.getByText("我们继续学习。", { exact: true })).toBeVisible();
});

test("recent conversations distinguish an empty history from a failed load", async ({ page }) => {
  await page.goto("/#/learn");
  const recent = page.getByRole("navigation", { name: "最近对话" });
  await expect(recent).toContainText("还没有学习对话");
  await page.route("**/api/courses", (route) => route.fulfill({ status: 503, json: { error: "暂时无法读取课程" } }));
  await page.reload();
  await expect(recent).toContainText("暂时无法读取对话");
  await expect(recent).not.toContainText("还没有学习对话");
});

for (const width of [320, 1440]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`recent conversations remain readable at ${width}px in ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const courses = historyCourses();
      courses[0].title = "人工智能与生活中的分类问题：从具体例子到动手实践";
      courses[0].sections![0].conversations.at(-1)!.title = "从认识训练数据开始，学习如何用具体的例子理解人工智能分类";
      await page.route("**/api/courses", (route) => route.fulfill({ json: { courses } }));
      await page.goto("/#/learn");
      if (width < 720) await page.getByRole("button", { name: "打开侧栏" }).click();
      const recent = page.getByRole("navigation", { name: "最近对话" });
      const first = recent.getByRole("link").first();
      await expect(first).toBeInViewport();
      await expect(first).toHaveAttribute("title", /从认识训练数据开始.*人工智能与生活/);
      const bounds = await first.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath("sidebar.png") });
      await recent.getByRole("link").last().scrollIntoViewIfNeeded();
      await expect(recent.getByRole("link").last()).toBeInViewport();
      if (width >= 720) await expect(page.getByRole("button", { name: "用户菜单" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
