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
  const classroom = page.locator(".course-room");
  await expect(classroom).toHaveCSS("background-image", "none");
  await expect(page.locator(".workspace-body")).toHaveCSS(
    "background-image",
    "none",
  );
  const userSpeaker = page.locator(".course-message.user > span").first();
  const conversationText = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const brandGreen = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--brand-green)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(page.locator(".coding-page > header > span")).toHaveCSS(
    "color",
    brandGreen,
  );
  await expect(userSpeaker).toHaveCSS("color", conversationText);
  const editorShell = page.getByRole("region", { name: "代码编辑区" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const endButton = page.getByRole("button", { name: "结束练习", exact: true });
    await page.mouse.move(0, 0);
    const resting = await endButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    await endButton.hover();
    await expect(endButton).not.toHaveCSS("background-color", resting);
    await test.info().attach(`coding-${theme}`, { body: await page.screenshot({ animations: "disabled", path: test.info().outputPath(`coding-${theme}.png`) }), contentType: "image/png" });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(editorShell).toHaveCSS("border-top-width", "2px");
  const stdin = page.getByRole("textbox", { name: "标准输入" });
  await expect(stdin).toHaveCSS("border-top-width", "2px");
  await expect(page.getByRole("region", { name: "运行结果" })).toBeVisible();
  await expect(page.getByText("运行代码后，结果会显示在这里", { exact: true })).toBeVisible();
  const outputBeforeRun = await page
    .getByRole("region", { name: "运行结果" })
    .boundingBox();
  const editorBeforeRun = await editorShell.boundingBox();
  expect((editorBeforeRun?.y ?? 0) + (editorBeforeRun?.height ?? 0)).toBeLessThan(
    outputBeforeRun?.y ?? 0,
  );
  const editorShellBox = await editorShell.boundingBox();
  const stdinBox = await stdin.boundingBox();
  expect((editorShellBox?.y ?? 0) + (editorShellBox?.height ?? 0)).toBeLessThan(
    stdinBox?.y ?? 0,
  );
  const actionsBox = await page.locator(".coding-actions").boundingBox();
  expect((stdinBox?.y ?? 0) + (stdinBox?.height ?? 0)).toBeLessThan(
    actionsBox?.y ?? 0,
  );
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
  await expect(page.getByText("运行中…", { exact: true })).toBeVisible();
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
  await page.route(
    "**/api/courses/*/outline-reorganization",
    (route) => route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
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
    "3px",
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
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(codeBlock).toHaveCSS("border-top-width", "1px");
    await expect(codeBlock).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(codeBlock.locator('span[style*="--shiki-dark"]').first()).toBeVisible();
    await test.info().attach(`markdown-${theme}`, { body: await page.screenshot({ animations: "disabled", path: test.info().outputPath(`markdown-${theme}.png`) }), contentType: "image/png" });
  }
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

test("a saved course starts a new agent-routed session and supports rename and delete", async ({
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
  let continuationRequests = 0;
  let createdConversationTitle = "";
  const savedConversationIds: string[] = [];
  let historyWasRead = false;
  await page.route("**/api/learning/course/model", async (route: Route) => {
    continuationRequests += 1;
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    expect(request.agent).toBe("teacher");
    expect(JSON.stringify(request.payload.messages)).toContain(
      "请为太阳系基础安排一次新的复习",
    );
    const transcript = JSON.stringify(request.payload.messages);
    if (continuationRequests === 1) {
      expect(transcript).toContain("Previous course transcript:\\n[]");
    }
    if (
      transcript.includes('"name":"read_course_conversation"') &&
      !transcript.includes('"name":"create_course_conversation"')
    ) {
      historyWasRead = transcript.includes("这是已保存的讲解。");
    }
    await route.fulfill(
      !transcript.includes('"name":"list_course_conversations"')
        ? toolResponse("list-history", "list_course_conversations", {})
        : !transcript.includes('"name":"read_course_conversation"')
          ? toolResponse("read-history", "read_course_conversation", {
              conversationId: "conversation-saved",
            })
          : !transcript.includes('"name":"create_course_conversation"')
            ? toolResponse("create-next", "create_course_conversation", {
                sectionId: "solar-basics",
                title: "继续认识太阳系",
              })
            : textResponse("好，我们接着认识太阳系。"),
    );
  });
  let deleted = false;
  await page.route("**/api/courses/**", async (route) => {
    const method = route.request().method();
    if (
      method === "GET" &&
      route.request().url().endsWith("/outline-reorganization")
    ) {
      await route.fulfill({ status: 404, json: { error: "没有待处理任务" } });
      return;
    }
    if (method === "PUT") {
      savedConversationIds.push((
        route.request().postDataJSON() as { conversationId: string }
      ).conversationId);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (method === "POST") {
      createdConversationTitle = (
        route.request().postDataJSON() as { title: string }
      ).title;
      await route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "conversation-next",
            sectionId: "solar-basics",
            title: createdConversationTitle,
            state: {
              messages: [],
              pages: [],
              presentedPageIds: [],
              currentPageId: "",
            },
            createdAt: "2026-09-10T10:00:00Z",
            updatedAt: "2026-09-10T10:00:00Z",
          },
        },
      });
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
  const conversationBox = await page
    .getByRole("region", { name: "教学对话" })
    .boundingBox();
  const composerFormBox = await page.locator(".course-composer").boundingBox();
  expect(Math.abs((cardBox?.width ?? 0) - (cardBox?.height ?? 0))).toBeLessThan(
    2,
  );
  expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThan(
    composerBox?.y ?? 0,
  );
  expect(
    (composerFormBox?.x ?? 0) + (composerFormBox?.width ?? 0),
  ).toBeLessThanOrEqual(
    (conversationBox?.x ?? 0) + (conversationBox?.width ?? 0),
  );
  await expect(page.locator(".course-card-open")).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(page.locator(".course-composer")).toHaveCSS(
    "box-shadow",
    "none",
  );
  const attachmentButton = page.getByRole("button", {
    name: "添加教学材料",
  });
  const submitButton = page.getByRole("button", { name: "发送" });
  const attachmentButtonBox = await attachmentButton.boundingBox();
  const submitButtonBox = await submitButton.boundingBox();
  expect(composerBox?.height ?? Infinity).toBeLessThanOrEqual(64);
  expect(
    Math.abs(
      (attachmentButtonBox?.y ?? 0) - (submitButtonBox?.y ?? Infinity),
    ),
  ).toBeLessThanOrEqual(2);
  await expect(
    page.getByRole("textbox", { name: "告诉知芽你想学什么" }),
  ).toHaveAttribute("placeholder", "给知芽发消息…");
  await expect(attachmentButton).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await attachmentButton.hover();
  await expect(attachmentButton).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.getByRole("button", { name: "打开课程：认识太阳系" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await expect(page.getByRole("region", { name: "教学对话" })).toHaveCount(0);
  await expect(page.getByText("交给知芽安排", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "接下来想怎么学？" }),
  ).toHaveCount(0);
  const courseComposer = await page
    .locator(".course-home-composer")
    .boundingBox();
  expect((courseComposer?.y ?? 0) + (courseComposer?.height ?? 0)).toBeGreaterThan(
    900,
  );
  const courseAttachmentButton = page.getByRole("button", {
    name: "添加教学材料",
  });
  await expect(courseAttachmentButton).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await courseAttachmentButton.hover();
  await expect(courseAttachmentButton).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await test.info().attach(`course-${theme}`, { body: await page.screenshot({ animations: "disabled", path: test.info().outputPath(`course-${theme}.png`) }), contentType: "image/png" });
  }
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("请为太阳系基础安排一次新的复习");
  await page.getByRole("button", { name: "开始新的学习" }).click();
  await expect(
    page.getByText("这是已保存的讲解。", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("好，我们接着认识太阳系。", { exact: true }),
  ).toBeVisible();
  expect(continuationRequests).toBe(4);
  expect(historyWasRead).toBe(true);
  expect(createdConversationTitle).toBe("继续认识太阳系");
  await expect.poll(() => savedConversationIds).toContain("conversation-next");
  expect(savedConversationIds).not.toContain("conversation-saved");
  await expect(
    page.getByRole("img", { name: "课件页面：太阳系" }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "已有课程" })).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("太阳系基础");
  await expect(page.getByRole("banner")).not.toContainText("对话");
  await page.getByRole("button", { name: "返回课程" }).click();
  await page
    .getByRole("button", { name: "查看太阳系基础的 2 次学习记录" })
    .click();
  await page
    .getByRole("button", { name: "打开学习记录：认识八颗行星" })
    .click();
  await expect(
    page.getByText("这是已保存的讲解。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("好，我们接着认识太阳系。", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回课程" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await page.getByRole("button", { name: "返回课程列表" }).click();
  await expect(page.getByRole("region", { name: "已有课程" })).toBeVisible();

  await page.getByRole("button", { name: "管理课程：认识太阳系" }).click();
  await expect(page.locator(".course-card-menu")).toHaveCSS(
    "border-radius",
    "12px",
  );
  await expect(page.locator(".course-card-menu")).not.toHaveCSS(
    "animation-name",
    "none",
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
    conversationId: "",
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
    sections: [],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
  };
  let creation: { title: string; topic: string } | null = null;
  let persisted: { state?: { messages?: Array<{ text: string }> } } | null =
    null;
  let outline: Array<{ title: string; objective: string }> = [];
  let conversationCreation: { title: string } | null = null;
  let teacherInstructions = "";
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
            conversations: [],
          })),
        },
      },
    });
  });
  await page.route(
    "**/api/courses/course-agent/sections/initial-section/conversations",
    async (route) => {
      conversationCreation = route.request().postDataJSON() as {
        title: string;
      };
      await route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "conversation-agent",
            sectionId: "initial-section",
            title: conversationCreation.title,
            state: {
              messages: [],
              pages: [],
              presentedPageIds: [],
              currentPageId: "",
            },
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T08:00:00Z",
          },
        },
      });
    },
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string }> };
    };
    expect(request.agent).toBe("teacher");
    teacherInstructions = request.payload.messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("\n");
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
          : !transcript.includes('"name":"create_course_conversation"')
            ? toolResponse(
                "start-fractions",
                "create_course_conversation",
                { sectionId: "initial-section", title: "认识分数" },
              )
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
  expect(conversationCreation).toEqual({ title: "认识分数" });
  expect(teacherInstructions).toMatch(
    /set_course_outline.+create_course_conversation.+first section/i,
  );
  expect(teacherInstructions).toMatch(/only teach after that conversation exists/i);
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

