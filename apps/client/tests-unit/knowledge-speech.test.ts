import assert from "node:assert/strict";
import test from "node:test";
import { ResponsePresenter } from "../src/features/voice/ResponsePresenter.ts";

test("spoken answers keep source citations on screen without reading their identifiers", () => {
  for (const reference of [
    `#knowledge/${"a".repeat(64)}/lesson-page-0048`,
    "#material/lesson/revision/L1-L3",
  ]) {
    const text = `训练数据用于学习。[课程资料](${reference})`;
    assert.deepEqual(ResponsePresenter.present(text, "speech"), {
      display_text: text,
      speech_text: "训练数据用于学习。",
    });
    assert.deepEqual(ResponsePresenter.present(text, "text"), {
      display_text: text,
      speech_text: text,
    });
  }
});
