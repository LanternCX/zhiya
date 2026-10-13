# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Synthesize whole chapters and build a ten-minute frame/caption manifest."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("doubao", ROOT / "scripts/narrate-doubao.py")
doubao = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doubao)


def normalized(text):
    return re.sub(r"[^\w]", "", text).lower()


def timed_content(chapter, metadata):
    # Streaming responses include preliminary empty subtitles; use only finalized words.
    words = []
    seen = set()
    for sentence in metadata["sentences"]:
        for word in sentence.get("words", []):
            key = (word["startTime"], word["endTime"], word["word"])
            if key not in seen:
                seen.add(key)
                words.append(word)
    words.sort(key=lambda word: word["startTime"])
    if not words:
        raise RuntimeError(f"Missing provider timestamps: {chapter['id']}")
    if words[-1]["endTime"] > metadata["duration"] + .5:
        raise RuntimeError(f"Invalid provider timestamps: {chapter['id']}")
    transcript = "".join(normalized(w["word"]) for w in words)
    expected = normalized("".join(b["text"] for b in chapter["beats"]))
    # Latin acronym expansions can differ, so boundaries use a normalized character offset.
    offsets = []
    offset = 0
    for word in words:
        offsets.append((offset, word["startTime"]))
        offset += len(normalized(word["word"]))
    starts = []
    cursor = 0
    for beat in chapter["beats"]:
        boundary = cursor / max(1, len(expected)) * len(transcript)
        starts.append(next((time for index, time in offsets if index >= boundary), metadata["duration"]))
        cursor += len(normalized(beat["text"]))
    captions = []
    group = []
    for word in words:
        group.append(word)
        text = "".join(item["word"] for item in group)
        if len(text) >= 21 or re.search(r"[，。！？；：]$", text):
            captions.append({"text": text, "start": group[0]["startTime"], "end": group[-1]["endTime"]})
            group = []
    if group:
        captions.append({"text": "".join(item["word"] for item in group), "start": group[0]["startTime"], "end": group[-1]["endTime"]})
    return starts, captions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chapter")
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()
    story = json.loads((ROOT / "src/full/story.json").read_text())
    for chapter in story:
        if args.chapter and chapter["id"] != args.chapter:
            continue
        audio = ROOT / "public/voice-doubao" / f"{chapter['id']}.wav"
        text = "\n\n".join(beat["text"] for beat in chapter["beats"])
        snapshot = audio.with_suffix(".txt")
        if not args.rebuild and audio.exists() and audio.with_suffix(".json").exists() and snapshot.exists() and snapshot.read_text() == text:
            print(f"Cached {chapter['id']}", flush=True)
            continue
        style = doubao.STYLE + "本段主题是：" + chapter["title"] + "。段落之间短暂停顿，讲述过程时流畅轻快，解释重点时稍慢。"
        doubao.synthesize(text, audio, style)
        snapshot.write_text(text)
    if args.chapter:
        return
    metadata = [json.loads((ROOT / f"public/voice-doubao/{c['id']}.json").read_text()) for c in story]
    total_audio = sum(meta["duration"] for meta in metadata)
    # Reserve entry/exit time for each chapter; never truncate narration.
    lead, tail = .8, 1.5
    available = 600 - len(story) * (lead + tail)
    rate = max(1., total_audio / available)
    if rate > 1.15:
        raise RuntimeError(f"Narration is too long ({total_audio:.1f}s); edit it instead of excessively accelerating")
    spare = max(0, available - total_audio / rate)
    timeline = []
    position = 0
    for chapter, meta in zip(story, metadata):
        beat_starts, captions = timed_content(chapter, meta)
        seconds = lead + meta["duration"] / rate + tail + spare * meta["duration"] / total_audio
        frames = round(seconds * 30)
        timeline.append({"id": chapter["id"], "from": position, "duration": frames,
                         "audioFrames": math.ceil(meta["duration"] / rate * 30), "lead": round(lead * 30),
                         "rate": rate, "beats": [round((lead + t / rate) * 30) for t in beat_starts],
                         "captions": [{**cap, "start": round((lead + cap['start'] / rate) * 30),
                                       "end": round((lead + cap['end'] / rate) * 30)} for cap in captions]})
        position += frames
    timeline[-1]["duration"] += 18000 - position
    destination = ROOT / "src/full/timing.json"
    destination.write_text(json.dumps(timeline, ensure_ascii=False, indent=2))
    print(f"Timeline: 600s; narration: {total_audio:.2f}s; playback rate: {rate:.4f}; chapters: {len(story)}")


if __name__ == "__main__":
    main()