test("a student creates a course with teaching materials attached to the first request", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const state = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const created = {
    id: "course-with-material",
    conversationId: "",
    title: "变量入门",
    topic: "根据讲义学习变量",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "VARIABLES",
    },
    state,
    sections: [],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T08:00:00Z",
  };
  const material = {
    id: "variables-notes",
    name: "variables.md",
    mediaType: "text/markdown" as const,
    sizeBytes: 43,
    createdAt: "2026-09-14T08:01:00Z",
  };
  let uploadedContent = "";
  let uploadComplete = false;
  const outlined = {
    ...created,
    sections: [
      {
        id: "variables-section",
        title: "认识变量",
        objective: "理解变量用于命名数据",
        position: 0,
        status: "planned" as const,
        conversations: [],
      },
    ],
  };

  await page.route("**/api/courses", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { courses: [] } });
      return;
    }
    await route.fulfill({ status: 201, json: { course: created } });
  });
  await page.route(
    "**/api/courses/course-with-material/material-uploads",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        name: "variables.md",
        sizeBytes: 43,
      });
      await route.fulfill({
        status: 201,
        json: {
          upload: {
            id: "variables-upload",
            url: "https://storage.test/uploads/variables",
            headers: { "Content-Type": "text/markdown" },
            expiresAt: "2026-09-14T08:03:00Z",
          },
        },
      });
    },
  );
  await page.route("https://storage.test/uploads/variables", async (route) => {
    uploadedContent = route.request().postData() ?? "";
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route(
    "**/api/courses/course-with-material/material-uploads/variables-upload/complete",
    async (route) => {
      expect(uploadedContent).toBe("# 变量\n变量是给数据起的名字。\n");
      uploadComplete = true;
      await route.fulfill({ status: 201, json: { material } });
    },
  );
  await page.route(
    "**/api/courses/course-with-material/materials",
    (route) => route.fulfill({ json: { materials: [material] } }),
  );
  await page.route(
    "**/api/courses/course-with-material/materials/variables-notes/download",
    (route) =>
      route.fulfill({
        json: {
          material,
          url: "https://storage.test/materials/variables",
        },
      }),
  );
  await page.route("https://storage.test/materials/variables", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/markdown",
      body: "# 变量\n变量是给数据起的名字。\n",
    }),
  );
  await page.route("**/api/courses/course-with-material/outline", (route) =>
    route.fulfill({ json: { course: outlined } }),
  );
  await page.route(
    "**/api/courses/course-with-material/sections/variables-section/conversations",
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "conversation-with-material",
            sectionId: "variables-section",
            title: "认识变量",
            state,
            createdAt: "2026-09-14T08:00:00Z",
            updatedAt: "2026-09-14T08:00:00Z",
          },
        },
      }),
  );
  await page.route(
    "**/api/courses/course-with-material/conversation",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    if (!transcript.includes('"name":"create_course"')) {
      await route.fulfill(
        toolResponse("create-variables", "create_course", {
          title: "变量入门",
          topic: "根据讲义学习变量",
          cover: {
            motif: "code",
            palette: "sprout",
            label: "VARIABLES",
          },
        }),
      );
      return;
    }
    expect(uploadComplete).toBe(true);
    if (!transcript.includes('"name":"list_course_materials"')) {
      await route.fulfill(
        toolResponse("list-variables", "list_course_materials", {}),
      );
      return;
    }
    if (!transcript.includes('"name":"read_course_material"')) {
      await route.fulfill(
        toolResponse("read-variables", "read_course_material", {
          materialId: "variables-notes",
        }),
      );
      return;
    }
    if (!transcript.includes('"name":"set_course_outline"')) {
      expect(transcript).toContain("变量是给数据起的名字");
      await route.fulfill(
        toolResponse("outline-variables", "set_course_outline", {
          sections: [
            {
              title: "认识变量",
              objective: "理解变量用于命名数据",
            },
          ],
        }),
      );
      return;
    }
    await route.fulfill(
      !transcript.includes('"name":"create_course_conversation"')
        ? toolResponse(
            "start-variables",
            "create_course_conversation",
            { sectionId: "variables-section", title: "认识变量" },
          )
        : textResponse(
            "我会按照你附带的讲义，从变量为什么需要名字开始。",
          ),
    );
  });

  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加教学材料" }).click();
  await (await chooser).setFiles({
    name: "variables.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 变量\n变量是给数据起的名字。\n"),
  });
  await expect(
    page.getByRole("button", { name: "移除材料：variables.md" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("请根据这份讲义创建课程");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("我会按照你附带的讲义，从变量为什么需要名字开始。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("variables.md", { exact: true }),
  ).toBeVisible();
});

test("the course composer validates and removes teaching materials before sending", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  await page.goto("/");
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({
    name: "worksheet.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not supported"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "目前仅支持 Markdown 和 TXT 文件",
  );
  await expect(
    page.getByRole("button", { name: "移除材料：worksheet.pdf" }),
  ).toHaveCount(0);

  await input.setInputFiles({
    name: "lesson.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("lesson notes"),
  });
  const remove = page.getByRole("button", { name: "移除材料：lesson.txt" });
  await expect(remove).toBeVisible();
  const removeBox = await remove.boundingBox();
  expect(removeBox?.width).toBe(20);
  expect(removeBox?.height).toBe(20);
  await remove.hover();
  await expect(remove).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

  await input.setInputFiles({
    name: "outline.md",
    mimeType: "",
    buffer: Buffer.from("# Outline"),
  });
  await expect(
    page.getByRole("button", { name: "移除材料：outline.md" }),
  ).toBeVisible();
});

test("a student drags teaching material onto the course composer", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  await page.goto("/");
  const composer = page.locator(".course-composer");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["# 函数\n函数封装可复用的步骤。"], "functions.md", {
        type: "text/markdown",
      }),
    );
    return data;
  });

  await composer.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.getByText("松开以添加教学材料")).toBeVisible();
  const inputGroup = composer.locator('[data-slot="input-group"]');
  const dropzone = page.locator(".chat-composer-dropzone");
  await expect(dropzone).not.toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(dropzone).toHaveCSS(
    "border-radius",
    await inputGroup.evaluate(
      (element) => getComputedStyle(element).borderRadius,
    ),
  );

  await composer.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("button", { name: "移除材料：functions.md" }),
  ).toBeVisible();
  await expect(page.locator(".chat-composer-attachments")).not.toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.getByText("松开以添加教学材料")).toHaveCount(0);
});

