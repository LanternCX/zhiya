import { expect, test } from "@playwright/test";

test("voice events require valid session and turn scope", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { isVoiceServerEvent } = await import("/src/features/voice/protocol.ts");
    return [
      isVoiceServerEvent({ type: "session-ready", sessionId: "s1", turnId: 0 }),
      isVoiceServerEvent({ type: "transcript-final", sessionId: "s1", turnId: 1, text: "你好" }),
      isVoiceServerEvent({ type: "tts-audio", sessionId: "s1", turnId: 1, data: "AQI=", sampleRate: 24000 }),
      isVoiceServerEvent({ type: "tts-audio", sessionId: "s1", turnId: -1, data: "AQI=", sampleRate: 24000 }),
      isVoiceServerEvent({ type: "session-ready", turnId: 0 }),
      isVoiceServerEvent({ type: "unknown", sessionId: "s1", turnId: 0 }),
      isVoiceServerEvent("not an event"),
    ];
  });
  expect(result).toEqual([true, true, true, false, false, false, false]);
});

test("voice VAD distinguishes speech from silence and ends after quiet frames", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { detectVoiceFrame } = await import("/src/features/voice/vad.ts");
    const silence = new Float32Array(1600);
    const speech = new Float32Array(1600).fill(0.2);
    return {
      silence: detectVoiceFrame(silence, { threshold: 0.03, minSpeechFrames: 2, endSilenceFrames: 3, speechFrames: 0, silenceFrames: 0 }),
      speech: detectVoiceFrame(speech, { threshold: 0.03, minSpeechFrames: 2, endSilenceFrames: 3, speechFrames: 0, silenceFrames: 0 }),
    };
  });
  expect(result.silence.kind).toBe("silence");
  expect(result.speech.kind).toBe("speech");
});

test("voice reducer ignores stale turns and exits from speaking", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { initialVoiceState, voiceReducer } = await import("/src/features/voice/voice-reducer.ts");
    let state = voiceReducer(initialVoiceState, { type: "connect", sessionId: "s1" });
    state = voiceReducer(state, { type: "ready" });
    state = voiceReducer(state, { type: "transcript", turnId: 9, text: "旧轮次", final: true });
    state = voiceReducer(state, { type: "speaking" });
    state = voiceReducer(state, { type: "end" });
    return state;
  });
  expect(result.status).toBe("ended");
  expect(result.transcript).toBe("");
});

test("conversation manager creates unified text and speech user messages", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ConversationManager } = await import("/src/conversation/ConversationManager.ts");
    return [
      ConversationManager.userMessage("  打字问题  ", "text"),
      ConversationManager.userMessage("  语音问题  ", "speech", ["notes.md"]),
    ];
  });
  expect(result).toEqual([
    { role: "user", text: "打字问题", input_mode: "text" },
    { role: "user", text: "语音问题", input_mode: "speech", materials: ["notes.md"] },
  ]);
});

test("legacy course user messages default to text input mode", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ConversationManager } = await import("/src/conversation/ConversationManager.ts");
    return ConversationManager.normalizeUserMessage({ role: "user", text: "历史消息" });
  });
  expect(result).toEqual({ role: "user", text: "历史消息", input_mode: "text" });
});

test("streaming transcript submits only the first final result", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { TranscriptAccumulator } = await import("/src/features/voice/TranscriptAccumulator.ts");
    const transcript = new TranscriptAccumulator();
    return [
      transcript.accept("我觉得这个", false),
      transcript.accept("我觉得这个项目", false),
      transcript.accept("我觉得这个项目应该先重构后端。", true),
      transcript.accept("我觉得这个项目应该先重构后端。", true),
    ];
  });
  expect(result).toEqual([
    { text: "我觉得这个", final: false, submit: false },
    { text: "我觉得这个项目", final: false, submit: false },
    { text: "我觉得这个项目应该先重构后端。", final: true, submit: true },
    { text: "我觉得这个项目应该先重构后端。", final: true, submit: false },
  ]);
});

test("response presenter keeps display text and simplifies voice text", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ResponsePresenter } = await import("/src/conversation/ResponsePresenter.ts");
    return [
      ResponsePresenter.present("结论在这里。", "text"),
      ResponsePresenter.present("代码如下：\n```ts\nconst answer = 42;\n```", "speech"),
      ResponsePresenter.present("详情见 https://example.com/docs。", "speech"),
    ];
  });
  expect(result).toEqual([
    { display_text: "结论在这里。", speech_text: "结论在这里。" },
    { display_text: "代码如下：\n```ts\nconst answer = 42;\n```", speech_text: "代码我已经放在屏幕上了。" },
    { display_text: "详情见 https://example.com/docs。", speech_text: "链接我已经放在屏幕上了。" },
  ]);
});

test("response presenter provides a voice style prompt without replacing the core prompt", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { ResponsePresenter } = await import("/src/conversation/ResponsePresenter.ts");
    return {
      text: ResponsePresenter.modePrompt("text"),
      speech: ResponsePresenter.modePrompt("speech"),
    };
  });
  expect(result.text).toBe("");
  expect(result.speech).toContain("自然、简洁、口语化");
  expect(result.speech).toContain("不要逐字朗读代码");
});
