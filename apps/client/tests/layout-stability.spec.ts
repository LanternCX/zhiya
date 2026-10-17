import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

for (const width of [1440, 960, 768, 390, 320]) {
  test(`field validation preserves the following controls (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await completedOnboarding(page);
    await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
    await page.goto("/");
    const email = page.getByLabel("邮箱", { exact: true });
    const password = page.getByLabel("密码", { exact: true });
    await email.fill("learner@");
    const before = await password.boundingBox();
    await email.press("Tab");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    expect(await password.boundingBox()).toEqual(before);
    await email.fill("learner@example.com");
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(await password.boundingBox()).toEqual(before);
  });
}

for (const width of [1440, 390]) {
  test(`a failed sign-in keeps the form in place (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await completedOnboarding(page);
    await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
    await page.route("**/api/auth/login", route => route.fulfill({ status: 503, json: { error: "服务暂时不可用，请稍后重试" } }));
    await page.goto("/");
    const email = page.getByLabel("邮箱", { exact: true });
    await email.fill("student@example.com");
    await page.getByLabel("密码", { exact: true }).fill("my-password");
    const before = await email.boundingBox();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toBeFocused();
    expect(await email.boundingBox()).toEqual(before);
  });
}

test("a draft remains readable when the workspace becomes narrower", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await completedOnboarding(page);
  await page.route("**/api/learning/model", route => route.fulfill({ json: { available: true, id: "test" } }));
  await page.route("**/api/me", route => route.fulfill({ json: {
    id: "student", nickname: "小芽", email: "student@example.com", avatar: "",
  } }));
  await page.route("**/api/courses", route => route.fulfill({ json: { courses: [] } }));
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await input.fill("我想了解人工智能怎样从例子中学习并尝试一个小实验");
  const wide = await input.boundingBox();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => input.evaluate(element => element.clientHeight)).toBeGreaterThan(wide!.height);
  expect(await input.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(wide!.height);
  let previous = 0;
  for (let length = 1; length <= 65; length++) {
    await input.fill("学习".repeat(33).slice(0, length));
    await input.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const height = (await input.boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(previous);
    previous = height;
  }
});

test("hovering a course section does not reflow its title or adjacent sections", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await completedOnboarding(page);
  await page.route("**/api/me", route => route.fulfill({ json: {
    id: "student", nickname: "小芽", email: "student@example.com", avatar: "",
  } }));
  const sections = Array.from({ length: 12 }, (_, index) => ({
    id: `section-${index}`, title: "探索人工智能的学习方法与生活应用".repeat(3).slice(0, 18 + index),
    objective: "用生活中的例子理解学习过程", position: index, status: "planned", conversations: [],
  }));
  await page.route("**/api/courses", route => route.fulfill({ json: { courses: [{
    id: "course", title: "人工智能", topic: "AI", status: "active",
    cover: { motif: "orbit", palette: "sprout", label: "AI" },
    sections, conversationId: "", state: { messages: [], pages: [], presentations: [], currentPresentationId: "" },
    createdAt: "2026-10-01", updatedAt: "2026-10-01",
  }] } }));
  await page.goto("/#/courses/course");
  for (const section of sections) {
    const button = page.getByRole("button", { name: `打开小节：${section.title}`, exact: true });
    await page.mouse.move(0, 0);
    const before = await button.boundingBox();
    await button.hover();
    expect((await button.boundingBox())!.height).toBe(before!.height);
  }
});

for (const fails of [false, true]) {
  test(`a shared picture preserves the following reading position (fails=${fails})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let release!: () => void;
    const response = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/shares/layout/images/picture", async route => {
      await response;
      if (fails) await route.abort();
      else await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="green"/></svg>' });
    });
    await page.route("**/api/shares/layout", route => route.fulfill({ json: { deliverable: {
      id: "document", title: "学习笔记", kind: "document", revision: 1, updatedAt: "2026-10-01",
      blocks: [
        { id: "one", title: "示意图", markdown: "看图理解", imageIds: ["picture"] },
        { id: "two", title: "接着阅读", markdown: "图片加载不应推走这里的内容", imageIds: [] },
      ],
    } } }));
    await page.goto("/#/shares/layout");
    const following = page.getByRole("heading", { name: "接着阅读", exact: true });
    await expect(following).toBeVisible();
    const position = () => following.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
    const before = await position();
    release();
    if (fails) await expect(page.getByRole("alert")).toBeVisible();
    else await expect.poll(() => page.getByRole("img", { name: "示意图" }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1200);
    expect(await position()).toBe(before);
  });
}
