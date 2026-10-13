# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Generate concise narration without stretching speech to fill scene lengths."""
import importlib.util
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tts", root / "scripts/narrate-doubao.py")
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)
story = json.loads((root / "src/real/compact.json").read_text())
opening = json.loads((root / "src/real/timing.json").read_text())[0]["voices"][0]
offset = 0
for scene in story:
    if scene["id"] == "opening":
        voice = opening
    else:
        wav = root / "public/voice-compact" / (scene["id"] + ".wav")
        cache = wav.with_suffix(".txt")
        if wav.exists() and cache.exists() and cache.read_text() == scene["text"]:
            meta = json.loads(wav.with_suffix(".json").read_text())
        else:
            meta = tts.synthesize(scene["text"], wav, "给第一次了解知芽的老师讲解，像自然交流。语义连贯，动作之间轻轻转折，不逐句拖长，不夸张换气。重点明确，语速轻快。")
            cache.write_text(scene["text"])
        captions=[]
        for sentence in meta.get("sentences", []):
            group=[]
            for word in sentence.get("words", []):
                group.append(word)
                text="".join(w["word"] for w in group)
                if len(text)>=25 or text.endswith(("，","。","？","：","；")):
                    captions.append({"text":text,"start":group[0]["startTime"],"end":group[-1]["endTime"]});group=[]
            if group:captions.append({"text":"".join(w["word"] for w in group),"start":group[0]["startTime"],"end":group[-1]["endTime"]})
        voice={"file":"voice-compact/"+wav.name,"duration":meta["duration"],"captions":captions}
    scene["seconds"]=max(scene["seconds"],round(voice["duration"]+1,2))
    scene["from"]=offset
    scene["voice"]=voice
    offset+=round(scene["seconds"]*30)/30
    print(scene["id"],scene["seconds"],flush=True)
(root / "src/real/compact-timing.json").write_text(json.dumps(story,ensure_ascii=False,indent=2))
print("Total seconds",offset)
