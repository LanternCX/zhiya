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