test("course motion respects the student's reduced-motion preference", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockCompletedWorkspace(page);
  await page.goto("/");
  const composer = page.locator(".course-composer");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["lesson"], "lesson.txt", { type: "text/plain" }),
    );
    return data;
  });

  await composer.dispatchEvent("dragenter", { dataTransfer: transfer });

  await expect(page.locator(".chat-composer-dropzone")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    composer.locator('[data-slot="input-group"]'),
  ).toHaveCSS("transition-duration", "0s");
});

test("a student attaches new teaching material inside an existing course conversation", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const content = "# 循环\n循环会重复执行代码。";
  const state = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const saved = {
    id: "existing-attachment",
    conversationId: "loops-chat",
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
        id: "loops",
        title: "循环",
        objective: "理解重复执行",
        position: 0,
        status: "active" as const,
        conversations: [
          {
            id: "loops-chat",
            sectionId: "loops",
            title: "循环入门",
            state,
            createdAt: "2026-09-14T08:00:00Z",
            updatedAt: "2026-09-14T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T08:00:00Z",
  };
  const material = {
    id: "loops-notes",
    name: "loops.txt",
    mediaType: "text/plain" as const,
    sizeBytes: Buffer.byteLength(content),
    createdAt: "2026-09-14T08:01:00Z",
  };
  let uploadComplete = false;

  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route(
    "**/api/courses/existing-attachment/material-uploads",
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          upload: {
            id: "loops-upload",
            url: "https://storage.test/uploads/loops",
            headers: { "Content-Type": "text/plain" },
            expiresAt: "2026-09-14T08:03:00Z",
          },
        },
      }),
  );
  await page.route("https://storage.test/uploads/loops", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route(
    "**/api/courses/existing-attachment/material-uploads/loops-upload/complete",
    (route) => {
      uploadComplete = true;
      return route.fulfill({ status: 201, json: { material } });
    },
  );
  await page.route(
    "**/api/courses/existing-attachment/materials",
    (route) => route.fulfill({ json: { materials: [material] } }),
  );
  await page.route(
    "**/api/courses/existing-attachment/materials/loops-notes/download",
    (route) =>
      route.fulfill({
        json: { material, url: "https://storage.test/materials/loops" },
      }),
  );
  await page.route("https://storage.test/materials/loops", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: content }),
  );
  await page.route(
    "**/api/courses/existing-attachment/conversation",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    expect(uploadComplete).toBe(true);
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      !transcript.includes('"name":"list_course_materials"')
        ? toolResponse("list-loops", "list_course_materials", {})
        : !transcript.includes('"name":"read_course_material"')
          ? toolResponse("read-loops", "read_course_material", {
              materialId: "loops-notes",
            })
          : textResponse(
              transcript.includes("循环会重复执行代码")
                ? "我已经读到新材料，我们结合示例继续学习循环。"
                : "我没有读到材料。",
            ),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await page.getByRole("button", { name: "打开小节：循环" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加教学材料" }).click();
  await (await chooser).setFiles({
    name: "loops.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("结合这份材料继续讲循环");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("我已经读到新材料，我们结合示例继续学习循环。", {
      exact: true,
    }),
  ).toBeVisible();
});

