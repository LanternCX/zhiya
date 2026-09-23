import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLearning } from "./mock-learning";

const chunk = (delta: object, finishReason: string | null = null) =>
  `data: ${JSON.stringify({
    id: crypto.randomUUID(),
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;

const toolResponse = (id: string, name: string, args: object) => ({
  contentType: "text/event-stream",
  body:
    chunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }) +
    chunk({}, "tool_calls") +
    "data: [DONE]\n\n",
});

const textResponse = (text: string) => ({
  contentType: "text/event-stream",
  body:
    chunk({ role: "assistant", content: text }) +
    chunk({}, "stop") +
    "data: [DONE]\n\n",
});

async function mockWorkspace(page: Page) {
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
  await mockLearning(page, () => ({
    id: "completed-session",
    purpose: "onboarding",
    messages: [],
    completed: true,
    correctionEnded: false,
    memory: "",
    memoryVersion: 0,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
    question: null,
  }));
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { id: "test-model", available: true } }),
  );
  await page.route("**/api/courses/*/outline-reorganization", (route) =>
    route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
  );
}

test("a generated teaching illustration stays hidden until the teacher presents it", async ({
  page,
}) => {
  await mockWorkspace(page);
  const emptyState = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const course = {
    id: "nature-course",
    conversationId: "nature-conversation",
    title: "自然科学",
    topic: "观察自然现象",
    status: "active",
    cover: { motif: "nature", palette: "ocean", label: "SCIENCE" },
    state: emptyState,
    sections: [
      {
        id: "water-section",
        title: "水循环",
        objective: "理解水在自然界中的循环",
        position: 0,
        status: "active",
        conversations: [
          {
            id: "nature-conversation",
            sectionId: "water-section",
            title: "水循环课堂",
            state: emptyState,
            createdAt: "2026-09-23T08:00:00Z",
            updatedAt: "2026-09-23T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-23T08:00:00Z",
    updatedAt: "2026-09-23T08:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [course] } }),
  );
  await page.route("**/api/courses/nature-course/conversation", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route(
    "**/api/courses/nature-course/image-generations",
    (route) =>
      route.fulfill({
        status: 202,
        json: {
          generation: {
            id: "water-image-task",
            pageId: "water-image",
            title: "水循环",
            alt: "云、雨、河流和海洋组成的水循环场景",
            status: "running",
          },
        },
      }),
  );
  await page.route(
    "**/api/courses/nature-course/image-generations/water-image-task",
    (route) =>
      route.fulfill({
        json: {
          generation: {
            id: "water-image-task",
            pageId: "water-image",
            title: "水循环",
            alt: "云、雨、河流和海洋组成的水循环场景",
            status: "complete",
            assetId: "water-image-task",
          },
        },
      }),
  );
  await page.route(
    "**/api/courses/nature-course/illustrations/water-image-task/download",
    (route) =>
      route.fulfill({
        json: { url: "https://storage.test/illustrations/water.png" },
      }),
  );
  await page.route("https://storage.test/illustrations/water.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKAAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    if (transcript.includes("现在展示插图")) {
      await route.fulfill(
        transcript.includes('"name":"show_lesson_page"')
          ? textResponse("我们来看这幅水循环图。")
          : toolResponse("show-water-image", "show_lesson_page", {
              pageId: "water-image",
            }),
      );
      return;
    }
    await route.fulfill(
      transcript.includes('"name":"create_illustration"')
        ? textResponse("插图正在后台绘制。")
        : toolResponse("create-water-image", "create_illustration", {
            pageId: "water-image",
            title: "水循环",
            description: "云朵降雨汇入河流和海洋，阳光让水蒸发回到云层",
            alt: "云、雨、河流和海洋组成的水循环场景",
          }),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：自然科学" }).click();
  await page.getByRole("button", { name: "打开小节：水循环" }).click();
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("画一幅水循环插图");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("插图正在后台绘制。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);

  await prompt.fill("现在展示插图");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByRole("img", {
      name: "云、雨、河流和海洋组成的水循环场景",
    }),
  ).toBeVisible();
});
