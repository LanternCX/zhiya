import { test, expect } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

test("knowledge search history and source citations survive reopening on desktop and mobile", async ({
  page,
}, testInfo) => {
  await completedOnboarding(page);
  const version = "a".repeat(64),
    blockId = "doc-page-2";
  const citation = `[训练数据教材](#knowledge/${version}/${blockId})`;
  const source = {
    version,
    blockId,
    documentId: "doc",
    title: "训练数据教材",
    modality: "image",
    location: { page: 2 },
    text: "训练数据是供模型学习的样本。",
    warnings: [],
    citation,
    score: 0.9,
    hasAsset: false,
  };
  const state = {
    messages: [
      {
        id: 1,
        role: "assistant",
        text: `模型从训练样本学习。${citation}`,
        knowledgeSearches: [
          {
            id: "search",
            query: "什么是训练数据",
            status: "complete",
            sources: [source],
          },
        ],
      },
    ],
    pages: [],
    presentations: [],
    currentPresentationId: "",
  };
  const conversation = {
    id: "knowledge-chat",
    sectionId: "section",
    title: "训练数据",
    state,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
  };
  const course = {
    id: "knowledge-course",
    conversationId: conversation.id,
    title: "知识库引用",
    topic: "训练数据",
    status: "active",
    cover: { motif: "code", palette: "sprout", label: "学习" },
    state,
    sections: [
      {
        id: "section",
        title: "训练数据",
        objective: "认识训练数据",
        position: 0,
        status: "active",
        conversations: [conversation],
      },
    ],
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
  await page.route("**/api/account-rules", (route) =>
    route.fulfill({
      json: {
        password_min_characters: 8,
        password_max_bytes: 256,
        nickname_max_characters: 40,
        avatar_max_bytes: 2097152,
        avatar_max_dimension: 2048,
        verification_code_digits: 8,
        verification_ttl_seconds: 60,
      },
    }),
  );
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
    route.fulfill({ json: { courses: [course] } }),
  );
  await page.route(`**/api/knowledge/${version}/blocks/${blockId}`, (route) =>
    route.fulfill({ json: source }),
  );
  await page.route(
    `**/api/knowledge/${version}/blocks/${blockId}/original`,
    (route) =>
      route.fulfill({ json: { url: "https://example.com/source.pdf" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：知识库引用" }).click();
  await page.getByRole("button", { name: "打开小节：训练数据" }).click();
  await page.getByRole("button", { name: /已搜索.*知识库/ }).click();
  await expect(page.getByText("什么是训练数据", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "查看引用：训练数据教材" })
    .last()
    .click();
  const panel = page.getByRole("dialog", { name: "知识库引用" });
  await expect(panel).toContainText("训练数据是供模型学习的样本");
  await expect(panel).toContainText("第 2 页");
  await expect(panel).not.toContainText("未审核");
  await expect(panel).not.toContainText("已审核");
  await page.screenshot({ path: testInfo.outputPath("knowledge-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("knowledge-mobile.png") });
});
