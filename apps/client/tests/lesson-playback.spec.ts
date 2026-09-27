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

test("voice replies hold the teaching turn until speech playback completes", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSocket = window.WebSocket;
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    class FakeNode { connect() {} disconnect() {} }
    class FakeContext {
      sampleRate = 48000;
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
    }
    window.AudioContext = FakeContext as unknown as typeof AudioContext;
    const voice = window as Window & {
      voiceCommands: string[];
      finishVoice: (() => void) | null;
    };
    voice.voiceCommands = [];
    voice.finishVoice = null;
    class VoiceSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        window.setTimeout(() => { this.readyState = 1; this.onopen?.(); });
      }
      addEventListener() {}
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      send(raw: string) {
        const command = JSON.parse(raw);
        voice.voiceCommands.push(command.type);
        if (command.type === "start-session") {
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "session-ready", sessionId: command.sessionId, turnId: command.turnId,
          }) }));
        }
        if (command.type === "speak-text") {
          voice.finishVoice = () => this.onmessage?.({ data: JSON.stringify({
            type: "tts-complete", sessionId: command.sessionId, turnId: command.turnId,
          }) });
        }
      }
    }
    class SpeechSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() { window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
      addEventListener() {}
      close() { this.readyState = 3; }
      send(raw: string) {
        if (JSON.parse(raw).type === "start") window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }));
      }
    }
    window.WebSocket = new Proxy(nativeSocket, {
      construct(target, args) {
        if (String(args[0]).includes("/api/speech/stream")) return new SpeechSocket() as unknown as WebSocket;
        return String(args[0]).includes("/api/voice/session")
          ? new VoiceSocket() as unknown as WebSocket
          : Reflect.construct(target, args);
      },
    });
  });
  await classroom(page);
  let modelCalls = 0;
  let releaseSecondModel = () => {};
  const secondModel = new Promise<void>((resolve) => { releaseSecondModel = resolve; });
  await page.route("**/api/learning/course/model", async (route) => {
    modelCalls += 1;
    if (modelCalls === 2) await secondModel;
    await route.fulfill(response(modelCalls === 1 ? "你好。" : "不应出现的旧回答。"));
  });
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("switch", { name: "语音播报" }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("你好");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as Window & { voiceCommands: string[] }).voiceCommands,
  )).toContain("speak-text");
  await expect(page.getByRole("button", { name: "打断" })).toBeVisible();
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("下一条草稿");
  await expect(page.getByRole("button", { name: "打断", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "打断", exact: true }).click();
  await page.evaluate(() =>
    (window as Window & { finishVoice: (() => void) | null }).finishVoice?.(),
  );
  await expect(page.getByRole("button", { name: "打断" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "告诉知芽你想学什么" })).toHaveValue("下一条草稿");
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("再问一次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => modelCalls).toBe(2);
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("switch", { name: "语音播报" }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(page.getByRole("button", { name: "打断" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打断" })).toHaveCount(0);
  releaseSecondModel();
  await expect(page.getByText("不应出现的旧回答。")).toHaveCount(0);
});

test("course overview keeps speech output independent from microphone input", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSocket = window.WebSocket;
    const voice = window as Window & { voiceCommands: string[]; disconnectVoice: (() => void) | null; asrStarts: number };
    voice.voiceCommands = [];
    voice.disconnectVoice = null;
    voice.asrStarts = 0;
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    class FakeNode { connect() {} disconnect() {} }
    class FakeContext {
      sampleRate = 48000;
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
    }
    window.AudioContext = FakeContext as unknown as typeof AudioContext;
    class SpeechSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() { window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
      addEventListener() {}
      close() { this.readyState = 3; }
      send(raw: string) {
        if (JSON.parse(raw).type === "start") {
          voice.asrStarts += 1;
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }));
        }
      }
    }
    class VoiceSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      constructor() {
        voice.disconnectVoice = () => { this.readyState = 3; this.onclose?.({ code: 1006 }); };
        window.setTimeout(() => { this.readyState = 1; this.onopen?.(); });
      }
      addEventListener() {}
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      send(raw: string) {
        const command = JSON.parse(raw);
        voice.voiceCommands.push(command.type);
        if (command.type === "start-session") {
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "session-ready", sessionId: command.sessionId, turnId: command.turnId,
          }) }));
        }
        if (command.type === "speak-text") {
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({
            type: "tts-complete", sessionId: command.sessionId, turnId: command.turnId,
          }) }));
        }
      }
    }
    window.WebSocket = new Proxy(nativeSocket, {
      construct(target, args) {
        if (String(args[0]).includes("/api/speech/stream")) return new SpeechSocket() as unknown as WebSocket;
        return String(args[0]).includes("/api/voice/session")
          ? new VoiceSocket() as unknown as WebSocket
          : Reflect.construct(target, args);
      },
    });
  });
  await classroom(page);
  await page.route("**/api/socket-ticket", (route) => route.fulfill({ json: { ticket: "voice-test-ticket" } }));
  await page.goto("/#/courses/course");
  await page.route("**/api/learning/course/model", (route) => route.fulfill(response("开始学习。")));
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("switch", { name: "语音播报" }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(page).toHaveURL(/\/courses\/course$/);
  await page.getByRole("textbox").fill("开始学习");
  await page.getByRole("button", { name: "开始新的学习", exact: true }).click();
  await expect(page).toHaveURL(/\/courses\/course\/conversations\/new/);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { voiceCommands: string[] }).voiceCommands,
  )).toContain("start-session");
  await expect(page.getByRole("button", { name: "进入语音对话" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts)).toBe(0);
  await page.evaluate(() => (window as Window & { disconnectVoice: (() => void) | null }).disconnectVoice?.());
  await expect(page.getByRole("button", { name: "进入语音对话" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "告诉知芽你想学什么" })).toBeEnabled();
  await page.goto("/#/learn");
  await page.getByRole("button", { name: "进入语音对话" }).click();
  await expect(page.getByRole("button", { name: "退出语音对话" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "告诉知芽你想学什么" })).toHaveCount(0);
  await page.locator(".chat-composer").screenshot({ path: "/tmp/zhiya-voice-dialogue.png" });
});

