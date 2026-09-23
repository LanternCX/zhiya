import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dictation start can be cancelled while the ASR socket is connecting", async () => {
  const source = await readFile(new URL("../src/components/ChatComposer.tsx", import.meta.url), "utf8");
  assert.match(source, /const recordingAttempt = useRef\(0\)/);
  assert.match(source, /const attempt = \+\+recordingAttempt\.current/);
  assert.match(source, /attempt !== recordingAttempt\.current/);
});

test("speech connection checks the current session before opening WebSocket", async () => {
  const source = await readFile(new URL("../src/transport/speech.ts", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/me",/);
  assert.match(source, /登录已失效，请重新登录/);
});
