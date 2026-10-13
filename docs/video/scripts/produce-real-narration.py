# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Synthesize short semantic units, preserving silent demo intervals."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("doubao", ROOT / "scripts/narrate-doubao.py")
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)
STYLE = (
    "你正在给第一次了解知芽的老师解释一个真实项目。像自然交流，不要播音或念说明书。"
    "问题句稍慢，留出思考感；操作描述清楚轻快；结尾自然落下。"
    "根据标点正常停顿换气，不要一口气说完，也不要刻意逐字读。"
    "这句话接在同一节初一Python入门课的备课过程中，保持上下文一致。"
)

story = json.loads((ROOT / "src/real/story.json").read_text())
timeline = []
offset = 0
for chapter in story:
    units = []
    for index, unit in enumerate(chapter["voices"]):
        name = f'{chapter["id"]}-{index}'
        wav = ROOT / "public/voice-real" / f"{name}.wav"
        text_file = wav.with_suffix(".txt")
        if wav.exists() and text_file.exists() and text_file.read_text() == unit["text"]:
            metadata = json.loads(wav.with_suffix(".json").read_text())
        else:
            metadata = tts.synthesize(unit["text"], wav, STYLE)
            text_file.write_text(unit["text"])
        next_at = chapter["voices"][index + 1]["at"] if index + 1 < len(chapter["voices"]) else chapter["seconds"]
        if unit["at"] + metadata["duration"] > next_at - 1:
            raise RuntimeError(f"{name}: narration leaves less than one second to breathe")
        captions = []
        for sentence in metadata.get("sentences", []):
            words = sentence.get("words", [])
            group = []
            for word in words:
                group.append(word)
                text = "".join(w["word"] for w in group)
                if text.endswith(("，", "。", "？", "！", "：", "；", "、")) or len(text) >= 24:
                    captions.append({"text": text, "start": group[0]["startTime"], "end": group[-1]["endTime"]})
                    group = []
            if group:
                captions.append({"text": "".join(w["word"] for w in group), "start": group[0]["startTime"], "end": group[-1]["endTime"]})
        units.append({**unit, "file": f"voice-real/{name}.wav", "duration": metadata["duration"], "captions": captions})
    timeline.append({**chapter, "from": offset, "voices": units})
    offset += chapter["seconds"]
if offset != 600:
    raise RuntimeError(f"Expected 600 seconds, received {offset}")
(ROOT / "src/real/timing.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2))
print(f"Ready: {offset}s; {sum(len(c['voices']) for c in timeline)} speech units; explicit silence between units")
