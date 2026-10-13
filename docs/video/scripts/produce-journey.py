# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Build the continuous teacher journey after the approved opening."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tts", ROOT / "scripts/narrate-doubao.py")
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)
story = json.loads((ROOT / "src/real/journey.json").read_text())
timeline = []
offset = 56.2
for scene in story:
    units = []
    cursor = .5
    for index, unit in enumerate(scene["units"]):
        wav = ROOT / "public/voice-journey" / f'{scene["id"]}-{index}.wav'
        cache = wav.with_suffix(".txt")
        if wav.exists() and cache.exists() and cache.read_text() == unit["text"]:
            meta = json.loads(wav.with_suffix(".json").read_text())
        else:
            meta = tts.synthesize(unit["text"], wav, "面向第一次了解知芽的老师，自然交流。每段是一个完整意思，连贯讲述，列举不要逐项断开。问题和转折稍作语义停顿；重点清楚，次要信息轻轻带过。不要播音腔，不刻意拖慢或夸张换气。")
            cache.write_text(unit["text"])
        captions = []
        for sentence in meta.get("sentences", []):
            group = []
            for word in sentence.get("words", []):
                group.append(word)
                text = "".join(w["word"] for w in group)
                if text.endswith(("，", "。", "？", "！", "：", "；")) or len(text) >= 25:
                    captions.append({"text": text,"start":group[0]["startTime"],"end":group[-1]["endTime"]})
                    group = []
            if group:
                captions.append({"text":"".join(w["word"] for w in group),"start":group[0]["startTime"],"end":group[-1]["endTime"]})
        units.append({**unit,"at":round(cursor,3),"duration":meta["duration"],"file":f"voice-journey/{wav.name}","captions":captions})
        cursor += meta["duration"] + unit["watch"]
    if cursor > scene["seconds"]:
        raise RuntimeError(f'{scene["id"]}: {cursor:.2f}s exceeds {scene["seconds"]}s; edit narration rather than speed it up')
    spare = max(0, scene["seconds"] - cursor - 2.5)
    if len(units) > 2:
        units[1]["at"] = round(units[1]["at"] + spare / 2, 3)
        units[2]["at"] = round(units[2]["at"] + spare, 3)
        cursor += spare
    timeline.append({**scene,"from":round(offset,3),"units":units,"tail":round(scene["seconds"]-cursor,3)})
    offset += scene["seconds"]
    print(scene["id"], "speech/action",round(cursor,2),"tail",round(scene["seconds"]-cursor,2),flush=True)
assert abs(offset-600)<.01, offset
(ROOT / "src/real/journey-timing.json").write_text(json.dumps(timeline,ensure_ascii=False,indent=2))
