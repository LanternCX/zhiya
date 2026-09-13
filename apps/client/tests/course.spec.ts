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

const textAndToolResponse = (
  text: string,
  id: string,
  name: string,
  args: object,
) => ({
  contentType: "text/event-stream",
  body:
    chunk({ role: "assistant", content: text }) +
    chunk({
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

test.beforeEach(async ({ page }) => {
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
});

test("a student runs a model-created coding page and receives a review only when ending it", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  await page.route("**/api/code/languages", (route) =>
    route.fulfill({
      json: { languages: [{ id: 71, name: "Python (3.8.1)" }] },
    }),
  );
  let submittedCode = "";
  let runRequests = 0;
  let releaseFirstRun = () => {};
  const firstRunPending = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  await page.route("**/api/code/runs", async (route) => {
    submittedCode = route.request().postDataJSON().sourceCode;
    runRequests++;
    if (runRequests === 1) await firstRunPending;
    await route.fulfill({
      json: {
        stdout: "你好，知芽！\n",
        stderr: "",
        compileOutput: "",
        message: "",
        status: { description: "Completed" },
        time: "0.01",
        memory: 3200,
      },
    });
  });
  let teacherCalls = 0;
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    if (request.agent === "slides") {
      await route.fulfill(textResponse(""));
      return;
    }
    teacherCalls++;
    const transcript = JSON.stringify(request.payload.messages);
    if (transcript.includes("结束这次编程练习")) {
      if (!transcript.includes('"name":"end_coding_exercise"')) {
        await route.fulfill(
          toolResponse("finish-code", "end_coding_exercise", {}),
        );
      } else {
        await route.fulfill(
          textResponse("代码能够清楚地完成任务，还可以把问候语提取成变量。"),
        );
      }
      return;
    }
    if (!transcript.includes('"name":"show_coding_exercise"')) {
      await route.fulfill(
        toolResponse("coding-page", "show_coding_exercise", {
          title: "打印一声问候",
          instructions:
            "**修改程序**，完成下面的任务：\n\n- 使用 `print` 输出：你好，知芽！",
          languageId: 71,
          languageName: "Python (3.8.1)",
          starterCode: "print('你好')",
        }),
      );
    } else {
      await route.fulfill(textResponse("你可以自己修改并运行这段代码。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("教我输出文字");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByRole("heading", { name: "打印一声问候" }),
  ).toBeVisible();
  await expect(page.getByText("main.py", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Python (3.8.1)", { exact: true }),
  ).toBeVisible();
  const instructions = page.getByRole("region", { name: "题目说明" });
  const emphasisWeight = await instructions
    .getByText("修改程序", { exact: true })
    .evaluate((element) => Number(getComputedStyle(element).fontWeight));
  expect(emphasisWeight).toBeGreaterThan(400);
  await expect(
    instructions.getByRole("listitem").getByText(/使用/),
  ).toBeVisible();
  await expect(instructions.locator("code")).toHaveText("print");
  const editor = page.getByRole("textbox", { name: "代码" });
  await editor.fill("if True:\n");
  await editor.press("Tab");
  await editor.type("pass");
  expect(
    await editor.evaluate((element) => document.activeElement === element),
  ).toBe(true);
  await page.getByRole("button", { name: "运行代码" }).click();
  const runningButton = page.getByRole("button", { name: "代码正在运行" });
  await expect(runningButton).toBeVisible();
  await expect(runningButton).toBeDisabled();
  await expect(runningButton).toHaveAttribute("aria-busy", "true");
  const runSpinner = runningButton.locator("svg");
  await expect(runSpinner).toBeVisible();
  await expect(runSpinner).not.toHaveCSS("animation-name", "none");
  await expect(page.getByText("运行中…", { exact: true })).toHaveCount(0);
  releaseFirstRun();
  await expect(
    page.getByRole("button", { name: "运行代码" }),
  ).toBeEnabled();
  await expect.poll(() => submittedCode).toBe("if True:\n    pass");
  await editor.press("Shift+Tab");
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect.poll(() => submittedCode).toBe("if True:\npass");
  await editor.fill("if True:");
  await editor.press("Enter");
  await editor.type("pass");
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect.poll(() => submittedCode).toBe("if True:\n    pass");
  await editor.fill("wh");
  await editor.press("Control+Space");
  const completion = page.getByRole("option", { name: "while" });
  await expect(completion).toBeVisible();
  await expect(completion).toHaveAttribute("aria-selected", "true");
  // CodeMirror intentionally delays accepting a newly opened completion so a
  // fast Enter keypress cannot select an option before the user sees it.
  await page.waitForTimeout(100);
  await editor.press("Enter");
  await expect(
    editor.locator(".tok-keyword", { hasText: "while" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect.poll(() => submittedCode).toBe("while :\n    ");
  await editor.fill("print('你好，知芽！')");
  await expect(editor.locator(".cm-matchingBracket")).toHaveCount(2);
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByText("你好，知芽！", { exact: true })).toBeVisible();
  const outputBox = await page
    .getByRole("region", { name: "运行结果" })
    .boundingBox();
  const runButtonBox = await page
    .getByRole("button", { name: "运行代码" })
    .boundingBox();
  expect((outputBox?.y ?? 0) + (outputBox?.height ?? 0)).toBeLessThan(
    runButtonBox?.y ?? 0,
  );
  expect(submittedCode).toBe("print('你好，知芽！')");
  expect(teacherCalls).toBe(2);

  await page.getByRole("button", { name: "结束练习" }).click();
  await expect(page.getByText(/还可以把问候语提取成变量/)).toBeVisible();
  await expect(page.getByRole("button", { name: "练习已结束" })).toBeDisabled();
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

async function mockCompletedWorkspace(page: Page) {
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
}

test("teacher follows the student's requested slide pace while keeping narration synchronized", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let teacherInstructions = "";
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: {
        messages: Array<{ role: string; content: unknown }>;
      };
    };
    if (request.agent === "teacher") {
      teacherInstructions = request.payload.messages
        .filter((message) => message.role === "system")
        .map((message) => String(message.content))
        .join("\n");
    }
    await route.fulfill(textResponse("我们开始。"));
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("连续讲完五页，不要等我确认");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("我们开始。", { exact: true })).toBeVisible();

  expect(teacherInstructions).toMatch(
    /student's explicit request.+pace.+page count.+takes priority/i,
  );
  expect(teacherInstructions).toMatch(
    /continuous.+do not wait for confirmation.+requested batch is complete/i,
  );
  expect(teacherInstructions).toMatch(
    /one page at a time.+wait for the student/i,
  );
  expect(teacherInstructions).toMatch(
    /show one page.+explain that page.+show_next_slide/i,
  );
});

test("a student sees when the model connection is retrying", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  await page.goto("/");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/learning/course/model")) {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(': zhiya-retry {"attempt":1,"maxRetries":5}\n\n'),
            );
            window.setTimeout(() => {
              const response =
                `data: ${JSON.stringify({
                  id: "recovered-model",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: "test-model",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        role: "assistant",
                        content: "连接恢复了，我们继续。",
                      },
                      finish_reason: null,
                    },
                  ],
                })}\n\n` +
                `data: ${JSON.stringify({
                  id: "recovered-model",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: "test-model",
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                })}\n\n` +
                "data: [DONE]\n\n";
              controller.enqueue(encoder.encode(response));
              controller.close();
            }, 800);
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return originalFetch(input, init);
    };
  });

  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("给我讲一个简单概念");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("连接不稳定，正在重新连接（1/5）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("连接恢复了，我们继续。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("连接不稳定，正在重新连接（1/5）", { exact: true }),
  ).toHaveCount(0);
});

test("a student keeps talking while slides arrive and replaces unfinished pages", async ({
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
    id: "completed-session",
    purpose: "onboarding",
    messages: [],
    completed: true,
    correctionEnded: false,
    memory: "喜欢先看例子，再逐步理解。",
    memoryVersion: 1,
    messageSequence: 0,
    revision: 0,
    status: "idle",
    leaseUntil: "",
    question: null,
  };
  await mockLearning(page, () => state);
  await page.route("**/api/learning/model", (route) =>
    route.fulfill({ json: { id: "test-model", available: true } }),
  );

  let releaseOld: () => void = () => {};
  const oldPage = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let releaseNew: () => void = () => {};
  const newPage = new Promise<void>((resolve) => {
    releaseNew = resolve;
  });
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;

    if (request.agent === "teacher") {
      const simpler = transcript.includes("换成简单一点的例子");
      if ((simpler && toolResults < 2) || (!simpler && toolResults === 0)) {
        await route.fulfill(
          toolResponse(
            simpler ? "slides-simple" : "slides-first",
            "create_slides",
            {
              goal: simpler ? "用简单的生活例子解释人工智能" : "介绍人工智能",
              pageCount: 2,
              replaceCurrent: simpler,
            },
          ),
        );
      } else {
        await route.fulfill(
          textResponse(
            simpler ? "好，我们换成更直观的例子。" : "我们边看课件边聊。",
          ),
        );
      }
      return;
    }

    const simpler = transcript.includes("简单的生活例子");
    if (simpler) {
      if (toolResults > 0) {
        await newPage;
        await route.fulfill(
          toolResponse("page-new-stale", "publish_slide", {
            title: "停止后不应出现",
            body: "这也是未完成页面。",
            bullets: [],
            layout: "explain",
          }),
        );
        return;
      }
      await route.fulfill(
        toolResponse("page-simple", "publish_slide", {
          title: "机器也会认猫吗？",
          kicker: "从生活中的分类开始",
          body: "人工智能会从许多例子里寻找共同特点。",
          bullets: ["看很多猫的图片", "找到耳朵、胡须等特点", "判断新图片"],
          layout: "steps",
        }),
      );
      return;
    }
    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("page-first", "publish_slide", {
          title: "人工智能是什么？",
          kicker: "第一步",
          body: "人工智能让机器能够完成一些需要人类智慧的任务。",
          bullets: ["识别图片", "理解语言", "发现规律"],
          layout: "explain",
        }),
      );
      return;
    }
    await oldPage;
    await route.fulfill(
      toolResponse("page-stale", "publish_slide", {
        title: "不会出现的旧页面",
        body: "旧任务完成得太晚。",
        bullets: [],
        layout: "explain",
      }),
    );
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天想学什么？" }),
  ).toBeVisible();
  await expect(page.getByText("初次交流已完成", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("region", { name: "课程记录" })).toHaveCount(0);
  await expect(page.locator(".course-conversation > header")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);
  await expect(page.locator(".workspace-sidebar")).toHaveCSS(
    "border-right-width",
    "1px",
  );
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("我想学习人工智能");
  await page.getByRole("button", { name: "发送" }).click();

  const slides = page.getByRole("region", { name: "课堂页面" });
  await expect(
    slides.getByRole("img", { name: "课件页面：人工智能是什么？" }),
  ).toBeVisible();
  await expect(
    page.getByText("我们边看课件边聊。", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("换成简单一点的例子");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    slides.getByRole("img", { name: "课件页面：机器也会认猫吗？" }),
  ).toBeVisible();
  await expect(
    page.getByText("好，我们换成更直观的例子。", { exact: true }),
  ).toBeVisible();

  releaseNew();
  releaseOld();
  await expect(slides.getByText("不会出现的旧页面")).toHaveCount(0);
  await expect(slides.getByText("停止后不应出现")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(slides.getByRole("button", { name: "上一页" })).toBeVisible();
  await expect(slides.getByRole("button", { name: "下一页" })).toBeVisible();
});

test("a failed slide task is reported and a later request can retry", async ({
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

  let slideAttempts = 0;
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;
    if (request.agent === "teacher") {
      const retrying = JSON.stringify(request.payload.messages).includes(
        "请重试课件",
      );
      if ((!retrying && toolResults === 0) || (retrying && toolResults < 2)) {
        await route.fulfill(
          toolResponse(`slides-${crypto.randomUUID()}`, "create_slides", {
            goal: "解释机器学习",
            pageCount: 1,
            replaceCurrent: true,
          }),
        );
      } else {
        await route.fulfill(textResponse("我会根据实际生成结果继续。"));
      }
      return;
    }

    slideAttempts++;
    if (slideAttempts === 1) {
      await route.fulfill({
        status: 502,
        json: { error: "模型服务暂时不可用" },
      });
      return;
    }
    await route.fulfill(
      toolResponse("retry-page", "publish_slide", {
        title: "机器怎样从例子中学习？",
        body: "机器学习会从多个例子中寻找规律。",
        bullets: ["观察例子", "寻找规律", "尝试判断"],
        layout: "steps",
      }),
    );
  });

  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("给我讲机器学习");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("alert")).toContainText("模型服务暂时不可用");
  await expect(
    page.getByRole("button", { name: "打断", exact: true }),
  ).toHaveCount(0);

  await prompt.fill("请重试课件");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByRole("region", { name: "课堂页面" }).getByRole("img", {
      name: "课件页面：机器怎样从例子中学习？",
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("teacher markdown renders before the model stream finishes", async ({
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
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (!String(input).endsWith("/api/learning/course/model"))
        return originalFetch(input, init);
      await new Promise<void>((resolve) =>
        window.addEventListener("release-teacher-request", () => resolve(), {
          once: true,
        }),
      );
      const encoder = new TextEncoder();
      const event = (content: string, finishReason: string | null = null) =>
        `data: ${JSON.stringify({
          id: "streaming-teacher",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content },
              finish_reason: finishReason,
            },
          ],
        })}\n\n`;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                event("# 流式标题\n\n第一段\n\n```js\nconst answer = 42;\n```"),
              ),
            );
            window.addEventListener(
              "finish-teacher-stream",
              () => {
                controller.enqueue(encoder.encode(event("\n\n第二段", "stop")));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
              { once: true },
            );
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });

  await page.goto("/");
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("开始讲解");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("正在思考教学节奏…", { exact: true }),
  ).toBeVisible({
    timeout: 500,
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("release-teacher-request")),
  );

  await expect(page.getByRole("heading", { name: "流式标题" })).toBeVisible();
  await expect(page.getByText("第一段", { exact: true })).toBeVisible();
  const codeBlock = page.locator('[data-streamdown="code-block"]');
  const codeActions = page.locator('[data-streamdown="code-block-actions"]');
  await expect(codeBlock).toHaveCSS("border-top-width", "0px");
  await expect(codeBlock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(codeActions).toHaveCSS("border-top-width", "0px");
  await expect(codeActions).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(codeActions.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("第二段", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打断", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "打断", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText("第二段", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打断", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("the next slide follows its explanation and keeps the conversation anchor", async ({
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

  let finishPreparingFirstSlide: () => void = () => {};
  const firstSlide = new Promise<void>((resolve) => {
    finishPreparingFirstSlide = resolve;
  });
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;
    if (request.agent === "slides") {
      if (toolResults === 0) {
        await firstSlide;
        await route.fulfill(
          toolResponse("synchronized-page-1", "publish_slide", {
            title: "第一页",
            body: "第一页内容",
            bullets: [],
            layout: "explain",
          }),
        );
      } else if (toolResults === 1) {
        await route.fulfill(
          toolResponse("synchronized-page-2", "publish_slide", {
            title: "第二页",
            body: "第二页内容",
            bullets: [],
            layout: "explain",
          }),
        );
      } else {
        await route.fulfill(textResponse(""));
      }
      return;
    }

    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("synchronized-slides", "create_slides", {
          goal: "两页同步课程",
          pageCount: 2,
          replaceCurrent: false,
        }),
      );
    } else if (toolResults === 1) {
      await route.fulfill(
        textAndToolResponse(
          "第一页讲解开始。\n\n需要慢慢读完第二行。",
          "advance-to-page-2",
          "show_next_slide",
          {},
        ),
      );
    } else {
      await route.fulfill(textResponse("现在讲解第二页。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill(`开始两页课程。${"这是一段很长的学习背景。".repeat(120)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("正在准备课件", { exact: true })).toBeVisible();
  finishPreparingFirstSlide();

  const slides = page.getByRole("region", { name: "课堂页面" });
  await expect(
    slides.getByRole("img", { name: "课件页面：第一页" }),
  ).toBeVisible();
  await expect(page.getByText("第一页讲解开始。", { exact: true })).toBeVisible(
    { timeout: 500 },
  );
  const layout = await page.locator(".course-room").evaluate((room) => {
    const thread = room.querySelector<HTMLElement>(".course-thread");
    return {
      bottom: room.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
      threadClientHeight: thread?.clientHeight ?? 0,
      threadScrollHeight: thread?.scrollHeight ?? 0,
    };
  });
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewport);
  expect(layout.threadScrollHeight).toBeGreaterThan(layout.threadClientHeight);
  await expect(
    page.getByText("需要慢慢读完第二行。", { exact: true }),
  ).toBeVisible();
  await expect(
    slides.getByRole("img", { name: "课件页面：第二页" }),
  ).toBeVisible();
  await expect(
    page.getByText("现在讲解第二页。", { exact: true }),
  ).toBeVisible();

  const thread = page.locator(".course-thread");
  await thread.evaluate((element) => element.scrollTo({ top: 0 }));
  await slides.getByRole("button", { name: "上一页" }).click();
  await expect(
    slides.getByRole("img", { name: "课件页面：第一页" }),
  ).toBeVisible();
  const firstPageAnchor = page.locator(
    '.course-message[data-page-id="synchronized-page-1"]',
  );
  await expect(firstPageAnchor).toBeVisible();
  await expect(firstPageAnchor).toHaveAttribute("aria-current", "step");
  await expect
    .poll(() =>
      firstPageAnchor.evaluate((anchor) => {
        const thread = anchor.closest<HTMLElement>(".course-thread");
        if (!thread) return false;
        const anchorRect = anchor.getBoundingClientRect();
        const threadRect = thread.getBoundingClientRect();
        return (
          anchorRect.top >= threadRect.top &&
          anchorRect.bottom <= threadRect.bottom
        );
      }),
    )
    .toBe(true);
});

test("a saved course restores its conversation and supports rename and delete", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const saved = {
    id: "course-saved",
    conversationId: "conversation-saved",
    title: "认识太阳系",
    topic: "太阳系基础",
    status: "active" as const,
    cover: {
      motif: "orbit" as const,
      palette: "ocean" as const,
      label: "SCIENCE · 01",
    },
    state: {
      messages: [
        { id: 1, role: "user" as const, text: "给我讲太阳系" },
        {
          id: 2,
          role: "assistant" as const,
          text: "这是已保存的讲解。",
          pageId: "solar-slide",
        },
      ],
      pages: [
        {
          kind: "slide" as const,
          id: "solar-slide",
          title: "太阳系",
          kicker: "我们的宇宙邻居",
          body: "八颗行星围绕太阳运行。",
          bullets: ["太阳位于中心", "行星沿轨道运行"],
          layout: "explain" as const,
        },
      ],
      presentedPageIds: ["solar-slide"],
      currentPageId: "solar-slide",
    },
    sections: [
      {
        id: "solar-basics",
        title: "太阳系基础",
        objective: "认识太阳与八颗行星",
        position: 0,
        status: "active" as const,
        conversations: [
          {
            id: "conversation-saved",
            sectionId: "solar-basics",
            title: "认识八颗行星",
            state: {
              messages: [
                { id: 1, role: "user" as const, text: "给我讲太阳系" },
                {
                  id: 2,
                  role: "assistant" as const,
                  text: "这是已保存的讲解。",
                  pageId: "solar-slide",
                },
              ],
              pages: [
                {
                  kind: "slide" as const,
                  id: "solar-slide",
                  title: "太阳系",
                  kicker: "我们的宇宙邻居",
                  body: "八颗行星围绕太阳运行。",
                  bullets: ["太阳位于中心", "行星沿轨道运行"],
                  layout: "explain" as const,
                },
              ],
              presentedPageIds: ["solar-slide"],
              currentPageId: "solar-slide",
            },
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  let deleted = false;
  await page.route("**/api/courses/**", async (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (method === "PATCH") {
      const input = route.request().postDataJSON() as { title: string };
      await route.fulfill({
        json: { course: { ...saved, title: input.title } },
      });
      return;
    }
    if (method === "DELETE") {
      deleted = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ status: 405, json: { error: "unexpected request" } });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天想学什么？" }),
  ).toBeVisible();
  await expect(
    page.getByText("这是已保存的讲解。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "课程封面：认识太阳系" }),
  ).toBeVisible();
  const subjectArtBox = await page
    .locator(".course-start .subject-art")
    .boundingBox();
  const headingBox = await page
    .getByRole("heading", { name: "今天想学什么？" })
    .boundingBox();
  const libraryBox = await page
    .getByRole("region", { name: "已有课程" })
    .boundingBox();
  expect(
    (headingBox?.y ?? 0) -
      ((subjectArtBox?.y ?? 0) + (subjectArtBox?.height ?? 0)),
  ).toBeGreaterThanOrEqual(20);
  expect(
    (libraryBox?.y ?? 0) - ((headingBox?.y ?? 0) + (headingBox?.height ?? 0)),
  ).toBeGreaterThanOrEqual(32);
  const cardBox = await page.locator(".course-card").boundingBox();
  const composerBox = await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .boundingBox();
  expect(Math.abs((cardBox?.width ?? 0) - (cardBox?.height ?? 0))).toBeLessThan(
    2,
  );
  expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThan(
    composerBox?.y ?? 0,
  );
  await expect(page.locator(".course-card-open")).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(page.locator(".course-composer")).toHaveCSS(
    "box-shadow",
    "none",
  );
  await page.getByRole("button", { name: "打开课程：认识太阳系" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await expect(page.getByRole("region", { name: "教学对话" })).toHaveCount(0);
  await page.getByRole("button", { name: "继续最近学习" }).click();
  await expect(
    page.getByText("这是已保存的讲解。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "课件页面：太阳系" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "已有课程" })).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("太阳系基础 · 对话");
  await page.getByRole("button", { name: "返回小节" }).click();
  await expect(page.getByRole("region", { name: "小节主页" })).toBeVisible();
  await page.getByRole("button", { name: "返回课程" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await page.getByRole("button", { name: "返回课程列表" }).click();
  await expect(page.getByRole("region", { name: "已有课程" })).toBeVisible();

  await page.getByRole("button", { name: "管理课程：认识太阳系" }).click();
  await expect(page.locator(".course-card-menu")).toHaveCSS(
    "border-radius",
    "12px",
  );
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  const rename = page.getByRole("textbox", { name: "重命名认识太阳系" });
  await rename.fill("太阳系入门");
  await rename.press("Enter");
  await expect(
    page.getByRole("button", { name: "打开课程：太阳系入门" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "管理课程：太阳系入门" }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect.poll(() => deleted).toBe(true);
  await expect(
    page.getByRole("button", { name: "打开课程：太阳系入门" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "今天想学什么？" }),
  ).toBeVisible();
});

test("the teacher agent creates and persists a course from the first request", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const created = {
    id: "course-agent",
    conversationId: "conversation-agent",
    title: "分数的意义",
    topic: "小学数学中的分数概念",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "MATH · FRACTIONS",
    },
    state: {
      messages: [],
      pages: [],
      presentedPageIds: [],
      currentPageId: "",
    },
    sections: [
      {
        id: "initial-section",
        title: "开始学习",
        objective: "小学数学中的分数概念",
        position: 0,
        status: "planned" as const,
        conversations: [
          {
            id: "conversation-agent",
            sectionId: "initial-section",
            title: "开始学习",
            state: {
              messages: [],
              pages: [],
              presentedPageIds: [],
              currentPageId: "",
            },
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
  };
  let creation: { title: string; topic: string } | null = null;
  let persisted: { state?: { messages?: Array<{ text: string }> } } | null =
    null;
  let outline: Array<{ title: string; objective: string }> = [];
  await page.route("**/api/courses", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { courses: [] } });
      return;
    }
    creation = route.request().postDataJSON() as typeof creation;
    await route.fulfill({ status: 201, json: { course: created } });
  });
  await page.route(
    "**/api/courses/course-agent/conversation",
    async (route) => {
      persisted = route.request().postDataJSON() as typeof persisted;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.route("**/api/courses/course-agent/outline", async (route) => {
    outline = (route.request().postDataJSON() as { sections: typeof outline })
      .sections;
    await route.fulfill({
      json: {
        course: {
          ...created,
          sections: outline.map((section, index) => ({
            id: index === 0 ? "initial-section" : `section-${index}`,
            ...section,
            position: index,
            status: "planned",
            conversations: index === 0 ? created.sections[0].conversations : [],
          })),
        },
      },
    });
  });
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string }> };
    };
    expect(request.agent).toBe("teacher");
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      !transcript.includes('"name":"create_course"')
        ? toolResponse("create-fractions", "create_course", {
            title: "分数的意义",
            topic: "小学数学中的分数概念",
            cover: {
              motif: "geometry",
              palette: "sunrise",
              label: "MATH · FRACTIONS",
            },
          })
        : !transcript.includes('"name":"set_course_outline"')
          ? toolResponse("outline-fractions", "set_course_outline", {
              sections: [
                {
                  title: "认识分数",
                  objective: "理解整体与部分的关系",
                },
                {
                  title: "比较分数",
                  objective: "比较常见分数的大小",
                },
              ],
            })
          : textResponse("我们从把一个苹果平均分开开始。"),
    );
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("我想理解分数");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("我们从把一个苹果平均分开开始。", { exact: true }),
  ).toBeVisible();
  expect(creation).toEqual({
    title: "分数的意义",
    topic: "小学数学中的分数概念",
    cover: {
      motif: "geometry",
      palette: "sunrise",
      label: "MATH · FRACTIONS",
    },
  });
  expect(outline.map((section) => section.title)).toEqual([
    "认识分数",
    "比较分数",
  ]);
  await expect
    .poll(() => persisted?.state?.messages?.map((message) => message.text))
    .toContain("我们从把一个苹果平均分开开始。");
  await page.getByRole("button", { name: "学习地图" }).click();
  await expect(
    page.getByRole("button", { name: "打开课程：分数的意义" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "课程封面：分数的意义" }),
  ).toBeVisible();
});

test("a course outline organizes conversations and restores the selected conversation", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const emptyState = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const variablesState = {
    ...emptyState,
    messages: [
      { id: 1, role: "assistant" as const, text: "变量可以保存数据。" },
    ],
  };
  const loopState = {
    ...emptyState,
    messages: [
      { id: 1, role: "assistant" as const, text: "循环可以重复执行。" },
    ],
  };
  const saved = {
    id: "python-course",
    conversationId: "variables-chat",
    title: "Python 入门",
    topic: "系统学习 Python",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "PYTHON",
    },
    state: variablesState,
    sections: [
      {
        id: "variables",
        title: "变量与类型",
        objective: "理解变量和常见类型",
        position: 0,
        status: "planned",
        conversations: [
          {
            id: "variables-chat",
            sectionId: "variables",
            title: "第一次学习",
            state: variablesState,
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T08:00:00Z",
          },
        ],
      },
      {
        id: "loops",
        title: "循环",
        objective: "使用循环解决重复任务",
        position: 1,
        status: "planned",
        conversations: [
          {
            id: "loops-chat",
            sectionId: "loops",
            title: "循环入门",
            state: loopState,
            createdAt: "2026-09-10T09:00:00Z",
            updatedAt: "2026-09-10T09:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route("**/api/courses/python-course/conversation", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route(
    "**/api/courses/python-course/sections/loops/conversations",
    (route) => {
      const title = (route.request().postDataJSON() as { title: string }).title;
      const independent = title === "循环独立练习";
      return route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: independent ? "loops-independent" : "loops-practice",
            sectionId: "loops",
            title,
            state: emptyState,
            createdAt: "2026-09-10T10:00:00Z",
            updatedAt: "2026-09-10T10:00:00Z",
          },
        },
      });
    },
  );
  let deletedConversation = false;
  await page.route(
    "**/api/courses/python-course/sections/loops/conversations/loops-independent",
    (route) => {
      deletedConversation = true;
      return route.fulfill({
        json: {
          course: {
            ...saved,
            conversationId: "loops-practice",
            state: emptyState,
            sections: saved.sections.map((section) =>
              section.id === "loops"
                ? {
                    ...section,
                    conversations: [
                      ...section.conversations,
                      {
                        id: "loops-practice",
                        sectionId: "loops",
                        title: "新对话",
                        state: emptyState,
                        createdAt: "2026-09-10T10:00:00Z",
                        updatedAt: "2026-09-10T10:00:00Z",
                      },
                    ],
                  }
                : section,
            ),
          },
        },
      });
    },
  );
  let teacherInstructions = "";
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    teacherInstructions = request.payload.messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("\n");
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      transcript.includes("开始一次独立练习") &&
        !transcript.includes('"name":"create_course_conversation"')
        ? toolResponse("independent-loops", "create_course_conversation", {
            sectionId: "loops",
            title: "循环独立练习",
          })
        : textResponse(
            transcript.includes("开始一次独立练习")
              ? "独立练习已经开始。"
              : "我们继续学习循环。",
          ),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await expect(page.getByRole("region", { name: "教学对话" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /变量与类型/ })).toBeVisible();
  await page.getByRole("button", { name: /循环/ }).click();
  await expect(page.getByRole("region", { name: "小节主页" })).toBeVisible();
  await expect(page.getByRole("button", { name: "课程材料" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开对话：循环入门" }).click();
  await expect(page.getByRole("region", { name: "教学对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "课程材料" })).toHaveCount(0);
  await expect(
    page.getByText("循环可以重复执行。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("变量可以保存数据。", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("继续");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("我们继续学习循环。", { exact: true }),
  ).toBeVisible();
  expect(teacherInstructions).toContain("变量与类型");
  expect(teacherInstructions).toContain("循环");
  expect(teacherInstructions).toContain("loops-chat");

  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("开始一次独立练习");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("独立练习已经开始。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("循环可以重复执行。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "课程材料" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回小节" }).click();
  await expect(
    page.getByRole("button", { name: "打开对话：循环独立练习" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始新对话" }).click();
  await expect(
    page.getByText("循环可以重复执行。", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "开始新的学习对话" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回小节" }).click();
  await page
    .getByRole("button", { name: "管理对话：循环独立练习" })
    .click();
  await page.getByRole("button", { name: "删除对话" }).click();
  await expect(
    page.getByRole("button", { name: "确认删除对话" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  expect(deletedConversation).toBe(false);
  await expect(
    page.getByRole("button", { name: "打开对话：循环独立练习" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "管理对话：循环独立练习" })
    .click();
  await page.getByRole("button", { name: "删除对话" }).click();
  await page.getByRole("button", { name: "确认删除对话" }).click();
  await expect.poll(() => deletedConversation).toBe(true);
  await expect(
    page.getByRole("button", { name: "打开对话：循环独立练习" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开对话：循环入门" }),
  ).toBeVisible();
});

test("a student uploads and reads a flat course material", async ({ page }) => {
  await mockCompletedWorkspace(page);
  const state = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const saved = {
    id: "material-course",
    conversationId: "material-chat",
    title: "Python 入门",
    topic: "系统学习 Python",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "PYTHON",
    },
    state,
    sections: [
      {
        id: "start",
        title: "开始学习",
        objective: "认识 Python",
        position: 0,
        status: "planned",
        conversations: [
          {
            id: "material-chat",
            sectionId: "start",
            title: "开始学习",
            state,
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
  };
  let materials: Array<Record<string, unknown>> = [];
  let uploadRequests = 0;
  let uploadedContent = "";
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route(
    "**/api/courses/material-course/materials",
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { materials } });
        return;
      }
      await route.fallback();
    },
  );
  await page.route(
    "**/api/courses/material-course/material-uploads",
    async (route) => {
      uploadRequests += 1;
      const input = route.request().postDataJSON() as { name: string; sizeBytes: number };
      expect(input).toEqual({ name: "notes.md", sizeBytes: 30 });
      await route.fulfill({
        status: 201,
        json: {
          upload: {
            id: "notes-upload",
            url: "https://storage.test/uploads/notes",
            headers: { "Content-Type": "text/markdown" },
            expiresAt: "2026-09-10T10:02:00Z",
          },
        },
      });
    },
  );
  await page.route("https://storage.test/uploads/notes", async (route) => {
    uploadedContent = route.request().postData() ?? "";
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route(
    "**/api/courses/material-course/material-uploads/notes-upload/complete",
    async (route) => {
      expect(uploadedContent).toBe("# 变量\n变量保存数据。");
      const material = {
        id: "notes",
        name: "notes.md",
        mediaType: "text/markdown",
        sizeBytes: 30,
        createdAt: "2026-09-10T10:00:00Z",
      };
      materials = [material];
      await route.fulfill({ status: 201, json: { material } });
    },
  );
  await page.route(
    "**/api/courses/material-course/materials/notes",
    (route) => {
      if (route.request().method() === "DELETE") {
        materials = [];
        return route.fulfill({ json: { ok: true } });
      }
      return route.fallback();
    },
  );
  await page.route(
    "**/api/courses/material-course/materials/notes/download",
    (route) => route.fulfill({ json: { material: materials[0], url: "https://storage.test/materials/notes" } }),
  );
  await page.route("https://storage.test/materials/notes", (route) =>
    route.fulfill({ status: 200, contentType: "text/markdown", body: "# 变量\n变量保存数据。" }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      !transcript.includes('"name":"list_course_materials"')
        ? toolResponse("list-notes", "list_course_materials", {})
        : !transcript.includes('"name":"read_course_material"')
          ? toolResponse("read-notes", "read_course_material", {
              materialId: "notes",
            })
          : textResponse(
              transcript.includes("变量保存数据")
                ? "根据课程材料，变量用于保存数据。"
                : "没有读到材料。",
            ),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await page.getByRole("button", { name: "课程材料" }).click();
  const uploadArea = page.getByRole("button", { name: "上传课程材料" });
  await expect(uploadArea).toContainText("拖放材料到这里");

  const rejectedTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["not supported"], "notes.pdf", {
        type: "application/pdf",
      }),
    );
    return transfer;
  });
  await uploadArea.dispatchEvent("drop", { dataTransfer: rejectedTransfer });
  await expect(page.getByRole("alert")).toHaveText(
    "目前仅支持 Markdown 和 TXT 文件",
  );
  expect(uploadRequests).toBe(0);

  const acceptedTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["# 变量\n变量保存数据。"], "notes.md", {
        type: "text/markdown",
      }),
    );
    return transfer;
  });
  await uploadArea.dispatchEvent("drop", { dataTransfer: acceptedTransfer });
  await expect(
    page.getByRole("button", { name: "notes.md", exact: true }),
  ).toBeVisible();
  expect(uploadRequests).toBe(1);
  await page.getByRole("button", { name: "notes.md", exact: true }).click();
  await expect(page.getByRole("heading", { name: "变量" })).toBeVisible();
  await expect(page.getByText("变量保存数据。", { exact: true })).toBeVisible();
  await page.getByLabel("关闭材料预览").click();
  await page.getByRole("button", { name: "继续最近学习" }).click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("根据 notes 材料教我");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("根据课程材料，变量用于保存数据。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回小节" }).click();
  await page.getByRole("button", { name: "返回课程" }).click();
  await page.getByRole("button", { name: "课程材料" }).click();
  await page.getByLabel("删除材料：notes.md").click();
  await expect(
    page.getByRole("button", { name: "notes.md", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("还没有课程材料")).toBeVisible();
});