test("a failed conversation attachment remains available to retry", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const state = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const saved = {
    id: "attachment-retry",
    conversationId: "retry-chat",
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
        id: "retry-section",
        title: "变量",
        objective: "理解变量",
        position: 0,
        status: "active" as const,
        conversations: [
          {
            id: "retry-chat",
            sectionId: "retry-section",
            title: "变量入门",
            state,
            createdAt: "2026-09-14T08:00:00Z",
            updatedAt: "2026-09-14T08:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T08:00:00Z",
  };
  let modelRequests = 0;
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route(
    "**/api/courses/attachment-retry/material-uploads",
    (route) => route.fulfill({ status: 500, json: { error: "unavailable" } }),
  );
  await page.route("**/api/learning/course/model", (route) => {
    modelRequests += 1;
    return route.fulfill(textResponse("不应发送这条请求。"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await page.getByRole("button", { name: "打开小节：变量" }).click();
  const input = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "variables.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("变量材料"),
  });
  await input.fill("根据新材料继续");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "教学材料上传失败，请重试",
  );
  await expect(input).toHaveValue("根据新材料继续");
  await expect(
    page.getByRole("button", { name: "移除材料：variables.txt" }),
  ).toBeVisible();
  expect(modelRequests).toBe(0);
});

test("a student starts a course conversation with teaching material from the course overview", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const content = "# 循环练习\n用循环打印三颗星。";
  const emptyState = {
    messages: [],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const saved = {
    id: "overview-attachment",
    conversationId: "loops-chat",
    title: "Python 入门",
    topic: "系统学习 Python",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "PYTHON",
    },
    state: emptyState,
    sections: [
      {
        id: "loops",
        title: "循环",
        objective: "使用循环解决重复任务",
        position: 0,
        status: "active" as const,
        conversations: [],
      },
    ],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T08:00:00Z",
  };
  const material = {
    id: "loops-overview-notes",
    name: "loops.md",
    mediaType: "text/markdown" as const,
    sizeBytes: Buffer.byteLength(content),
    createdAt: "2026-09-14T08:01:00Z",
  };
  let uploadComplete = false;

  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route(
    "**/api/courses/overview-attachment/material-uploads",
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          upload: {
            id: "overview-upload",
            url: "https://storage.test/uploads/overview-loops",
            headers: { "Content-Type": "text/markdown" },
            expiresAt: "2026-09-14T08:03:00Z",
          },
        },
      }),
  );
  await page.route("https://storage.test/uploads/overview-loops", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route(
    "**/api/courses/overview-attachment/material-uploads/overview-upload/complete",
    (route) => {
      uploadComplete = true;
      return route.fulfill({ status: 201, json: { material } });
    },
  );
  await page.route(
    "**/api/courses/overview-attachment/sections/loops/conversations",
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "loops-next",
            sectionId: "loops",
            title: "练习循环",
            state: emptyState,
            createdAt: "2026-09-14T08:02:00Z",
            updatedAt: "2026-09-14T08:02:00Z",
          },
        },
      }),
  );
  await page.route(
    "**/api/courses/overview-attachment/materials",
    (route) => route.fulfill({ json: { materials: [material] } }),
  );
  await page.route(
    "**/api/courses/overview-attachment/materials/loops-overview-notes/download",
    (route) =>
      route.fulfill({
        json: { material, url: "https://storage.test/materials/overview-loops" },
      }),
  );
  await page.route("https://storage.test/materials/overview-loops", (route) =>
    route.fulfill({ status: 200, contentType: "text/markdown", body: content }),
  );
  await page.route(
    "**/api/courses/overview-attachment/conversation",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    expect(uploadComplete).toBe(true);
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    expect(transcript).toContain("loops.md");
    await route.fulfill(
      !transcript.includes('"name":"create_course_conversation"')
        ? toolResponse("create-loops", "create_course_conversation", {
            sectionId: "loops",
            title: "练习循环",
          })
        : !transcript.includes('"name":"list_course_materials"')
          ? toolResponse("list-overview", "list_course_materials", {})
          : !transcript.includes('"name":"read_course_material"')
            ? toolResponse("read-overview", "read_course_material", {
                materialId: "loops-overview-notes",
              })
            : textResponse(
                transcript.includes("用循环打印三颗星")
                  ? "我已读到循环练习，我们从打印三颗星开始。"
                  : "我没有读到练习材料。",
              ),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await expect(
    page.getByRole("button", { name: "添加教学材料" }),
  ).toBeVisible();
  const transfer = await page.evaluateHandle((body) => {
    const data = new DataTransfer();
    data.items.add(
      new File([body], "loops.md", { type: "text/markdown" }),
    );
    return data;
  }, content);
  await page.locator(".course-home-composer").dispatchEvent("dragenter", {
    dataTransfer: transfer,
  });
  await expect(page.getByText("松开以添加教学材料")).toBeVisible();
  await page.locator(".course-home-composer").dispatchEvent("drop", {
    dataTransfer: transfer,
  });
  const overviewRemove = page.getByRole("button", {
    name: "移除材料：loops.md",
  });
  await expect(overviewRemove).toBeVisible();
  const overviewRemoveBox = await overviewRemove.boundingBox();
  expect(overviewRemoveBox?.width).toBe(20);
  expect(overviewRemoveBox?.height).toBe(20);
  await overviewRemove.hover();
  await expect(overviewRemove).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByText("松开以添加教学材料")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("根据这份练习继续学习循环");
  await page.getByRole("button", { name: "开始新的学习" }).click();

  await expect(
    page.getByText("我已读到循环练习，我们从打印三颗星开始。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("loops.md", { exact: true })).toBeVisible();
});

test("the course agent can start another section without completing the current section", async ({
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
      { id: 1, role: "assistant" as const, text: "变量这一节已经学完。" },
    ],
  };
  const saved = {
    id: "guided-course",
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
        status: "active" as const,
        conversations: [
          {
            id: "variables-chat",
            sectionId: "variables",
            title: "认识变量",
            state: variablesState,
            createdAt: "2026-09-10T08:00:00Z",
            updatedAt: "2026-09-10T09:00:00Z",
          },
        ],
      },
      {
        id: "loops",
        title: "循环",
        objective: "使用循环解决重复任务",
        position: 1,
        status: "planned" as const,
        conversations: [],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
  };
  let outline: Array<{ id: string; status: string }> = [];
  let newConversationTitle = "";
  let persisted: { conversationId?: string; state?: typeof emptyState } | null =
    null;
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route("**/api/courses/guided-course/outline", async (route) => {
    outline = (route.request().postDataJSON() as { sections: typeof outline })
      .sections;
    await route.fulfill({
      json: {
        course: {
          ...saved,
          sections: saved.sections.map((section) => ({
            ...section,
            status: "active" as const,
          })),
        },
      },
    });
  });
  await page.route(
    "**/api/courses/guided-course/sections/loops/conversations",
    async (route) => {
      newConversationTitle = (
        route.request().postDataJSON() as { title: string }
      ).title;
      await route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "loops-next",
            sectionId: "loops",
            title: newConversationTitle,
            state: emptyState,
            createdAt: "2026-09-10T10:00:00Z",
            updatedAt: "2026-09-10T10:00:00Z",
          },
        },
      });
    },
  );
  await page.route(
    "**/api/courses/guided-course/conversation",
    async (route) => {
      persisted = route.request().postDataJSON() as typeof persisted;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    await route.fulfill(
      !transcript.includes('"name":"set_course_outline"')
        ? toolResponse("advance-outline", "set_course_outline", {
            sections: [
              {
                id: "variables",
                title: "变量与类型",
                objective: "理解变量和常见类型",
                status: "active",
              },
              {
                id: "loops",
                title: "循环",
                objective: "使用循环解决重复任务",
                status: "active",
              },
            ],
          })
        : !transcript.includes('"name":"create_course_conversation"')
          ? toolResponse(
              "advance-conversation",
              "create_course_conversation",
              { sectionId: "loops", title: "开始学习循环" },
            )
          : textResponse("接下来，我们用重复画星星来认识循环。"),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("变量还要继续学，同时开始学习循环");
  await page.getByRole("button", { name: "开始新的学习" }).click();

  await expect(
    page.getByText("接下来，我们用重复画星星来认识循环。", { exact: true }),
  ).toBeVisible();
  expect(outline.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: "variables", status: "active" },
    { id: "loops", status: "active" },
  ]);
  expect(newConversationTitle).toBe("开始学习循环");
  await expect.poll(() => persisted?.conversationId).toBe("loops-next");
  await expect
    .poll(() => persisted?.state?.messages.map(({ text }) => text))
    .toContain("接下来，我们用重复画星星来认识循环。");
  await expect(page.getByRole("banner")).toContainText("循环");
  await expect(page.getByRole("banner")).not.toContainText("对话");
});