test("dictation waits for the final transcript before it can be used", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSocket = window.WebSocket;
    const audio = window as Window & { microphoneStopped: boolean };
    audio.microphoneStopped = false;
    Object.defineProperty(navigator, "mediaDevices", { value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => { audio.microphoneStopped = true; } }] }),
    } });
    class FakeNode { connect() {} disconnect() {} }
    class FakeContext {
      sampleRate = 48000;
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
      createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 256, smoothingTimeConstant: 0, getByteTimeDomainData: () => {} }); }
    }
    window.AudioContext = FakeContext as unknown as typeof AudioContext;
    class SpeechSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
      addEventListener() {}
      close() { this.readyState = 3; }
      send(raw: string) {
        const command = JSON.parse(raw);
        if (command.type === "start") {
          this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
          this.onmessage?.({ data: JSON.stringify({ type: "transcript", text: "先说", final: false }) });
        }
        if (command.type === "stop") window.setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify({ type: "transcript", text: "先说后说", final: true }) });
          this.onmessage?.({ data: JSON.stringify({ type: "complete" }) });
        }, 1800);
      }
    }
    window.WebSocket = new Proxy(nativeSocket, {
      construct(target, args) {
        return String(args[0]).includes("/api/speech/stream")
          ? new SpeechSocket() as unknown as WebSocket
          : Reflect.construct(target, args);
      },
    });
  });
  await classroom(page);
  await page.route("**/api/socket-ticket", (route) => route.fulfill({ json: { ticket: "voice-test-ticket" } }));
  await page.getByRole("button", { name: "开始听写", exact: true }).click();
  await expect(page.getByLabel("实时听写内容")).toContainText("先说");
  await page.getByRole("button", { name: "停止听写" }).click();
  await expect(page.getByLabel("实时听写内容")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "告诉知芽你想学什么" })).toHaveValue("先说后说");
  expect(await page.evaluate(() => (window as Window & { microphoneStopped: boolean }).microphoneStopped)).toBe(true);
});

