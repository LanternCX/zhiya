import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type { CourseConversationState } from "../../../packages/learning/src/domain/learning";

test("video pages restore, use the official player, and unload when leaving the page or classroom", async ({ page }) => {
  await completedOnboarding(page);
  await page.route("**/api/me", route => route.fulfill({ json: { id: "student", nickname: "小芽", email: "student@example.com", avatar: "" } }));
  await page.route("**/api/learning/model", route => route.fulfill({ json: { id: "test-model", available: true } }));
  await page.route("https://player.bilibili.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<button>播放视频</button>" }));
  const state: CourseConversationState = {
    messages: [],
    pages: [
      { kind: "video", id: "video", bvid: "BV1B7411m7LV", title: "机器学习入门", description: "通过实例认识机器学习", author: "老师", duration: "9:50", playCount: 12345, publishedAt: 1584949882, topic: "机器学习" },
      { kind: "question", id: "summary", title: "回顾", text: "机器从什么中学习？", questionKind: "single", options: ["数据", "石头"], selected: [], answerText: "", status: "active" },
    ],
    presentations: [{ id: "show-video", pageId: "video" }, { id: "show-summary", pageId: "summary" }],
    currentPresentationId: "show-video",
  };
  const conversation = { id: "lesson", sectionId: "section", title: "视频课堂", state, createdAt: "2026-10-04", updatedAt: "2026-10-04" };
  const course = {
    id: "course", conversationId: "lesson", title: "人工智能", topic: "机器学习", status: "active",
    cover: { motif: "orbit", palette: "sprout", label: "AI" }, state,
    sections: [{ id: "section", title: "机器学习", objective: "认识机器学习", position: 0, status: "active", conversations: [conversation] }],
    createdAt: "2026-10-04", updatedAt: "2026-10-04",
  };
  await page.route("**/api/courses", route => route.fulfill({ json: { courses: [course] } }));
  await page.route("**/api/courses/course/outline-reorganization", route => route.fulfill({ status: 404, json: { error: "没有待处理任务" } }));
  await page.route("**/api/courses/course/conversation", route => {
    course.state = route.request().postDataJSON().state;
    conversation.state = course.state;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#/courses/course/conversations/lesson");
  const player = page.locator('iframe[title="B站视频：机器学习入门"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("src", "https://player.bilibili.com/player.html?bvid=BV1B7411m7LV&autoplay=0&danmaku=0");
  await expect(page.frameLocator('iframe[title="B站视频：机器学习入门"]').getByRole("button", { name: "播放视频" })).toBeVisible();
  await expect(page.getByRole("link", { name: "在B站打开" })).toHaveAttribute("href", "https://www.bilibili.com/video/BV1B7411m7LV");
  await page.screenshot({ path: test.info().outputPath("video-desktop.png"), animations: "disabled" });
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await expect(player).toHaveCount(0);
  await page.getByRole("button", { name: "课堂展示", exact: true }).click();
  await expect(player).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(player).toHaveCount(0);
  await expect(page.getByText("机器从什么中学习？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(player).toBeVisible();
  let turns = 0;
  await page.route("**/api/learning/course/model", route => {
    const call = turns++ === 0;
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: "show-again", type: "function", function: { name: "show_lesson_page", arguments: JSON.stringify({ pageId: "video" }) } }] }
      : { role: "assistant", content: "视频已展示。" };
    const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return route.fulfill({ contentType: "text/event-stream", body: chunk(delta, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n" });
  });
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await expect(player).toHaveCount(0);
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("再看一次这个视频");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(player).toBeVisible();
  await page.reload();
  await expect(player).toBeVisible();
  await page.evaluate(() => { location.hash = "/account/profile"; });
  await expect(player).toHaveCount(0);
  await page.goto("/#/courses/course/conversations/lesson");
  await expect(player).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await player.scrollIntoViewIfNeeded();
  await expect(player).toBeVisible();
  const box = await player.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  const article = await page.getByRole("article", { name: "机器学习入门" }).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(article!.y - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(article!.y + article!.height + 1);
  await page.screenshot({ path: test.info().outputPath("video-mobile.png"), animations: "disabled" });
});