test("the course agent reclassifies session content before publishing a revised outline", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const state = {
    messages: [
      {
        id: 1,
        role: "user" as const,
        text: "我正在给猜数字游戏加上最多五次机会。",
      },
      {
        id: 2,
        role: "assistant" as const,
        text: "我们可以使用循环记录尝试次数。",
      },
    ],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const conversation = {
    id: "game-session",
    sectionId: "old-basics",
    title: "猜数字游戏",
    state,
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
  };
  const saved = {
    id: "reorganized-course",
    conversationId: conversation.id,
    title: "Python 项目",
    topic: "通过项目学习 Python",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "PYTHON",
    },
    state,
    sections: [
      {
        id: "old-basics",
        title: "基础语法",
        objective: "学习 Python 语法",
        position: 0,
        status: "active" as const,
        conversations: [conversation],
      },
    ],
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
  };
  const draftSections = [
    {
      id: "functions-new",
      title: "函数",
      objective: "使用函数组织程序",
      status: "planned" as const,
    },
    {
      id: "loops-new",
      title: "循环项目",
      objective: "在项目中控制重复执行",
      status: "active" as const,
    },
  ];
  const reorganization = {
    id: "outline-job",
    sections: draftSections,
    pending: [conversation],
    pendingCount: 1,
  };
  let classificationRequest = "";
  let assignment: Record<string, unknown> | null = null;
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route(
    "**/api/courses/reorganized-course/outline-reorganization",
    (route) => route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
  );
  await page.route("**/api/courses/reorganized-course/outline", (route) =>
    route.fulfill({ status: 202, json: { reorganization } }),
  );
  await page.route(
    "**/api/courses/reorganized-course/outline-reorganizations/outline-job/assignments/game-session",
    async (route) => {
      assignment = route.request().postDataJSON();
      await route.fulfill({
        json: {
          course: {
            ...saved,
            conversationId: conversation.id,
            sections: [
              { ...draftSections[0], position: 0, conversations: [] },
              {
                ...draftSections[1],
                position: 1,
                conversations: [],
              },
              {
                id: "history-projects",
                title: "历史项目",
                objective: "保留不属于新版大纲的项目学习记录",
                position: 2,
                status: "archived",
                conversations: [
                  { ...conversation, sectionId: "history-projects" },
                ],
              },
            ],
          },
        },
      });
    },
  );
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "outline-classifier";
      payload: {
        messages: Array<{ role: string; content: unknown }>;
        tool_choice?: unknown;
      };
    };
    const transcript = JSON.stringify(request.payload.messages);
    if (request.agent === "outline-classifier") {
      classificationRequest = transcript;
      if (
        request.payload.tool_choice !== undefined &&
        request.payload.tool_choice !== "auto"
      ) {
        await route.fulfill({
          status: 400,
          json: {
            error: {
              message: "Thinking mode does not support this tool_choice",
              type: "invalid_request_error",
            },
          },
        });
        return;
      }
      await route.fulfill(
        toolResponse("classify-game", "assign_course_conversation", {
          newSection: {
            title: "历史项目",
            objective: "保留不属于新版大纲的项目学习记录",
          },
          reason: "该历史项目不属于新版教学大纲",
        }),
      );
      return;
    }
    if (!transcript.includes('"name":"set_course_outline"')) {
      await route.fulfill(
        toolResponse("revise-outline", "set_course_outline", {
          sections: draftSections.map(({ title, objective, status }) => ({
            title,
            objective,
            status,
          })),
        }),
      );
      return;
    }
    await route.fulfill(textResponse("已经按照实际学习内容重新整理课程。"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 项目" }).click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("重新整理课程大纲");
  await page.getByRole("button", { name: "开始新的学习" }).click();

  await expect(
    page.getByText("已经按照实际学习内容重新整理课程。", { exact: true }),
  ).toBeVisible();
  expect(classificationRequest).toContain(
    "我正在给猜数字游戏加上最多五次机会。",
  );
  expect(assignment).toMatchObject({
    newSection: {
      title: "历史项目",
      objective: "保留不属于新版大纲的项目学习记录",
    },
    conversationUpdatedAt: conversation.updatedAt,
  });
});

