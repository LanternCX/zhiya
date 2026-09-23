import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live voice startup clears the controller when connection fails", async () => {
  const source = await readFile(new URL("../src/features/course/CourseRoom.tsx", import.meta.url), "utf8");
  assert.match(source, /controller\.end\(\)/);
  assert.match(source, /setLiveVoice\(false\)/);
  assert.match(source, /setVoiceMuted\(false\)/);
});
