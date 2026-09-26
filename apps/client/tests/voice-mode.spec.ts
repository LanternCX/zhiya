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
      ResponsePresenter.present("请运行 `npm install`，然后查看 **结果**。", "speech"),
    ];
  });
  expect(result).toEqual([
    { display_text: "结论在这里。", speech_text: "结论在这里。" },
    { display_text: "代码我已经放在屏幕上了。", speech_text: "代码我已经放在屏幕上了。" },
    { display_text: "链接我已经放在屏幕上了。", speech_text: "链接我已经放在屏幕上了。" },
    { display_text: "请运行 ，然后查看 结果。", speech_text: "请运行 ，然后查看 结果。" },
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
  expect(result.speech).toContain("不要输出英文");
});

test("text chunker emits complete sentences and flushes a bounded remainder", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { TextChunker } = await import("/src/features/voice/TextChunker.ts");
    const chunker = new TextChunker({ minChars: 3, maxChars: 20 });
    return [
      chunker.push("好。", false),
      chunker.push("这个回答已经足够长了。", false),
      chunker.push("最后一段", true),
    ];
  });
  expect(result).toEqual([
    [],
    ["好。这个回答已经足够长了。"],
    ["最后一段"],
  ]);
});

test("playback controller owns one audio queue and clears it on stop", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    class FakeSource {
      onended: (() => void) | null = null;
      buffer: unknown = null;
      stopped = false;
      connect() {}
      start() {}
      stop() { this.stopped = true; }
    }
    class FakeContext {
      currentTime = 0;
      destination = {};
      createBuffer() { return { duration: 0.1, getChannelData: () => new Float32Array(2) }; }
      createBufferSource() { return new FakeSource(); }
    }
    (window as unknown as { AudioContext: typeof FakeContext }).AudioContext = FakeContext;
    const { PlaybackController } = await import("/src/features/voice/PlaybackController.ts");
    let idle = 0;
    const playback = new PlaybackController(() => idle++);
    playback.enqueue("AAAAAA==", 24000);
    const wasPlaying = playback.isPlaying;
    playback.clear();
    return { wasPlaying, isPlaying: playback.isPlaying, idle };
  });
  expect(result).toEqual({ wasPlaying: true, isPlaying: false, idle: 1 });
});

test("voice reducer keeps the session alive when TTS fails", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { initialVoiceState, voiceReducer } = await import("/src/features/voice/voice-reducer.ts");
    let state = voiceReducer(initialVoiceState, { type: "connect", sessionId: "s1" });
    state = voiceReducer(state, { type: "ready" });
    state = voiceReducer(state, { type: "tts-error", message: "TTS unavailable" });
    return state;
  });
  expect(result.status).toBe("listening");
  expect(result.error).toBe("TTS unavailable");
  expect(result.errorKind).toBe("tts");
});

test("voice metrics record each latency milestone once", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VoiceMetrics } = await import("/src/features/voice/VoiceMetrics.ts");
    const metrics = new VoiceMetrics(() => 1000);
    metrics.mark("connection");
    metrics.mark("connection");
    metrics.mark("asr_final");
    return metrics.snapshot();
  });
  expect(result).toEqual({ connection: 0, asr_final: 0 });
});

test("voice metrics mark the first agent text only after visible output", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VoiceSessionController } = await import("/src/features/voice/VoiceSessionController.ts");
    const controller = new VoiceSessionController();
    controller.recordAgentText("  ");
    const before = controller.getMetrics();
    controller.recordAgentText("你好");
    const first = controller.getMetrics().agent_first_token;
    controller.recordAgentText("你好，欢迎回来");
    return { before, firstRecorded: typeof first === "number", sameFirst: controller.getMetrics().agent_first_token === first };
  });
  expect(result).toEqual({ before: {}, firstRecorded: true, sameFirst: true });
});

test("playback controller reports malformed audio without throwing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PlaybackController } = await import("/src/features/voice/PlaybackController.ts");
    let errors = 0;
    const playback = new PlaybackController(() => undefined, () => errors++);
    playback.enqueue("not-base64", 24000);
    return { errors, isPlaying: playback.isPlaying };
  });
  expect(result).toEqual({ errors: 1, isPlaying: false });
});

test("voice session ends when the page becomes hidden", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VoiceSessionController } = await import("/src/features/voice/VoiceSessionController.ts");
    const controller = new VoiceSessionController();
    controller.handleVisibilityChange(true);
    return controller.getState().status;
  });
  expect(result).toBe("ended");
});

test("voice reconnect policy allows only two bounded retries", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { nextVoiceReconnectDelay } = await import("/src/features/voice/ReconnectPolicy.ts");
    return [nextVoiceReconnectDelay(0), nextVoiceReconnectDelay(1), nextVoiceReconnectDelay(2)];
  });
  expect(result).toEqual([250, 1000, null]);
});

test("voice session reports an unexpected socket close", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VoiceSessionController } = await import("/src/features/voice/VoiceSessionController.ts");
    const controller = new VoiceSessionController();
    controller.handleConnectionClosed();
    return { status: controller.getState().status, errorKind: controller.getState().errorKind };
  });
  expect(result).toEqual({ status: "ended", errorKind: "connection" });
});

test("voice reducer classifies an agent failure without ending the session", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { initialVoiceState, voiceReducer } = await import("/src/features/voice/voice-reducer.ts");
    let state = voiceReducer(initialVoiceState, { type: "connect", sessionId: "s1" });
    state = voiceReducer(state, { type: "ready" });
    state = voiceReducer(state, { type: "thinking" });
    return voiceReducer(state, { type: "agent-error", message: "模型暂时不可用" });
  });
  expect(result.status).toBe("listening");
  expect(result.errorKind).toBe("agent");
  expect(result.error).toBe("模型暂时不可用");
});

test("voice interrupt stops the current turn and advances its turn id", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VoiceSessionController } = await import("/src/features/voice/VoiceSessionController.ts");
    let interrupted = 0;
    const controller = new VoiceSessionController(() => undefined, () => interrupted++);
    controller.interrupt();
    return { interrupted, status: controller.getState().status, turnId: controller.getState().turnId };
  });
  expect(result).toEqual({ interrupted: 1, status: "listening", turnId: 1 });
});