test("a student enters a section directly whether resuming or starting", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const savedState = {
    messages: [
      {
        id: 1,
        role: "assistant" as const,
        text: "上次我们学到用 print 输出文字。",
      },
    ],
    pages: [],
    presentedPageIds: [],
    currentPageId: "",
  };
  const saved = {
    id: "resume-course",
    conversationId: "python-basics-chat",
    title: "Python 入门",
    topic: "系统学习 Python",
    status: "active" as const,
    cover: {
      motif: "code" as const,
      palette: "sprout" as const,
      label: "PYTHON",
    },
    state: savedState,
    sections: [
      {
        id: "python-basics",
        title: "Python 基础",
        objective: "运行第一个 Python 程序",
        position: 0,
        status: "active" as const,
        conversations: [
          {
            id: "python-basics-chat",
            sectionId: "python-basics",
            title: "第一次学习",
            state: savedState,
            createdAt: "2026-09-14T08:00:00Z",
            updatedAt: "2026-09-14T09:00:00Z",
          },
        ],
      },
      {
        id: "expressions",
        title: "变量与表达式",
        objective: "使用变量保存和计算数据",
        position: 1,
        status: "planned" as const,
        conversations: [],
      },
    ],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T09:00:00Z",
  };
  let modelRequests = 0;
  let newConversationRequests = 0;
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route("**/api/learning/course/model", (route) => {
    modelRequests++;
    return route.fulfill(textResponse("让我们从变量的作用开始。"));
  });
  await page.route(
    "**/api/courses/resume-course/sections/*/conversations",
    (route) => {
      newConversationRequests++;
      return route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "expressions-first",
            sectionId: "expressions",
            title: "第一次学习",
            state: {
              messages: [],
              pages: [],
              presentedPageIds: [],
              currentPageId: "",
            },
            createdAt: "2026-09-14T10:00:00Z",
            updatedAt: "2026-09-14T10:00:00Z",
          },
        },
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await expect(
    page.getByRole("button", { name: "继续最近学习" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "打开小节：Python 基础" }).click();

  await expect(
    page.getByText("上次我们学到用 print 输出文字。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "告诉知芽你想学什么" }),
  ).toHaveAttribute("placeholder", "给知芽发消息…");
  await expect(
    page.getByText("支持 Markdown、TXT", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("Python 基础");
  await expect(page.getByRole("banner")).not.toContainText("对话");
  expect(modelRequests).toBe(0);
  expect(newConversationRequests).toBe(0);

  await page.getByRole("button", { name: "返回课程" }).click();
  await page
    .getByRole("button", { name: "打开小节：变量与表达式" })
    .click();
  await expect(
    page.getByText("让我们从变量的作用开始。", { exact: true }),
  ).toBeVisible();
  expect(modelRequests).toBe(1);
  expect(newConversationRequests).toBe(1);
});

test("a course outline opens lessons directly and manages history on demand", async ({
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
      return route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "loops-practice",
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
    "**/api/courses/python-course/sections/loops/conversations/loops-practice",
    (route) => {
      deletedConversation = true;
      return route.fulfill({
        json: {
          course: {
            ...saved,
            conversationId: "loops-chat",
            state: loopState,
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
    await route.fulfill(textResponse("我们继续学习循环。"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await expect(page.getByRole("region", { name: "课程主页" })).toBeVisible();
  await expect(page.getByRole("region", { name: "课程主页" })).not.toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.getByRole("region", { name: "教学对话" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开小节：变量与类型" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开小节：循环" }).click();
  await expect(page.getByRole("region", { name: "教学对话" })).toBeVisible();
  await expect(page.locator(".course-room")).not.toHaveCSS(
    "animation-name",
    "none",
  );
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
  expect(teacherInstructions).toContain('"activeSectionId":"loops"');
  expect(teacherInstructions).toContain('"title":"循环入门"');
  expect(teacherInstructions).toContain('"updatedAt":"2026-09-10T09:00:00Z"');

  await page.getByRole("button", { name: "返回课程" }).click();
  await page
    .getByRole("button", { name: "查看循环的 1 次学习记录" })
    .click();
  const history = page.getByRole("dialog", { name: "循环的学习记录" });
  await expect(history).toBeVisible();
  await expect(history).not.toHaveCSS("animation-name", "none");
  await expect(page.locator(".section-history-backdrop")).not.toHaveCSS(
    "animation-name",
    "none",
  );
  await history.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const sectionComposer = page.getByRole("textbox", {
    name: "告诉知芽你想在循环中学习什么",
  });
  await expect(sectionComposer).toHaveAttribute(
    "placeholder",
    "给知芽发消息…",
  );
  await expect(
    page.getByText("支持 Markdown、TXT", { exact: true }),
  ).toHaveCount(0);
  const historyBounds = await history.boundingBox();
  const composerBounds = await sectionComposer.evaluate((input) => {
      const form = input.closest("form");
      if (!form) throw new Error("Course composer form is missing");
      const { left, right } = form.getBoundingClientRect();
      return { left, right };
    });
  expect(historyBounds?.x).toBeCloseTo(composerBounds.left, 0);
  expect((historyBounds?.x ?? 0) + (historyBounds?.width ?? 0)).toBeCloseTo(
    composerBounds.right,
    0,
  );
  await expect(
    history.getByRole("textbox"),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "告诉知芽你想在循环中学习什么" })
    .fill("再练习一次循环");
  await page.getByRole("button", { name: "开始新一轮学习" }).click();
  await expect(history).toHaveCount(0);
  await expect(
    page.getByText("循环可以重复执行。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("再练习一次循环", { exact: true })).toBeVisible();
  await expect(
    page.getByText("我们继续学习循环。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回课程" }).click();
  await page
    .getByRole("button", { name: "查看循环的 2 次学习记录" })
    .click();
  await page.getByRole("button", { name: "管理学习记录：新一轮学习" }).click();
  await page.getByRole("button", { name: "删除记录" }).click();
  await expect(
    page.getByRole("button", { name: "确认删除记录" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  expect(deletedConversation).toBe(false);
  await expect(
    page.getByRole("button", { name: "打开学习记录：新一轮学习" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "管理学习记录：新一轮学习" }).click();
  await page.getByRole("button", { name: "删除记录" }).click();
  await page.getByRole("button", { name: "确认删除记录" }).click();
  await expect.poll(() => deletedConversation).toBe(true);
  await expect(
    page.getByRole("button", { name: "打开学习记录：新一轮学习" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开学习记录：循环入门" }),
  ).toBeVisible();
});

test("a student uploads, reads, and confirms deletion of a flat course material", async ({
  page,
}) => {
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
        title: "认识 Python",
        objective: "认识 Python",
        position: 0,
        status: "planned",
        conversations: [
          {
            id: "material-chat",
            sectionId: "start",
            title: "第一次 Python 学习",
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
  let deleteRequests = 0;
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
        deleteRequests += 1;
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
  await expect(
    page.getByRole("region", { name: "课程材料列表" }),
  ).not.toHaveCSS("animation-name", "none");
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
  await expect(page.locator(".course-material-item")).not.toHaveCSS(
    "animation-name",
    "none",
  );
  expect(uploadRequests).toBe(1);
  await page.getByRole("button", { name: "notes.md", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "材料预览：notes.md" }),
  ).not.toHaveCSS("animation-name", "none");
  await expect(page.getByRole("heading", { name: "变量" })).toBeVisible();
  await expect(page.getByText("变量保存数据。", { exact: true })).toBeVisible();
  await page.getByLabel("关闭材料预览").click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("根据 notes 材料教我");
  await page.getByRole("button", { name: "开始新的学习" }).click();
  await expect(
    page.getByText("根据课程材料，变量用于保存数据。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回课程" }).click();
  await page.getByRole("button", { name: "课程材料" }).click();
  await page.getByLabel("删除材料：notes.md").click();
  const confirmation = page.getByRole("dialog", {
    name: "删除课程材料？",
  });
  await expect(confirmation).toContainText("notes.md");
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(
    page.getByRole("button", { name: "notes.md", exact: true }),
  ).toBeVisible();
  expect(deleteRequests).toBe(0);

  await page.getByLabel("删除材料：notes.md").click();
  await confirmation.getByRole("button", { name: "删除材料" }).click();
  await expect(
    page.getByRole("button", { name: "notes.md", exact: true }),
  ).toHaveCount(0);
  expect(deleteRequests).toBe(1);
  await expect(page.getByText("还没有课程材料")).toBeVisible();
});
