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
      json: {
        languages: [
          { id: 4, name: "C" },
          { id: 1, name: "Python" },
        ],
      },
    }),
  );
  let submittedCode = "";
  let submittedLanguageId = 0;
  let runRequests = 0;
  let releaseFirstRun = () => {};
  let releaseSecondRun = () => {};
  const firstRunPending = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  const secondRunPending = new Promise<void>((resolve) => {
    releaseSecondRun = resolve;
  });
  await page.route("**/api/code/runs", async (route) => {
    const submission = route.request().postDataJSON();
    submittedCode = submission.sourceCode;
    submittedLanguageId = submission.languageId;
    runRequests++;
    if (runRequests === 1) await firstRunPending;
    if (runRequests === 2) await secondRunPending;
    await route.fulfill({
      json: {
        stdout: submission.sourceCode.includes("你好，知芽")
          ? "你好，知芽！\n"
          : `第 ${runRequests} 次运行\n`,
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
          languageId: 4,
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
  const userMessage = page.locator(".course-message.user").first();
  const editorShell = page.getByRole("region", { name: "代码编辑区" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const bubbleColors = await userMessage.evaluate((element) => {
      const channels = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        return color.startsWith("color(srgb")
          ? values.map((value) => value * 255)
          : values;
      };
      const luminance = (color: string) => {
        const values = channels(color).map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const probe = document.createElement("span");
      probe.style.background = "var(--canvas-fill)";
      document.body.append(probe);
      const canvas = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const style = getComputedStyle(element);
      const background = style.backgroundColor;
      const text = getComputedStyle(
        element.querySelector("p") ?? element,
      ).color;
      const backgroundChannels = channels(background);
      const canvasChannels = channels(canvas);
      const backgroundDifference = Math.max(
        ...backgroundChannels.map((value, index) =>
          Math.abs(value - canvasChannels[index]),
        ),
      );
      const textLuminance = luminance(text);
      const backgroundLuminance = luminance(background);
      return {
        background,
        backgroundDifference,
        borderColor: style.borderTopColor,
        borderWidth: style.borderTopWidth,
        textContrast:
          (Math.max(textLuminance, backgroundLuminance) + 0.05) /
          (Math.min(textLuminance, backgroundLuminance) + 0.05),
      };
    });
    expect(
      bubbleColors.backgroundDifference,
      `${theme} user message separation`,
    ).toBeGreaterThanOrEqual(28);
    expect(bubbleColors.textContrast, `${theme} user message text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(bubbleColors.borderWidth).toBe("1px");
    expect(bubbleColors.borderColor).not.toBe(bubbleColors.background);
    const endButton = page.getByRole("button", { name: "结束练习", exact: true });
    await page.mouse.move(0, 0);
    const resting = await endButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    await endButton.hover();
    await expect(endButton).not.toHaveCSS("background-color", resting);
    await test.info().attach(`coding-${theme}`, { body: await page.screenshot({ animations: "disabled", path: test.info().outputPath(`coding-${theme}.png`) }), contentType: "image/png" });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(editorShell).toHaveCSS("border-top-width", "1px");
  const stdin = page.getByRole("textbox", { name: "标准输入" });
  await expect(stdin).toHaveCSS("border-top-width", "1px");
  const controlBoundary = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--line-strong)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(stdin).toHaveCSS("border-top-color", controlBoundary);
  await expect(
    page.locator('.course-composer > [data-slot="input-group"]'),
  ).toHaveCSS("border-top-color", controlBoundary);
  const outputRegion = page.getByRole("region", { name: "运行结果" });
  await expect(outputRegion).toBeVisible();
  await expect(page.getByText("运行代码后，结果会显示在这里", { exact: true })).toBeVisible();
  const outputBeforeRun = await outputRegion.boundingBox();
  expect(outputBeforeRun?.height ?? 0).toBeGreaterThanOrEqual(80);
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
  await stdin.evaluate((element) => {
    element.style.height = "240px";
  });
  await expect
    .poll(async () => {
      const box = await page.locator(".coding-actions").boundingBox();
      return box?.y ?? 0;
    })
    .toBeGreaterThan(actionsBox?.y ?? 0);
  const resizedStdinBox = await stdin.boundingBox();
  const movedActionsBox = await page.locator(".coding-actions").boundingBox();
  expect(
    (resizedStdinBox?.y ?? 0) + (resizedStdinBox?.height ?? 0),
  ).toBeLessThan(movedActionsBox?.y ?? 0);
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
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(stdin).toBeDisabled();
  releaseFirstRun();
  await expect(
    page.getByRole("button", { name: "运行代码" }),
  ).toBeEnabled();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(stdin).toBeEnabled();
  await expect.poll(() => submittedCode).toBe("if True:\n    pass");
  expect(submittedLanguageId).toBe(1);
  await expect(page.getByText("第 1 次运行", { exact: true })).toBeVisible();
  await editor.press("Shift+Tab");
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByText("正在重新运行…", { exact: true })).toBeVisible();
  await expect(page.getByText("第 1 次运行", { exact: true })).toHaveCount(0);
  await expect.poll(() => runRequests).toBe(2);
  releaseSecondRun();
  await expect.poll(() => submittedCode).toBe("if True:\npass");
  await expect(page.getByText("第 2 次运行", { exact: true })).toBeVisible();
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

test("a failed rerun removes the previously saved coding result", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const previousResult = {
    stdout: "旧结果\n",
    stderr: "",
    compileOutput: "",
    message: "",
    status: { description: "Completed" },
    time: "0.01",
    memory: 3200,
  };
  const codingPage = {
    kind: "coding" as const,
    id: "saved-code",
    title: "打印一声问候",
    instructions: "运行代码。",
    languageId: 1,
    languageName: "Python",
    starterCode: "print('你好')",
    code: "print('你好')",
    stdin: "",
    status: "active" as const,
    result: previousResult,
  };
  const overviewPage = {
    kind: "slide" as const,
    id: "saved-overview",
    title: "开始",
    body: "先看示例。",
    bullets: [],
    layout: "explain" as const,
  };
  const savedState = {
    messages: [],
    pages: [overviewPage, codingPage],
    presentedPageIds: [overviewPage.id, codingPage.id],
    currentPageId: codingPage.id,
  };
  const saved = {
    id: "saved-code-course",
    conversationId: "saved-code-chat",
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
            id: "saved-code-chat",
            sectionId: "python-basics",
            title: "第一次学习",
            state: savedState,
            createdAt: "2026-09-14T08:00:00Z",
            updatedAt: "2026-09-14T09:00:00Z",
          },
        ],
      },
    ],
    createdAt: "2026-09-14T08:00:00Z",
    updatedAt: "2026-09-14T09:00:00Z",
  };
  let savedRequest: {
    state?: { pages?: Array<{ id: string; result?: unknown }> };
  } | null = null;
  let releaseFailedRun = () => {};
  const failedRunPending = new Promise<void>((resolve) => {
    releaseFailedRun = resolve;
  });
  let runRequests = 0;
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [saved] } }),
  );
  await page.route("**/api/code/languages", (route) =>
    route.fulfill({ json: { languages: [{ id: 1, name: "Python" }] } }),
  );
  await page.route("**/api/code/runs", async (route) => {
    runRequests++;
    if (runRequests === 1) {
      await failedRunPending;
      await route.fulfill({
        json: { ...previousResult, stdout: "过期结果\n" },
      });
      return;
    }
    await route.fulfill({ status: 500, json: { error: "执行失败" } });
  });
  await page.route(
    "**/api/courses/saved-code-course/conversation",
    async (route) => {
      savedRequest = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await page
    .getByRole("button", { name: "打开小节：Python 基础" })
    .click();
  await expect(page.getByText("旧结果", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.getByRole("button", { name: "返回课程" }).click();
  await page
    .getByRole("button", { name: "打开小节：Python 基础" })
    .click();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(
    page
      .getByRole("article", { name: "编程练习：打印一声问候" })
      .getByRole("alert"),
  ).toContainText("执行失败");
  await expect(page.getByText("旧结果", { exact: true })).toHaveCount(0);
  releaseFailedRun();
  await expect(page.getByText("过期结果", { exact: true })).toHaveCount(0);
  await expect
    .poll(
      () =>
        savedRequest?.state?.pages?.find(({ id }) => id === codingPage.id)
          ?.result,
    )
    .toBeUndefined();
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

test("the teacher sends DeepSeek-compatible completion fields", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let payload: Record<string, unknown> & {
    tools?: Array<{
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
  } = {};
  await page.route("**/api/learning/course/model", async (route) => {
    payload = route.request().postDataJSON().payload;
    await route.fulfill(textResponse("我们开始学习。"));
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("教我认识三角形");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("我们开始学习。")).toBeVisible();
  expect(payload.max_tokens).toBe(8192);
  expect(payload).not.toHaveProperty("max_completion_tokens");
  expect(payload).not.toHaveProperty("store");
  expect(payload).not.toHaveProperty("parallel_tool_calls");
  expect(
    payload.tools?.find((tool) => tool.function.name === "control_animation")
      ?.function.parameters.type,
  ).toBe("object");
  const animationDescription = payload.tools?.find(
    (tool) => tool.function.name === "create_animation",
  )?.function.description;
  expect(animationDescription).toMatch(/8 nodes.+10 edges.+3 buttons/i);
  expect(animationDescription).toMatch(/no colors.+coordinates.+code/i);
});

test("animation generation stays in the background until the teacher presents its page", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let releaseAnimation = () => {};
  const animationReady = new Promise<void>((resolve) => {
    releaseAnimation = resolve;
  });
  let animationModelCalls = 0;
  let animationPublished = false;
  let teacherSawCompletionNotice = false;

  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "animation";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;

    if (request.agent === "animation") {
      animationModelCalls += 1;
      if (toolResults === 0) {
        await animationReady;
        await route.fulfill(
          toolResponse("publish-water-cycle", "publish_animation", {
            pageId: "water-cycle",
            title: "水循环",
            layout: "horizontal",
            nodes: [
              { id: "sea", shape: "rectangle", label: "海洋" },
              { id: "cloud", shape: "circle", label: "云" },
              { id: "rain", shape: "diamond", label: "降雨" },
            ],
            edges: [
              { id: "evaporation", source: "sea", target: "cloud", label: "蒸发" },
              { id: "precipitation", source: "cloud", target: "rain", label: "凝结" },
            ],
            buttons: [
              {
                id: "play-cycle",
                label: "播放水循环",
                steps: [
                  [{ type: "highlight", targetId: "sea" }],
                  [{ type: "flow", targetId: "evaporation" }],
                  [{ type: "highlight", targetId: "cloud" }],
                ],
              },
            ],
          }),
        );
      } else {
        await route.fulfill(textResponse(""));
      }
      animationPublished = true;
      return;
    }

    if (transcript.includes("请播放动画")) {
      if (!transcript.includes('"name":"control_animation"')) {
        await route.fulfill(
          toolResponse("play-water-cycle", "control_animation", {
            pageId: "water-cycle",
            action: "play",
            buttonId: "play-cycle",
          }),
        );
      } else {
        await route.fulfill(textResponse("动画正在播放。"));
      }
      return;
    }

    if (transcript.includes("现在展示")) {
      teacherSawCompletionNotice = transcript.includes(
        "Background child-agent task completed",
      );
      if (!teacherSawCompletionNotice) {
        await route.fulfill(textResponse("动画还在生成，完成后我会展示。"));
      } else if (!transcript.includes('"name":"read_lesson_pages"')) {
        await route.fulfill(
          toolResponse("read-water-cycle", "read_lesson_pages", {}),
        );
      } else if (!transcript.includes('"name":"place_lesson_page"')) {
        await route.fulfill(
          toolResponse("place-water-cycle", "place_lesson_page", {
            pageId: "water-cycle",
            position: 1,
          }),
        );
      } else if (!transcript.includes('"name":"show_lesson_page"')) {
        await route.fulfill(
          toolResponse("show-water-cycle", "show_lesson_page", {
            pageId: "water-cycle",
          }),
        );
      } else {
        await route.fulfill(textResponse("我们来看水循环。"));
      }
      return;
    }
    if (transcript.includes("动画准备好了吗")) {
      await route.fulfill(textResponse("我还可以继续回答你，动画正在后台生成。"));
      return;
    }
    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("create-water-cycle", "create_animation", {
          pageId: "water-cycle",
          goal: "用三个节点演示水循环",
        }),
      );
    } else {
      await route.fulfill(textResponse("动画已在后台开始生成。"));
    }
  });

  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("画一个水循环动画");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("动画已在后台开始生成。", { exact: true })).toBeVisible();

  await prompt.fill("动画准备好了吗");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("我还可以继续回答你，动画正在后台生成。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);

  await prompt.fill("现在展示");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);
  releaseAnimation();
  await expect.poll(() => animationPublished).toBe(true);
  await page.waitForTimeout(100);
  await prompt.fill("现在展示");
  await page.getByRole("button", { name: "发送" }).click();
  const classroom = page.getByRole("region", { name: "课堂页面" });
  await expect(
    classroom.getByRole("img", { name: "动画页面：水循环" }),
  ).toBeVisible();
  await expect(classroom.getByRole("button", { name: "播放水循环" })).toBeVisible();
  expect(animationModelCalls).toBe(1);
  expect(teacherSawCompletionNotice).toBe(true);

  await prompt.fill("请播放动画");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("动画正在播放。", { exact: true })).toBeVisible();
  await expect(
    classroom.getByRole("button", { name: "播放水循环" }),
  ).toBeDisabled();
});

test("the animation agent simplifies a scene that exceeds the element limit", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let animationModelCalls = 0;
  let animationPublished = false;
  let receivedValidationError = false;

  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "animation";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);

    if (request.agent === "animation") {
      animationModelCalls += 1;
      if (animationModelCalls === 1) {
        await route.fulfill(
          toolResponse("publish-too-complex", "publish_animation", {
            pageId: "corrected-cycle",
            title: "过度复杂的水循环",
            layout: "horizontal",
            nodes: [
              { id: "n1", shape: "rectangle", label: "海洋" },
              { id: "n2", shape: "rectangle", label: "水汽" },
              { id: "n3", shape: "circle", label: "云" },
              { id: "n4", shape: "diamond", label: "凝结" },
              { id: "n5", shape: "rectangle", label: "降雨" },
              { id: "n6", shape: "rectangle", label: "河流" },
              { id: "n7", shape: "rectangle", label: "地下水" },
              { id: "n8", shape: "rectangle", label: "植物" },
              { id: "n9", shape: "rectangle", label: "湖泊" },
            ],
            edges: [],
            buttons: [
              {
                id: "play-cycle",
                label: "播放",
                steps: [[{ type: "highlight", targetId: "n1" }]],
              },
            ],
          }),
        );
        return;
      }
      receivedValidationError = transcript.includes('"role":"tool"');
      if (animationModelCalls === 2) {
        await route.fulfill(
          toolResponse("publish-too-many-actions", "publish_animation", {
            pageId: "corrected-cycle",
            title: "动作过多的水循环",
            layout: "horizontal",
            nodes: [
              { id: "sea", shape: "rectangle", label: "海洋" },
              { id: "cloud", shape: "circle", label: "云" },
            ],
            edges: [],
            buttons: [
              {
                id: "b1",
                label: "第一段",
                steps: [
                  [
                    { type: "highlight", targetId: "sea" },
                    { type: "highlight", targetId: "cloud" },
                  ],
                  [
                    { type: "show", targetId: "sea" },
                    { type: "show", targetId: "cloud" },
                  ],
                  [
                    { type: "hide", targetId: "sea" },
                    { type: "hide", targetId: "cloud" },
                  ],
                ],
              },
              {
                id: "b2",
                label: "第二段",
                steps: [
                  [
                    { type: "highlight", targetId: "sea" },
                    { type: "highlight", targetId: "cloud" },
                  ],
                  [
                    { type: "show", targetId: "sea" },
                    { type: "show", targetId: "cloud" },
                  ],
                  [
                    { type: "hide", targetId: "sea" },
                    { type: "hide", targetId: "cloud" },
                  ],
                ],
              },
              {
                id: "b3",
                label: "第三段",
                steps: [[{ type: "highlight", targetId: "sea" }]],
              },
            ],
          }),
        );
        return;
      }
      await route.fulfill(
        toolResponse("publish-corrected", "publish_animation", {
          pageId: "corrected-cycle",
          title: "简化的水循环",
          layout: "horizontal",
          nodes: [
            { id: "sea", shape: "rectangle", label: "海洋" },
            { id: "cloud", shape: "circle", label: "云" },
          ],
          edges: [
            {
              id: "evaporation",
              source: "sea",
              target: "cloud",
              label: "蒸发",
            },
          ],
          buttons: [
            {
              id: "play-cycle",
              label: "播放",
              steps: [[{ type: "flow", targetId: "evaporation" }]],
            },
          ],
        }),
      );
      animationPublished = true;
      return;
    }

    if (transcript.includes("Background child-agent task completed")) {
      if (!transcript.includes('"name":"read_lesson_pages"')) {
        await route.fulfill(
          toolResponse("read-corrected", "read_lesson_pages", {}),
        );
      } else if (!transcript.includes('"name":"place_lesson_page"')) {
        await route.fulfill(
          toolResponse("place-corrected", "place_lesson_page", {
            pageId: "corrected-cycle",
            position: 1,
          }),
        );
      } else if (!transcript.includes('"name":"show_lesson_page"')) {
        await route.fulfill(
          toolResponse("show-corrected", "show_lesson_page", {
            pageId: "corrected-cycle",
          }),
        );
      } else {
        await route.fulfill(textResponse("修正后的动画已经展示。"));
      }
      return;
    }
    if (!transcript.includes('"name":"create_animation"')) {
      await route.fulfill(
        toolResponse("create-corrected", "create_animation", {
          pageId: "corrected-cycle",
          goal: "用少量元素绘制水循环，并在过于复杂时简化",
        }),
      );
    } else {
      await route.fulfill(textResponse("动画正在后台生成。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("画一个简单的水循环动画");
  await page.getByRole("button", { name: "发送" }).click();

  await expect.poll(() => animationPublished).toBe(true);
  await page.waitForTimeout(100);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("现在展示修正后的动画");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("修正后的动画已经展示。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "动画页面：简化的水循环" }),
  ).toBeVisible();
  expect(animationModelCalls).toBe(3);
  expect(receivedValidationError).toBe(true);
});

test("the animation agent gets one same-context correction when it stops without publishing", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let animationModelCalls = 0;
  let animationPublished = false;
  let correctionKeptFirstTurn = false;

  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "animation";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);

    if (request.agent === "animation") {
      animationModelCalls += 1;
      if (animationModelCalls === 1) {
        await route.fulfill(textResponse("我先描述一下这个动画。"));
        return;
      }
      correctionKeptFirstTurn = transcript.includes("我先描述一下这个动画。");
      await route.fulfill(
        toolResponse("publish-after-correction", "publish_animation", {
          pageId: "retry-once",
          title: "一次纠错后的动画",
          layout: "horizontal",
          nodes: [
            { id: "start", shape: "circle", label: "开始" },
            { id: "finish", shape: "rectangle", label: "完成" },
          ],
          edges: [
            { id: "path", source: "start", target: "finish", label: "过程" },
          ],
          buttons: [
            {
              id: "play",
              label: "播放",
              steps: [[{ type: "flow", targetId: "path" }]],
            },
          ],
        }),
      );
      animationPublished = true;
      return;
    }

    if (transcript.includes("Background child-agent task completed")) {
      if (!transcript.includes('"name":"read_lesson_pages"')) {
        await route.fulfill(
          toolResponse("read-after-correction", "read_lesson_pages", {}),
        );
      } else if (!transcript.includes('"name":"place_lesson_page"')) {
        await route.fulfill(
          toolResponse("place-after-correction", "place_lesson_page", {
            pageId: "retry-once",
            position: 1,
          }),
        );
      } else if (!transcript.includes('"name":"show_lesson_page"')) {
        await route.fulfill(
          toolResponse("show-after-correction", "show_lesson_page", {
            pageId: "retry-once",
          }),
        );
      } else {
        await route.fulfill(textResponse("纠错后的动画已经展示。"));
      }
      return;
    }
    if (!transcript.includes('"name":"create_animation"')) {
      await route.fulfill(
        toolResponse("create-retry-once", "create_animation", {
          pageId: "retry-once",
          goal: "画一个简单过程",
        }),
      );
    } else {
      await route.fulfill(textResponse("动画正在后台生成。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("画一个需要纠错一次的动画");
  await page.getByRole("button", { name: "发送" }).click();

  await expect.poll(() => animationPublished).toBe(true);
  await page.waitForTimeout(100);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("现在展示纠错后的动画");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page.getByText("纠错后的动画已经展示。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "动画页面：一次纠错后的动画" }),
  ).toBeVisible();
  expect(animationModelCalls).toBe(2);
  expect(correctionKeptFirstTurn).toBe(true);
});

test("the teacher can inspect and cancel one background animation task", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let releaseAnimation = () => {};
  const animationReleased = new Promise<void>((resolve) => {
    releaseAnimation = resolve;
  });

  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "animation";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;

    if (request.agent === "animation") {
      await animationReleased;
      if (!route.request().isNavigationRequest()) {
        await route.fulfill(textResponse(""));
      }
      return;
    }
    if (transcript.includes("取消这个动画")) {
      if (!transcript.includes('"name":"read_agent_tasks"')) {
        await route.fulfill(
          toolResponse("read-animation-tasks", "read_agent_tasks", {}),
        );
      } else if (!transcript.includes('"name":"cancel_agent_task"')) {
        await route.fulfill(
          toolResponse("cancel-animation-task", "cancel_agent_task", {
            taskId: "animation-1-cancel-me",
          }),
        );
      } else {
        await route.fulfill(textResponse("动画任务已取消。"));
      }
      return;
    }
    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("create-cancellable", "create_animation", {
          pageId: "cancel-me",
          goal: "创建一个稍后取消的动画",
        }),
      );
    } else {
      await route.fulfill(textResponse("动画任务已开始。"));
    }
  });

  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("创建一个动画");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("动画任务已开始。", { exact: true })).toBeVisible();

  await prompt.fill("取消这个动画");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("动画任务已取消。", { exact: true })).toBeVisible();
  releaseAnimation();
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);
});

test("two animation child agents run while the teacher remains responsive", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let startedAnimations = 0;
  let releaseAnimations = () => {};
  const released = new Promise<void>((resolve) => {
    releaseAnimations = resolve;
  });

  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "animation";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    if (request.agent === "animation") {
      startedAnimations++;
      await released;
      await route.fulfill(textResponse(""));
      return;
    }
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;
    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("create-animation-a", "create_animation", {
          pageId: "parallel-a",
          goal: "创建动画 A",
        }),
      );
    } else if (toolResults === 1) {
      await route.fulfill(
        toolResponse("create-animation-b", "create_animation", {
          pageId: "parallel-b",
          goal: "创建动画 B",
        }),
      );
    } else {
      await route.fulfill(textResponse("两个动画都在后台生成，我仍然可以回答你。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("同时创建两个动画");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("两个动画都在后台生成，我仍然可以回答你。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(startedAnimations).toBe(2);
  releaseAnimations();
});

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
    /continuous.+without waiting for confirmation.+requested batch is complete/i,
  );
  expect(teacherInstructions).toMatch(
    /one-page-at-a-time.+wait after explaining/i,
  );
  expect(teacherInstructions).toMatch(
    /show one displayed page.+explain that visible page.+advance or jump/i,
  );
});

test("background slide generation does not change the visible page before presentation", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  let releaseSlide = () => {};
  const slideReady = new Promise<void>((resolve) => {
    releaseSlide = resolve;
  });
  let slidePublished = false;
  let teacherReceivedSlideCompletion = false;
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const transcript = JSON.stringify(request.payload.messages);
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;
    if (request.agent === "slides") {
      if (toolResults === 0) {
        await slideReady;
        slidePublished = true;
        await route.fulfill(
          toolResponse("prepared-slide", "publish_slide", {
            title: "准备完成但尚未展示",
            body: "只有 Teacher 显式展示后学生才能看到。",
            bullets: [],
            layout: "explain",
          }),
        );
      } else {
        await route.fulfill(textResponse(""));
      }
      return;
    }
    if (transcript.includes("现在展示第一页")) {
      teacherReceivedSlideCompletion = transcript.includes(
        "Background child-agent task completed",
      );
      if (!transcript.includes('"name":"read_lesson_pages"')) {
        await route.fulfill(
          toolResponse("read-prepared-slide", "read_lesson_pages", {}),
        );
      } else if (!transcript.includes('"name":"place_lesson_page"')) {
        await route.fulfill(
          toolResponse("place-prepared-slide", "place_lesson_page", {
            pageId: "prepared-slide",
            position: 1,
          }),
        );
      } else if (!transcript.includes('"name":"show_lesson_page"')) {
        await route.fulfill(
          toolResponse("show-prepared-slide", "show_lesson_page", {
            pageId: "prepared-slide",
          }),
        );
      } else {
        await route.fulfill(textResponse("现在开始讲解这一页。"));
      }
    } else if (transcript.includes("Background child-agent task completed")) {
      teacherReceivedSlideCompletion = true;
      await route.fulfill(textResponse(""));
    } else if (!transcript.includes('"name":"create_slides"')) {
      await route.fulfill(
        toolResponse("prepare-hidden-slide", "create_slides", {
          goal: "生成一页但先不要展示",
          pageCount: 1,
          replaceCurrent: false,
        }),
      );
    } else {
      await route.fulfill(textResponse("页面正在后台准备。"));
    }
  });

  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await prompt.fill("生成一页但先不要展示");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("页面正在后台准备。", { exact: true })).toBeVisible();
  releaseSlide();
  await expect.poll(() => slidePublished).toBe(true);
  await page.waitForTimeout(100);
  expect(teacherReceivedSlideCompletion).toBe(false);
  await expect(page.getByRole("region", { name: "课堂页面" })).toHaveCount(0);

  await prompt.fill("现在展示第一页");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByRole("img", { name: "课件页面：准备完成但尚未展示" }),
  ).toBeVisible();
  await expect(
    page.getByText("现在开始讲解这一页。", { exact: true }),
  ).toBeVisible();
  expect(teacherReceivedSlideCompletion).toBe(true);
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
  let firstPagePublished = false;
  let simplePagePublished = false;
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
      const createCalls = (transcript.match(/"name":"create_slides"/g) ?? [])
        .length;
      const expectedCreates = simpler ? 2 : 1;
      const targetPage = simpler ? "page-simple" : "page-first";
      const targetSuffix = simpler ? "simple" : "first";
      const pageReady =
        transcript.includes("Background page entered") &&
        transcript.includes(targetPage);
      const readCalls = (
        transcript.match(/"name":"read_lesson_pages"/g) ?? []
      ).length;
      if (createCalls < expectedCreates) {
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
      } else if (!pageReady) {
        await route.fulfill(textResponse("课件正在后台准备。"));
      } else if (readCalls < createCalls) {
        await route.fulfill(
          toolResponse(`read-${targetSuffix}`, "read_lesson_pages", {}),
        );
      } else if (!transcript.includes(`"id":"place-${targetSuffix}"`)) {
        await route.fulfill(
          toolResponse(`place-${targetSuffix}`, "place_lesson_page", {
            pageId: targetPage,
            position: simpler ? 2 : 1,
          }),
        );
      } else if (!transcript.includes(`"id":"show-${targetSuffix}"`)) {
        await route.fulfill(
          toolResponse(`show-${targetSuffix}`, "show_lesson_page", {
            pageId: targetPage,
          }),
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
      simplePagePublished = true;
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
      firstPagePublished = true;
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

  await expect.poll(() => firstPagePublished).toBe(true);
  await page.waitForTimeout(100);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("先展示第一张课件");
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
  await expect.poll(() => simplePagePublished).toBe(true);
  await page.waitForTimeout(100);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("展示这个简单例子");
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
  let successfulSlidePublished = false;
  await page.route("**/api/learning/course/model", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      agent: "teacher" | "slides";
      payload: { messages: Array<{ role: string; content: unknown }> };
    };
    const toolResults = request.payload.messages.filter(
      (message) => message.role === "tool",
    ).length;
    if (request.agent === "teacher") {
      const transcript = JSON.stringify(request.payload.messages);
      const retrying = transcript.includes("请重试课件");
      if ((!retrying && toolResults === 0) || (retrying && toolResults < 2)) {
        await route.fulfill(
          toolResponse(`slides-${crypto.randomUUID()}`, "create_slides", {
            goal: "解释机器学习",
            pageCount: 1,
            replaceCurrent: true,
          }),
        );
      } else if (
        successfulSlidePublished &&
        !transcript.includes('"name":"read_lesson_pages"')
      ) {
        await route.fulfill(
          toolResponse("read-retry-page", "read_lesson_pages", {}),
        );
      } else if (
        successfulSlidePublished &&
        !transcript.includes('"name":"place_lesson_page"')
      ) {
        await route.fulfill(
          toolResponse("place-retry-page", "place_lesson_page", {
            pageId: "retry-page",
            position: 1,
          }),
        );
      } else if (
        successfulSlidePublished &&
        !transcript.includes('"name":"show_lesson_page"')
      ) {
        await route.fulfill(
          toolResponse("show-retry-page", "show_lesson_page", {
            pageId: "retry-page",
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
    successfulSlidePublished = true;
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
      const event = (
        content: string,
        finishReason: string | null = null,
        reasoningContent = "",
      ) =>
        `data: ${JSON.stringify({
          id: "streaming-teacher",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content,
                ...(reasoningContent
                  ? { reasoning_content: reasoningContent }
                  : {}),
              },
              finish_reason: finishReason,
            },
          ],
        })}\n\n`;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                event(
                  "# 流式标题\n\n第一段\n\n```js\nconst answer = 42;\n```",
                  null,
                  "先核对学习目标，再组织讲解顺序。",
                ),
              ),
            );
            window.addEventListener(
              "continue-teacher-reasoning-partial",
              () => {
                controller.enqueue(
                  encoder.encode(event("", null, "接着选择")),
                );
              },
              { once: true },
            );
            window.addEventListener(
              "continue-teacher-reasoning",
              () => {
                controller.enqueue(
                  encoder.encode(
                    event("", null, "一个容易验证的例子。"),
                  ),
                );
              },
              { once: true },
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
    page.getByText(/正在组织本次讲解… · \d+ 秒/),
  ).toBeVisible({
    timeout: 500,
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("release-teacher-request")),
  );

  await expect(page.getByRole("heading", { name: "流式标题" })).toBeVisible();
  const reasoningTrigger = page.getByRole("button", {
    name: /正在组织本次讲解/,
  });
  await expect(reasoningTrigger).toHaveAttribute("aria-expanded", "false");
  const livePreview = reasoningTrigger.locator(".reasoning-live-preview");
  await expect(livePreview).toHaveText("先核对学习目标，再组织讲解顺序。");
  await expect(livePreview).toHaveCSS("white-space", "nowrap");
  await expect(livePreview).toHaveCSS("overflow-x", "hidden");
  await expect(livePreview).toHaveCSS("overflow-y", "hidden");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("continue-teacher-reasoning-partial")),
  );
  await page.waitForTimeout(400);
  await expect(livePreview).toHaveText("先核对学习目标，再组织讲解顺序。");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("continue-teacher-reasoning")),
  );
  await expect(livePreview).toHaveText(
    "接着选择一个容易验证的例子。",
  );
  const reasoningContent = reasoningTrigger
    .locator("xpath=..")
    .locator('[data-slot="collapsible-content"]');
  await expect(reasoningContent).not.toBeVisible();
  await reasoningTrigger.click();
  await expect(livePreview).toHaveCount(0);
  await expect(reasoningContent).toContainText(
    "先核对学习目标，再组织讲解顺序。",
  );
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
  let firstSlidePublished = false;
  let secondSlidePublished = false;
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
        firstSlidePublished = true;
        await route.fulfill(
          toolResponse("synchronized-page-1", "publish_slide", {
            title: "第一页",
            body: "第一页内容",
            bullets: [],
            layout: "explain",
          }),
        );
      } else if (toolResults === 1) {
        secondSlidePublished = true;
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

    const transcript = JSON.stringify(request.payload.messages);
    if (toolResults === 0) {
      await route.fulfill(
        toolResponse("synchronized-slides", "create_slides", {
          goal: "两页同步课程",
          pageCount: 2,
          replaceCurrent: false,
        }),
      );
    } else if (!firstSlidePublished) {
      await route.fulfill(textResponse("课件正在后台生成，我可以继续响应。"));
    } else if (
      (transcript.match(/"name":"read_lesson_pages"/g) ?? []).length < 1
    ) {
      await route.fulfill(
        toolResponse("read-synchronized-page-1", "read_lesson_pages", {}),
      );
    } else if (!transcript.includes('"id":"place-synchronized-page-1"')) {
      await route.fulfill(
        toolResponse("place-synchronized-page-1", "place_lesson_page", {
          pageId: "synchronized-page-1",
          position: 1,
        }),
      );
    } else if (!transcript.includes('"id":"show-synchronized-page-1"')) {
      await route.fulfill(
        toolResponse("show-synchronized-page-1", "show_lesson_page", {
          pageId: "synchronized-page-1",
        }),
      );
    } else if (
      transcript.includes("Background page entered") &&
      transcript.includes("synchronized-page-2") &&
      (transcript.match(/"name":"read_lesson_pages"/g) ?? []).length < 2
    ) {
      await route.fulfill(
        toolResponse("read-synchronized-page-2", "read_lesson_pages", {}),
      );
    } else if (
      transcript.includes("Background page entered") &&
      transcript.includes("synchronized-page-2") &&
      !transcript.includes('"id":"place-synchronized-page-2"')
    ) {
      await route.fulfill(
        toolResponse("place-synchronized-page-2", "place_lesson_page", {
          pageId: "synchronized-page-2",
          position: 2,
        }),
      );
    } else if (
      transcript.includes("继续讲这两页") &&
      !transcript.includes('"id":"advance-to-page-2"')
    ) {
      await route.fulfill(
        textAndToolResponse(
          "第一页讲解开始。\n\n需要慢慢读完第二行。",
          "advance-to-page-2",
          "show_next_lesson_page",
          {},
        ),
      );
    } else if (!transcript.includes("继续讲这两页")) {
      await route.fulfill(textResponse(""));
    } else {
      await route.fulfill(textResponse("现在讲解第二页。"));
    }
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill(`开始两页课程。${"这是一段很长的学习背景。".repeat(120)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/正在准备课件 · \d+ 秒/)).toBeVisible();
  await expect(
    page.getByText("课件正在后台生成，我可以继续响应。", { exact: true }),
  ).toBeVisible();
  finishPreparingFirstSlide();
  await expect.poll(() => secondSlidePublished).toBe(true);
  await page.waitForTimeout(100);
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("先展示第一页");
  await page.getByRole("button", { name: "发送" }).click();

  const slides = page.getByRole("region", { name: "课堂页面" });
  await expect(
    slides.getByRole("img", { name: "课件页面：第一页" }),
  ).toBeVisible();
  await expect(slides.getByRole("button", { name: "下一页" })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("继续讲这两页");
  await page.getByRole("button", { name: "发送" }).click();
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
  ).filter({ hasText: "第一页讲解开始。" });
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

  await page.setViewportSize({ width: 844, height: 898 });
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
  const copyBox = await page.locator(".course-card-copy").boundingBox();
  const menuButtonBox = await page
    .getByRole("button", { name: "管理课程：认识太阳系" })
    .boundingBox();
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
  expect(
    Math.abs((menuButtonBox?.width ?? 0) - (menuButtonBox?.height ?? 0)),
  ).toBeLessThan(1);
  expect(menuButtonBox?.y ?? 0).toBeGreaterThanOrEqual(copyBox?.y ?? Infinity);
  expect((menuButtonBox?.y ?? 0) - (copyBox?.y ?? 0)).toBeLessThanOrEqual(12);
  expect(
    (copyBox?.x ?? 0) +
      (copyBox?.width ?? 0) -
      ((menuButtonBox?.x ?? 0) + (menuButtonBox?.width ?? 0)),
  ).toBeLessThanOrEqual(12);
  await expect(page.getByText("太阳系基础", { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const wideCardBox = await page.locator(".course-card").boundingBox();
  const wideComposerBox = await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .boundingBox();
  const wideConversationBox = await page
    .getByRole("region", { name: "教学对话" })
    .boundingBox();
  const wideComposerFormBox = await page.locator(".course-composer").boundingBox();
  expect((wideCardBox?.y ?? 0) + (wideCardBox?.height ?? 0)).toBeLessThan(
    wideComposerBox?.y ?? 0,
  );
  expect(
    (wideComposerFormBox?.x ?? 0) + (wideComposerFormBox?.width ?? 0),
  ).toBeLessThanOrEqual(
    (wideConversationBox?.x ?? 0) + (wideConversationBox?.width ?? 0),
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
  expect(wideComposerBox?.height ?? Infinity).toBeLessThanOrEqual(64);
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
  await expect(
    page.locator(
      '.course-home-composer > [data-slot="input-group"]',
    ),
  ).toHaveCSS("border-radius", "30px");
  const workspaceBody = await page.locator(".workspace-body").boundingBox();
  expect(
    Math.abs(
      (courseComposer?.x ?? 0) + (courseComposer?.width ?? 0) / 2 -
        ((workspaceBody?.x ?? 0) + (workspaceBody?.width ?? 0) / 2),
    ),
  ).toBeLessThan(1);
  await page.setViewportSize({ width: 844, height: 898 });
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect
    .poll(async () => {
      const collapsedComposer = await page
        .locator(".course-home-composer")
        .boundingBox();
      const collapsedWorkspaceBody = await page
        .locator(".workspace-body")
        .boundingBox();
      return Math.abs(
        (collapsedComposer?.x ?? 0) + (collapsedComposer?.width ?? 0) / 2 -
          ((collapsedWorkspaceBody?.x ?? 0) +
            (collapsedWorkspaceBody?.width ?? 0) / 2),
      );
    })
    .toBeLessThan(1);
  await expect
    .poll(async () => {
      const collapsedComposer = await page
        .locator(".course-home-composer")
        .boundingBox();
      const collapsedWorkspaceBody = await page
        .locator(".workspace-body")
        .boundingBox();
      return (
        (collapsedWorkspaceBody?.width ?? 0) -
        (collapsedComposer?.width ?? 0)
      );
    })
    .toBe(80);
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
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
    "8px",
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

test("classroom pagination follows the agent sequence instead of pool order", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const slides = [
    {
      kind: "slide" as const,
      id: "shown-first",
      title: "第一张已展示页面",
      body: "第一页",
      bullets: [],
      layout: "explain" as const,
    },
    {
      kind: "animation" as const,
      id: "hidden-animation",
      title: "尚未展示的动画",
      layout: "horizontal" as const,
      nodes: [{ id: "node", shape: "rectangle" as const, label: "隐藏" }],
      edges: [],
      buttons: [
        {
          id: "play",
          label: "播放",
          steps: [[{ type: "highlight" as const, targetId: "node" }]],
        },
      ],
    },
    {
      kind: "coding" as const,
      id: "hidden-coding",
      title: "尚未展示的练习",
      instructions: "隐藏",
      languageId: 71,
      languageName: "Python",
      starterCode: "print('hidden')",
      code: "print('hidden')",
      stdin: "",
      status: "active" as const,
    },
    {
      kind: "slide" as const,
      id: "shown-second",
      title: "第二张已展示页面",
      body: "第二页",
      bullets: [],
      layout: "explain" as const,
    },
    {
      kind: "slide" as const,
      id: "shown-third",
      title: "第三张已展示页面",
      body: "第三页",
      bullets: [],
      layout: "explain" as const,
    },
  ];
  const state = {
    messages: [],
    pages: slides,
    presentedPageIds: ["shown-third", "shown-first", "shown-second"],
    currentPageId: "shown-second",
  };
  const conversation = {
    id: "mixed-conversation",
    sectionId: "mixed-section",
    title: "混合页面",
    state,
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
  };
  const course = {
    id: "mixed-course",
    conversationId: conversation.id,
    title: "混合课堂",
    topic: "验证课堂页面顺序",
    status: "active" as const,
    cover: {
      motif: "geometry" as const,
      palette: "sprout" as const,
      label: "ORDER",
    },
    state,
    sections: [
      {
        id: "mixed-section",
        title: "页面顺序",
        objective: "保持讲解与展示同步",
        position: 0,
        status: "active" as const,
        conversations: [conversation],
      },
    ],
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [course] } }),
  );

  await page.goto("/#/courses/mixed-course/conversations/mixed-conversation");

  const classroom = page.getByRole("region", { name: "课堂页面" });
  await expect(
    classroom.getByRole("img", { name: "课件页面：第二张已展示页面" }),
  ).toBeVisible();
  await expect(classroom.getByText("3 / 3", { exact: true })).toBeVisible();
  await expect(classroom.getByRole("button", { name: "上一页" })).toBeEnabled();
  await classroom.getByRole("button", { name: "上一页" }).click();
  await expect(
    classroom.getByRole("img", { name: "课件页面：第一张已展示页面" }),
  ).toBeVisible();
  await expect(classroom.getByText("2 / 3", { exact: true })).toBeVisible();
  await expect(classroom.getByRole("button", { name: "下一页" })).toBeEnabled();
});

test("additional slide templates render distinct teaching structures", async ({
  page,
}) => {
  await mockCompletedWorkspace(page);
  const pages = [
    {
      kind: "slide",
      id: "spotlight",
      title: "抓住核心概念",
      kicker: "重点",
      body: "用一句话建立清晰记忆。",
      bullets: ["关键词", "例子"],
      layout: "spotlight",
    },
    {
      kind: "slide",
      id: "cards",
      title: "三个观察角度",
      body: "把并列信息放进独立卡片。",
      bullets: ["形状", "颜色", "用途"],
      layout: "cards",
    },
    {
      kind: "slide",
      id: "timeline",
      title: "种子发芽过程",
      body: "沿时间顺序观察变化。",
      bullets: ["吸收水分", "长出根", "冒出嫩芽"],
      layout: "timeline",
    },
  ];
  const state = {
    messages: [],
    pages,
    presentedPageIds: pages.map(({ id }) => id),
    currentPageId: "spotlight",
  };
  const conversation = {
    id: "template-conversation",
    sectionId: "template-section",
    title: "模板课堂",
    state,
    createdAt: "2026-09-23T00:00:00Z",
    updatedAt: "2026-09-23T00:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({
      json: {
        courses: [
          {
            id: "template-course",
            conversationId: conversation.id,
            title: "多样课件",
            topic: "验证课件模板",
            status: "active",
            cover: { motif: "geometry", palette: "sprout", label: "LAYOUT" },
            state,
            sections: [
              {
                id: "template-section",
                title: "模板",
                objective: "用不同结构表达内容",
                position: 0,
                status: "active",
                conversations: [conversation],
              },
            ],
            createdAt: "2026-09-23T00:00:00Z",
            updatedAt: "2026-09-23T00:00:00Z",
          },
        ],
      },
    }),
  );

  await page.goto(
    "/#/courses/template-course/conversations/template-conversation",
  );
  const classroom = page.getByRole("region", { name: "课堂页面" });
  await expect(
    classroom.getByRole("group", { name: "重点聚焦模板" }),
  ).toBeVisible();
  await classroom.getByRole("button", { name: "下一页" }).click();
  await expect(
    classroom.getByRole("group", { name: "卡片网格模板" }),
  ).toBeVisible();
  await classroom.getByRole("button", { name: "下一页" }).click();
  await expect(
    classroom.getByRole("group", { name: "时间线模板" }),
  ).toBeVisible();
});

for (const background of [false, true]) {
test(`the teacher agent creates and persists a course from the first request${background ? " while another page is open" : ""}`, async ({
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
  let teacherReceivedAuthoritativeSection = false;
  const initialSectionId = "11111111-1111-4111-8111-111111111111";
  let releaseCreation = () => {};
  const creationGate = new Promise<void>((resolve) => { releaseCreation = resolve; });
  await page.route("**/api/courses", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { courses: [] } });
      return;
    }
    creation = route.request().postDataJSON() as typeof creation;
    if (background) await creationGate;
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
            id: index === 0 ? initialSectionId : `section-${index}`,
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
    `**/api/courses/course-agent/sections/${initialSectionId}/conversations`,
    async (route) => {
      conversationCreation = route.request().postDataJSON() as {
        title: string;
      };
      await route.fulfill({
        status: 201,
        json: {
          conversation: {
            id: "conversation-agent",
            sectionId: initialSectionId,
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
    teacherReceivedAuthoritativeSection =
      teacherReceivedAuthoritativeSection ||
      (transcript.includes("Background child-agent task completed") &&
        transcript.includes(initialSectionId));
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
          : !transcript.includes('"name":"create_course_conversation"') &&
              teacherReceivedAuthoritativeSection
            ? toolResponse(
                "start-fractions",
                "create_course_conversation",
                { sectionId: initialSectionId, title: "认识分数" },
              )
            : transcript.includes('"name":"create_course_conversation"')
              ? textResponse("我们从把一个苹果平均分开开始。")
              : textResponse("课程大纲正在后台建立。"),
    );
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "告诉知芽你想学什么" })
    .fill("我想理解分数");
  await page.getByRole("button", { name: "发送" }).click();

  if (background) {
    await expect.poll(() => creation).not.toBeNull();
    await page.getByRole("button", { name: "自由探索" }).click();
    releaseCreation();
    await expect.poll(() => persisted?.state?.messages?.map((message) => message.text))
      .toContain("我们从把一个苹果平均分开开始。");
    await expect(page).toHaveURL(/#\/explore$/);
    await expect(page.getByRole("heading", { name: "探索即将开放" })).toBeVisible();
  } else {
    await expect(
      page.getByText("我们从把一个苹果平均分开开始。", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/courses\/course-agent\/conversations\/conversation-agent$/);
  }
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
  expect(teacherReceivedAuthoritativeSection).toBe(true);
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
}

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
    if (transcript.includes("Background child-agent task completed")) {
      await route.fulfill(textResponse(""));
      return;
    }
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
  await page.route("**/api/courses/attachment-retry/conversation", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/learning/course/model", (route) => {
    modelRequests += 1;
    return route.fulfill(textResponse("不应发送这条请求。"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 入门" }).click();
  await page.getByRole("button", { name: "打开小节：变量" }).click();
  const input = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await expect(input).toBeVisible();
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
    if (transcript.includes("Background child-agent task completed")) {
      await route.fulfill(textResponse(""));
      return;
    }
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
    await route.fulfill(textResponse("课程大纲正在后台重新整理。"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：Python 项目" }).click();
  await page
    .getByRole("textbox", { name: "告诉知芽你想开始什么新的学习" })
    .fill("重新整理课程大纲");
  await page.getByRole("button", { name: "开始新的学习" }).click();

  await expect(
    page.getByText("课程大纲正在后台重新整理。", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => classificationRequest)
    .toContain("我正在给猜数字游戏加上最多五次机会。");
  await expect.poll(() => assignment).toMatchObject({
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
