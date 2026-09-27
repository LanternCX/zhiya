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

const toolResponses = (
  calls: Array<{ id: string; name: string; args: object }>,
) => ({
  contentType: "text/event-stream",
  body:
    chunk({
      role: "assistant",
      tool_calls: calls.map((call, index) => ({
        index,
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
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
    presentations: [],
    currentPresentationId: "",
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
      if (transcript.includes('"name":"show_lesson_page"')) {
        await route.fulfill(textResponse("我们来看这幅水循环图。"));
      } else if (transcript.includes('"name":"read_lesson_pages"')) {
        await route.fulfill(
          toolResponse("show-water-image", "show_lesson_page", {
            pageId: "water-image",
          }),
        );
      } else {
        await route.fulfill(
          toolResponse("read-water-image", "read_lesson_pages", {}),
        );
      }
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

test("the teacher starts independent illustrations in parallel and keeps teaching", async ({
  page,
}) => {
  await mockWorkspace(page);
  const emptyState = {
    messages: [],
    pages: [],
    presentations: [],
    currentPresentationId: "",
  };
  const course = {
    id: "mixed-course",
    conversationId: "mixed-conversation",
    title: "多元素课堂",
    topic: "认识人工智能",
    status: "active",
    cover: { motif: "spark", palette: "ocean", label: "AI" },
    state: emptyState,
    sections: [
      {
        id: "story-section",
        title: "机器人故事",
        objective: "通过不同场景理解机器学习",
        position: 0,
        status: "active",
        conversations: [
          {
            id: "mixed-conversation",
            sectionId: "story-section",
            title: "机器人故事课堂",
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
  await page.route("**/api/courses/mixed-course/conversation", (route) =>
    route.fulfill({ json: { ok: true } }),
  );

  let submitted = 0;
  let releaseFirst: (() => void) | undefined;
  const secondSubmitted = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(
    "**/api/courses/mixed-course/image-generations",
    async (route) => {
      submitted += 1;
      const request = route.request().postDataJSON() as { pageId: string };
      if (submitted === 1) await secondSubmitted;
      else releaseFirst?.();
      await route.fulfill({
        status: 202,
        json: {
          generation: {
            id: `${request.pageId}-task`,
            pageId: request.pageId,
            title: request.pageId,
            alt: request.pageId,
            status: "running",
          },
        },
      });
    },
  );
  await page.route(
    "**/api/courses/mixed-course/image-generations/*",
    (route) =>
      route.fulfill({
        json: {
          generation: {
            id: "pending-task",
            pageId: "pending",
            title: "pending",
            alt: "pending",
            status: "running",
          },
        },
      }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      transcript.includes('"name":"create_illustration"')
        ? textResponse("我一边讲解，一边准备两个不同场景。")
        : toolResponses([
            {
              id: "draw-robot-garden",
              name: "create_illustration",
              args: {
                pageId: "robot-garden",
                title: "机器人观察花园",
                description: "机器人在花园里观察不同颜色的花朵",
                alt: "机器人观察花园中的花朵",
              },
            },
            {
              id: "draw-robot-shop",
              name: "create_illustration",
              args: {
                pageId: "robot-shop",
                title: "机器人整理水果",
                description: "同一个机器人在水果店把水果放进不同篮子",
                alt: "机器人在水果店整理水果",
              },
            },
          ]),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：多元素课堂" }).click();
  await page.getByRole("button", { name: "打开小节：机器人故事" }).click();
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill(
    "用两个不同场景边画边讲机器学习",
  );
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("我一边讲解，一边准备两个不同场景。", { exact: true }),
  ).toBeVisible();
  expect(submitted).toBe(2);
});

test("only pages actually taught enter the presentation history", async ({
  page,
}) => {
  await mockWorkspace(page);
  const bufferedPages = [
    {
      kind: "slide" as const,
      id: "pool-first",
      title: "缓冲池中的第一项",
      markdown: "# 缓冲池中的第一项\n\n生成得更早",
    },
    {
      kind: "slide" as const,
      id: "pool-second",
      title: "缓冲池中的第二项",
      markdown: "# 缓冲池中的第二项\n\n主 Agent 决定先展示",
    },
  ];
  const state = {
    messages: [],
    pages: bufferedPages,
    presentations: [],
    currentPresentationId: "",
  };
  const course = {
    id: "sequence-course",
    conversationId: "sequence-conversation",
    title: "页面编排",
    topic: "缓冲池与展示序列",
    status: "active",
    cover: { motif: "geometry", palette: "ocean", label: "ORDER" },
    state,
    sections: [
      {
        id: "sequence-section",
        title: "页面编排",
        objective: "按教学需要安排页面",
        position: 0,
        status: "active",
        conversations: [
          {
            id: "sequence-conversation",
            sectionId: "sequence-section",
            title: "页面编排课堂",
            state,
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
  await page.route("**/api/courses/sequence-course/conversation", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      payload: {
        messages: Array<{ role: string; content: unknown }>;
      };
    };
    const transcript = JSON.stringify(request.payload.messages);
    if (transcript.includes('"name":"show_lesson_page"')) {
      await route.fulfill(textResponse("我选择第二项开始讲解。"));
    } else if (transcript.includes('"name":"read_lesson_pages"')) {
      await route.fulfill(
        toolResponse("show-sequence-page", "show_lesson_page", {
          pageId: "pool-second",
        }),
      );
    } else {
      await route.fulfill(
        toolResponse("read-page-pool", "read_lesson_pages", {}),
      );
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：页面编排" }).click();
  await page.getByRole("button", { name: "打开小节：页面编排" }).click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("从第二项开始讲解");
  await page.getByRole("button", { name: "发送" }).click();

  const classroom = page.getByRole("region", { name: "课堂页面" });
  await expect(
    classroom.getByRole("img", { name: "课件页面：缓冲池中的第二项" }),
  ).toBeVisible();
  await expect(classroom.getByText("1 / 1", { exact: true })).toBeVisible();
  await expect(classroom.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(
    classroom.getByRole("img", { name: "课件页面：缓冲池中的第一项" }),
  ).toHaveCount(0);
});
