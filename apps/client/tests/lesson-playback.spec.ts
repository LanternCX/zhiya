import { expect, test, type Page } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";
import type {
  CourseConversationState,
  LessonPage,
} from "../src/domain/learning";

function response(
  text: string,
  calls: Array<{ id: string; name: string; args: object }> = [],
) {
  const chunk = (delta: object, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "model-response", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return {
    contentType: "text/event-stream",
    body:
      chunk({
        role: "assistant",
        content: text,
        ...(calls.length
          ? {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              })),
            }
          : {}),
      }) +
      chunk({}, calls.length ? "tool_calls" : "stop") +
      "data: [DONE]\n\n",
  };
}

async function classroom(page: Page, pages: LessonPage[] = []) {
  await completedOnboarding(page);
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
    route.fulfill({ json: { id: "test-model", available: true } }),
  );
  const state: CourseConversationState = {
    messages: [],
    pages,
    presentations: [],
    currentPresentationId: "",
  };
  const conversation = {
    id: "lesson",
    sectionId: "section",
    title: "课堂",
    state,
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
  };
  const course = {
    id: "course",
    conversationId: "lesson",
    title: "编程课",
    topic: "编程",
    status: "active",
    cover: { motif: "orbit", palette: "sprout", label: "CODE" },
    state,
    sections: [
      {
        id: "section",
        title: "练习",
        objective: "理解程序",
        position: 0,
        status: "active",
        conversations: [conversation],
      },
    ],
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [course] } }),
  );
  await page.route("**/api/courses/course/outline-reorganization", (route) =>
    route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
  );
  await page.route("**/api/courses/course/conversation", (route) => {
    course.state = route.request().postDataJSON().state;
    conversation.state = course.state;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#/courses/course/conversations/lesson");
  return course;
}

test("slides resume the original lesson after the first page becomes ready", async ({
  page,
}) => {
  await classroom(page);
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let generationStarted = false;
  await page.route("**/api/learning/course/model", async (route) => {
    const request = route.request().postDataJSON();
    const transcript = JSON.stringify(request.payload.messages);
    if (request.agent === "slides") {
      if (
        request.payload.messages.some(
          (message: { role: string }) => message.role === "tool",
        )
      ) {
        await route.fulfill(response(""));
      } else {
        generationStarted = true;
        await ready;
        await route.fulfill(
          response("", [
            {
              id: "first-page",
              name: "publish_slide",
              args: {
                title: "变量",
                markdown: "# 变量\n变量保存数据",
              },
            },
          ]),
        );
      }
    } else if (!transcript.includes('"name":"create_slides"')) {
      await route.fulfill(
        response("", [
          {
            id: "prepare",
            name: "create_slides",
            args: { goal: "介绍变量", pageCount: 1, replaceCurrent: false },
          },
        ]),
      );
    } else if (!transcript.includes("变量保存数据")) {
      await route.fulfill(response("缺少页面，教学提前结束。"));
    } else if (!transcript.includes('"name":"show_lesson_page"')) {
      const result = request.payload.messages.findLast(
        (message: { role: string }) => message.role === "tool",
      );
      const data = JSON.parse(result.content);
      await route.fulfill(
        response("", [
          {
            id: "teach-first",
            name: "show_lesson_page",
            args: { pageId: data.page.id },
          },
        ]),
      );
    } else {
      await route.fulfill(response("变量可以保存一个数。"));
    }
  });
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("讲讲变量");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => generationStarted).toBe(true);
  release();
  await expect(page.getByRole("img", { name: "课件页面：变量" })).toBeVisible();
  await expect(
    page.getByText("变量可以保存一个数。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("缺少页面，教学提前结束。", { exact: true }),
  ).toHaveCount(0);
});

test("repeated teaching follows the lecture history and shares the coding state after reload", async ({
  page,
}) => {
  const course = await classroom(page, [
    {
      kind: "slide",
      id: "a",
      title: "讲述 A",
      markdown: "# 讲述 A\n变量保存数据",
    },
    {
      kind: "slide",
      id: "c",
      title: "讲述 C",
      markdown: "# 讲述 C\n输出变量",
    },
  ]);
  await page.route("**/api/code/runs", (route) =>
    route.fulfill({
      json: {
        stdout: "42\n",
        stderr: "",
        compileOutput: "",
        message: "",
        status: { description: "Completed" },
        time: "0.01",
        memory: 100,
      },
    }),
  );
  await page.route("**/api/learning/course/model", async (route) => {
    const transcript = JSON.stringify(
      route.request().postDataJSON().payload.messages,
    );
    if (!transcript.includes('"name":"show_coding_exercise"')) {
      await route.fulfill(
        response("", [
          {
            id: "exercise",
            name: "show_coding_exercise",
            args: {
              title: "编程 B",
              instructions: "输出一个数",
              languageId: 1,
              languageName: "Python",
              starterCode: "print(1)",
            },
          },
        ]),
      );
    } else if (!transcript.includes("继续讲解然后回到练习")) {
      await route.fulfill(response("第一次练习，先试着输出。"));
    } else if (!transcript.includes('"id":"teach-a"')) {
      await route.fulfill(
        response("", [
          { id: "teach-a", name: "show_lesson_page", args: { pageId: "a" } },
        ]),
      );
    } else if (!transcript.includes('"id":"teach-c"')) {
      await route.fulfill(
        response("这是讲述 A。", [
          { id: "teach-c", name: "show_lesson_page", args: { pageId: "c" } },
        ]),
      );
    } else if (!transcript.includes('"id":"return-b"')) {
      await route.fulfill(
        response("这是讲述 C。", [
          {
            id: "return-b",
            name: "show_lesson_page",
            args: { pageId: "exercise" },
          },
        ]),
      );
    } else {
      await route.fulfill(response("第二次练习，请继续修改刚才的代码。"));
    }
  });
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("开始练习");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("第一次练习，先试着输出。", { exact: true }),
  ).toBeVisible();
  await page.locator(".cm-content").fill("print(42)");
  await page.getByRole("button", { name: "运行代码", exact: true }).click();
  await expect(page.getByRole("region", { name: "运行结果" })).toContainText(
    "42",
  );
  await prompt.fill("继续讲解然后回到练习");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("第二次练习，请继续修改刚才的代码。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".slide-controls")).toContainText("4 / 4");
  await expect(page.locator(".cm-content")).toContainText("print(42)");
  await expect(page.getByRole("region", { name: "运行结果" })).toContainText(
    "42",
  );
  await expect(page.locator('.course-message[aria-current="step"]')).toHaveText(
    "知芽第二次练习，请继续修改刚才的代码。",
  );
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".slide-controls")).toContainText("1 / 4");
  await expect(page.locator('.course-message[aria-current="step"]')).toHaveText(
    "知芽第一次练习，先试着输出。",
  );
  await expect(page.locator(".cm-content")).toContainText("print(42)");
  await expect.poll(() => course.state.messages.length).toBeGreaterThan(3);
  await page.getByRole("button", { name: "返回课程", exact: true }).click();
  await page.goto("/#/courses/course/conversations/lesson");
  await expect(page.locator(".slide-controls")).toContainText("1 / 4");
  await expect(page.locator(".cm-content")).toContainText("print(42)");
  await expect(page.locator('.course-message[aria-current="step"]')).toHaveText(
    "知芽第一次练习，先试着输出。",
  );
});