test("voice dialogue listens during playback and new speech interrupts the current answer", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSocket = window.WebSocket;
    const state = window as Window & {
      voiceCommands: string[];
      asrStarts: number;
      emitSpeech: (text: string, final?: boolean) => void;
      disconnectAsr: () => void;
    };
    state.voiceCommands = [];
    state.asrStarts = 0;
    Object.defineProperty(navigator, "mediaDevices", { value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    } });
    class FakeNode { connect() {} disconnect() {} }
    class FakeContext {
      sampleRate = 48000;
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
    }
    window.AudioContext = FakeContext as unknown as typeof AudioContext;
    class SpeechSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      constructor() {
        window.setTimeout(() => { this.readyState = 1; this.onopen?.(); });
        state.emitSpeech = (text, final = true) => this.onmessage?.({ data: JSON.stringify({ type: "transcript", text, final }) });
        state.disconnectAsr = () => { this.readyState = 3; this.onclose?.({ code: 1006 }); };
      }
      addEventListener() {}
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      send(raw: string) {
        const command = JSON.parse(raw);
        if (command.type === "start") {
          state.asrStarts += 1;
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }));
        }
        if (command.type === "stop") {
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "complete" }) }));
        }
      }
    }
    class VoiceSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      constructor() { window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
      addEventListener() {}
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      send(raw: string) {
        const command = JSON.parse(raw);
        state.voiceCommands.push(command.type);
        if (command.type === "start-session") {
          window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "session-ready", sessionId: command.sessionId, turnId: command.turnId }) }));
        }
        if (command.type === "speak-text") {
          if (state.voiceCommands.filter((type) => type === "speak-text").length === 1)
            window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "tts-complete", sessionId: command.sessionId, turnId: command.turnId }) }), 250);
        }
      }
    }
    window.WebSocket = new Proxy(nativeSocket, {
      construct(target, args) {
        const url = String(args[0]);
        if (url.includes("/api/speech/stream")) return new SpeechSocket() as unknown as WebSocket;
        if (url.includes("/api/voice/session")) return new VoiceSocket() as unknown as WebSocket;
        return Reflect.construct(target, args);
      },
    });
  });
  await classroom(page);
  await page.route("**/api/socket-ticket", (route) => route.fulfill({ json: { ticket: "voice-test-ticket" } }));
  await page.route("**/api/learning/course/model", (route) => route.fulfill(response("我们开始学习。")));
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("保留的草稿");
  await page.getByRole("button", { name: "进入语音对话" }).click();
  await expect(page.getByRole("button", { name: "退出语音对话" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "告诉知芽你想学什么" })).toHaveCount(0);
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  const initialStarts = await page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts);
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string, final?: boolean) => void }).emitSpeech("帮我", false));
  await expect(page.getByLabel("实时听写内容")).toContainText("帮我");
  await page.waitForTimeout(400);
  await expect(page.locator(".course-message.user")).toHaveCount(0);
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("帮我学"));
  await page.waitForTimeout(500);
  await expect(page.locator(".course-message.user")).toHaveCount(0);
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("编程"));
  await expect(page.locator(".course-message.user").last()).toContainText("帮我学编程");
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands)).toContain("speak-text");
  await expect.poll(() => page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts)).toBe(initialStarts + 1);
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("再讲一次"));
  await expect(page.locator(".course-message.user").last()).toContainText("再讲一次");
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands.filter((type) => type === "speak-text").length)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts)).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".chat-composer-submit-tools button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "打断" })).toBeVisible();
  await expect(page.getByRole("button", { name: "退出语音对话" })).toBeVisible();
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("换个问题"));
  await expect(page.locator(".course-message.user").last()).toContainText("换个问题");
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands)).toContain("cancel-tts");
  await expect.poll(() => page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts)).toBeGreaterThanOrEqual(4);
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands.filter((type) => type === "speak-text").length)).toBe(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "退出语音对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打断" })).toBeDisabled();
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  await page.getByRole("button", { name: "暂停麦克风" }).click();
  await expect(page.getByLabel("实时听写内容")).toContainText("麦克风已暂停");
  const startsWhilePaused = await page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts);
  await page.getByRole("button", { name: "继续语音对话" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { asrStarts: number }).asrStarts)).toBeGreaterThan(startsWhilePaused);
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("尚未发送"));
  await page.getByRole("button", { name: "退出语音对话" }).click();
  const draft = page.getByRole("textbox", { name: "告诉知芽你想学什么" });
  await expect(draft).toHaveValue("保留的草稿尚未发送");
  await page.waitForTimeout(1400);
  await expect(page.locator(".course-message.user").last()).toContainText("换个问题");
  const spokenBefore = await page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands.filter((type) => type === "speak-text").length);
  await draft.fill("编辑后的问题");
  await page.getByRole("button", { name: "开始听写", exact: true }).click();
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  await page.evaluate(() => (window as Window & { emitSpeech: (text: string) => void }).emitSpeech("补充内容"));
  await page.waitForTimeout(1400);
  await expect(page.locator(".course-message.user").last()).toContainText("换个问题");
  await page.getByRole("button", { name: "停止听写" }).click();
  await expect(draft).toHaveValue("编辑后的问题补充内容");
  await draft.fill("最终编辑的问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".course-message.user").last()).toContainText("最终编辑的问题");
  await expect(page.getByRole("button", { name: "打断", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands.filter((type) => type === "speak-text").length)).toBe(spokenBefore);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const buttons = page.locator(".chat-composer-submit-tools button");
    await expect(buttons).toHaveCount(3);
    for (const button of await buttons.all()) await expect(button).toBeInViewport();
  }
  // A voice conversation temporarily enables playback without changing the preference.
  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(page.getByRole("switch", { name: "语音播报" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "语音播报" }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "进入语音对话" }).click();
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  await page.getByRole("button", { name: "退出语音对话" }).click();
  await draft.fill("退出对话后仍然播报");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceCommands: string[] }).voiceCommands.filter((type) => type === "speak-text").length)).toBeGreaterThan(spokenBefore);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "进入语音对话" }).click();
  await expect(page.getByLabel("实时听写内容")).toContainText("正在听取");
  await page.evaluate(() => (window as Window & { disconnectAsr: () => void }).disconnectAsr());
  await expect(page.getByRole("alert")).toContainText("语音识别连接已断开");
  await expect(page.getByRole("button", { name: "继续语音对话" })).toBeVisible();
  await page.getByRole("button", { name: "退出语音对话" }).click();
  await expect(draft).toBeEditable();
  await page.reload();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(page.getByRole("switch", { name: "语音播报" })).toHaveAttribute("aria-checked", "true");
});

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
  let lateResponseReturned = false;
  await page.route("**/api/learning/course/model", async (route) => {
    const request = route.request().postDataJSON();
    const messages = request.payload.messages;
    const transcript = JSON.stringify(messages);
    if (request.agent === "slides") {
      const count = messages.filter(
        (message: { role: string }) => message.role === "tool",
      ).length;
      if (count > 1) {
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
      if (count === 1) lateResponseReturned = true;
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
  await page.getByRole("button", { name: "打断", exact: true }).click();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("先回答你的问题，原来的切页已经停止。", { exact: true }),
  ).toBeVisible();
  release();
  await expect.poll(() => lateResponseReturned).toBe(true);
  await expect.poll(() => course.state.pages.map((page) => page.title)).not.toContain("迟到的第二页");
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

test("a new question after interruption survives late teacher text updates", async ({
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
  await page.getByRole("button", { name: "打断", exact: true }).click();
  await expect(prompt).toHaveValue("变量为什么叫变量？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("finish-lesson-text")),
  );
  await expect(page.getByText("收到你的问题。", { exact: true })).toBeVisible();
  await expect(page.getByText("讲解的后半段。", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("变量为什么叫变量？", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".course-message.user")).toHaveCount(2);
});
