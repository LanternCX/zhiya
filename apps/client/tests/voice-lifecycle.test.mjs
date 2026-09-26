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