test("a student interrupts a pending page and the remaining old tool batch cannot steal focus", async ({
  page,
}) => {
  const course = await classroom(page, [
    {
      kind: "slide",
      id: "stale",
      title: "过时安排",
      markdown: "# 过时安排\n不应切到这里",
    },
  ]);
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waitingForSecond = false;
  let secondPublished = false;
  await page.route("**/api/learning/course/model", async (route) => {
    const request = route.request().postDataJSON();
    const messages = request.payload.messages;
    const transcript = JSON.stringify(messages);
    if (request.agent === "slides") {
      const count = messages.filter(
        (message: { role: string }) => message.role === "tool",
      ).length;
      if (count > 1) {
        secondPublished = true;
        await route.fulfill(response(""));
        return;
      }
      if (count === 1) await pending;
      await route.fulfill(
        response("", [
          {
            id: `publish-${count}`,
            name: "publish_slide",
            args: {
              title: count ? "迟到的第二页" : "当前第一页",
              markdown: `# ${count ? "迟到的第二页" : "当前第一页"}\n课堂内容`,
            },
          },
        ]),
      );
      return;
    }
    if (transcript.includes("先回答我的问题")) {
      await route.fulfill(response("先回答你的问题，原来的切页已经停止。"));
    } else if (!transcript.includes('"name":"create_slides"')) {
      await route.fulfill(
        response("", [
          {
            id: "prepare",
            name: "create_slides",
            args: { goal: "两页内容", pageCount: 2, replaceCurrent: false },
          },
        ]),
      );
    } else {
      const prepared = messages.find(
        (message: { role: string; tool_call_id?: string }) =>
          message.role === "tool" && message.tool_call_id === "prepare",
      );
      const { pageIds } = JSON.parse(prepared.content);
      if (!transcript.includes('"id":"first"')) {
        await route.fulfill(
          response("", [
            {
              id: "first",
              name: "show_lesson_page",
              args: { pageId: pageIds[0] },
            },
          ]),
        );
      } else if (!transcript.includes('"id":"second"')) {
        waitingForSecond = true;
        await route.fulfill(
          response("第一页已经讲完。", [
            {
              id: "second",
              name: "show_lesson_page",
              args: { pageId: pageIds[1] },
            },
            {
              id: "obsolete",
              name: "show_lesson_page",
              args: { pageId: "stale" },
            },
          ]),
        );
      } else await route.fulfill(response("原安排继续。"));
    }
  });
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("开始讲两页");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => waitingForSecond).toBe(true);
  await expect(
    page.getByRole("img", { name: "课件页面：当前第一页" }),
  ).toBeVisible();
  await prompt.fill("先回答我的问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("先回答你的问题，原来的切页已经停止。", { exact: true }),
  ).toBeVisible();
  release();
  await expect.poll(() => secondPublished).toBe(true);
  await expect(page.locator(".slide-controls")).toContainText("1 / 1");
  await expect(
    page.getByRole("img", { name: "课件页面：当前第一页" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "课件页面：过时安排" }),
  ).toHaveCount(0);
  await expect.poll(() => course.state.presentations.length).toBe(1);
});

