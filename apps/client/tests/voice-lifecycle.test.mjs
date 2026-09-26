import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live voice startup clears the controller when connection fails", async () => {
  const source = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  assert.match(source, /controller\.end\(\)/);
  assert.match(source, /setLiveVoice\(false\)/);
  assert.match(source, /controller\.start\(\{ capture: false \}\)/);
  assert.match(source, /voiceController\.current\?\.end\(\)/);
  assert.match(source, /narrationPlayer\.current\?\.dispose\(\)/);
});

test("composer surfaces dictation failures instead of hiding them", async () => {
  const room = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  const overview = await readFile(new URL("../src/features/course/CourseOverview.tsx", import.meta.url), "utf8");
  assert.match(room, /onVoiceError=\{setError\}/);
  assert.match(overview, /onVoiceError=\{setComposerError\}/);
});

test("composer exposes the live dictation transcript", async () => {
  const composer = await readFile(new URL("../src/components/ChatComposer.tsx", import.meta.url), "utf8");
  assert.match(composer, /chat-dictation-text/);
  assert.match(composer, /dictationDraft/);
  assert.match(composer, /dictationCommitted/);
  assert.match(composer, /event\.final/);
});

test("course narration is gated by the explicit voice mode", async () => {
  const room = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /if \(!liveVoice\)/);
  assert.match(room, /voiceController\.current\?\.speakText/);
});

test("composer resizes after text is inserted programmatically", async () => {
  const composer = await readFile(new URL("../src/components/ChatComposer.tsx", import.meta.url), "utf8");
  assert.match(composer, /refreshInputLayout/);
  assert.match(composer, /controller\.textInput\.value/);
  assert.match(composer, /ref=\{textareaRef\}/);
});

test("voice mode unlocks audio playback from the explicit start action", async () => {
  const controller = await readFile(new URL("../src/features/voice/VoiceSessionController.ts", import.meta.url), "utf8");
  const playback = await readFile(new URL("../src/features/voice/PlaybackController.ts", import.meta.url), "utf8");
  assert.match(controller, /this\.playback\.resume\(\)/);
  assert.match(playback, /resume\(\)/);
});

test("live dictation keeps the newest transcript visible", async () => {
  const composer = await readFile(new URL("../src/components/ChatComposer.tsx", import.meta.url), "utf8");
  assert.match(composer, /dictationTextRef/);
  assert.match(composer, /scrollTop = .*scrollHeight/);
});

test("conversation and composer scrolling stay usable without visible scrollbars", async () => {
  const courseCss = await readFile(new URL("../src/features/course/course.css", import.meta.url), "utf8");
  const composerCss = await readFile(new URL("../src/components/chat-composer.css", import.meta.url), "utf8");
  assert.match(courseCss, /\.course-thread[\s\S]*scrollbar-width: none/);
  assert.match(composerCss, /\.chat-composer-multiline textarea[\s\S]*scrollbar-width: none/);
});

test("voice TTS waits for the session to become ready and reports failures", async () => {
  const controller = await readFile(new URL("../src/features/voice/VoiceSessionController.ts", import.meta.url), "utf8");
  const room = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  assert.match(controller, /this\.speechQueue\.push\(normalized\)/);
  assert.match(controller, /this\.pumpSpeechQueue\(\)/);
  assert.match(room, /controller\.subscribe/);
  assert.match(await readFile(new URL("../src/features/voice/PlaybackController.ts", import.meta.url), "utf8"), /context\.state === "suspended"/);
});

test("voice responses release the course running state after text streaming ends", async () => {
  const room = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  assert.match(room, /if \(!latest\.streaming\).*finishNarration/s);
});