for (const outcome of ["complete", "failed", "stopped"] as const) {
  test(`a pending second page handles ${outcome} without losing the first presentation`, async ({
    page,
  }) => {
    const course = await classroom(page);
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondRequested = false;
    let oldResponseReleased = false;
    await page.route("**/api/learning/course/model", async (route) => {
      const request = route.request().postDataJSON();
      const messages = request.payload.messages;
      const transcript = JSON.stringify(messages);
      if (request.agent === "slides") {
        const count = messages.filter(
          (message: { role: string }) => message.role === "tool",
        ).length;
        const replacement = transcript.includes("新课件");
        if (count > (replacement ? 0 : 1)) {
          await route.fulfill(response(""));
          return;
        }
        if (count === 1 && !replacement) {
          await pending;
          oldResponseReleased = true;
          if (outcome === "failed") {
            await route.fulfill(response(""));
            return;
          }
        }
        await route.fulfill(
          response("", [
            {
              id: `publish-${count}`,
              name: "publish_slide",
              args: {
                title: replacement ? "新的教学" : count ? "第二页" : "第一页",
                markdown: `# ${replacement ? "新的教学" : count ? "第二页" : "第一页"}\n页面内容`,
              },
            },
          ]),
        );
        return;
      }
      const replacing = transcript.includes("重新开始新教学");
      const prepareId = replacing ? "new-prepare" : "prepare";
      const prepared = messages.find(
        (message: { role: string; tool_call_id?: string }) =>
          message.role === "tool" && message.tool_call_id === prepareId,
      );
      if (!prepared) {
        await route.fulfill(
          response("", [
            {
              id: prepareId,
              name: "create_slides",
              args: {
                goal: replacing ? "新课件" : "原课件",
                pageCount: replacing ? 1 : 2,
                replaceCurrent: replacing,
              },
            },
          ]),
        );
        return;
      }
      const { pageIds } = JSON.parse(prepared.content);
      const firstId = replacing ? "show-new" : "show-first";
      if (!transcript.includes(`"id":"${firstId}"`)) {
        await route.fulfill(
          response("", [
            {
              id: firstId,
              name: "show_lesson_page",
              args: { pageId: pageIds[0] },
            },
          ]),
        );
      } else if (replacing) {
        await route.fulfill(response("新教学已经开始。"));
      } else if (!transcript.includes('"id":"show-second"')) {
        secondRequested = true;
        await route.fulfill(
          response("第一页讲解完成。", [
            {
              id: "show-second",
              name: "show_lesson_page",
              args: { pageId: pageIds[1] },
            },
          ]),
        );
      } else {
        await route.fulfill(
          response(
            outcome === "failed"
              ? "第二页生成失败，我们可以换一种讲法。"
              : "第二页讲解完成。",
          ),
        );
      }
    });
    const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
    await prompt.fill("开始教学");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => secondRequested).toBe(true);
    await expect(
      page.getByRole("img", { name: "课件页面：第一页", exact: true }),
    ).toBeVisible();
    if (outcome === "stopped") {
      await page.getByRole("button", { name: "打断", exact: true }).click();
      await prompt.fill("重新开始新教学");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(
        page.getByRole("img", { name: "课件页面：新的教学" }),
      ).toBeVisible();
    }
    release();
    await expect.poll(() => oldResponseReleased).toBe(true);
    if (outcome === "complete") {
      await expect(
        page.getByText("第二页讲解完成。", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".slide-controls")).toContainText("2 / 2");
      await page.getByRole("button", { name: "上一页", exact: true }).click();
      await expect(
        page.locator('.course-message[aria-current="step"]'),
      ).toHaveText("知芽第一页讲解完成。");
      await expect(
        page.getByRole("img", { name: "课件页面：第一页", exact: true }),
      ).toBeVisible();
    } else if (outcome === "failed") {
      await expect(
        page.getByText("第二页生成失败，我们可以换一种讲法。", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".slide-controls")).toContainText("1 / 1");
    } else {
      await expect(
        page.getByText("新教学已经开始。", { exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => course.state.pages.map((page) => page.title))
        .toEqual(["第一页", "新的教学"]);
      await expect(page.locator(".slide-controls")).toContainText("2 / 2");
    }
    await expect(
      page.getByRole("button", { name: "打断", exact: true }),
    ).toHaveCount(0);
  });
}

test("retrying a presentation does not duplicate history or recreate the exercise", async ({
  page,
}) => {
  const course = await classroom(page);
  let calls = 0;
  await page.route("**/api/learning/course/model", (route) => {
    calls++;
    return route.fulfill(
      calls <= 2
        ? response("", [
            {
              id: "same-exercise",
              name: "show_coding_exercise",
              args: {
                title: "同一练习",
                instructions: "输出数字",
                languageId: 1,
                languageName: "Python",
                starterCode: "print(1)",
              },
            },
          ])
        : response("这道题只出现一次。"),
    );
  });
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("开始练习");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("这道题只出现一次。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".slide-controls")).toContainText("1 / 1");
  await expect.poll(() => course.state.pages.length).toBe(1);
  await expect.poll(() => course.state.presentations.length).toBe(1);
});

test("a question sent during streaming survives subsequent teacher text updates", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    let first = true;
    window.fetch = async (input, init) => {
      if (!String(input).endsWith("/api/learning/course/model") || !first)
        return fetch(input, init);
      first = false;
      const encoder = new TextEncoder();
      const event = (content: string, stop = false) =>
        `data: ${JSON.stringify({ id: "stream", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: stop ? "stop" : null }] })}\n\n`;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(event("讲解的前半段。")));
            window.addEventListener(
              "finish-lesson-text",
              () => {
                controller.enqueue(
                  encoder.encode(
                    event("讲解的后半段。", true) + "data: [DONE]\n\n",
                  ),
                );
                controller.close();
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });
  await classroom(page);
  await page.route("**/api/learning/course/model", (route) =>
    route.fulfill(response("收到你的问题。")),
  );
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("开始讲解");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("讲解的前半段。", { exact: true })).toBeVisible();
  await prompt.fill("变量为什么叫变量？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("变量为什么叫变量？", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("finish-lesson-text")),
  );
  await expect(page.getByText("收到你的问题。", { exact: true })).toBeVisible();
  await expect(
    page.getByText("变量为什么叫变量？", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".course-message.user")).toHaveCount(2);
});
