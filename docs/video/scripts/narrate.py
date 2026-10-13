# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Generate video narration using the existing project's Qwen TTS credential.

Run with uv. Credentials are read at runtime and never saved in this project.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import wave

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parents[1] / "apps" / "server"
MODEL = "qwen3-tts-instruct-flash-2026-01-26"
VOICE = "Serena"
STYLE = (
    "用自然、温暖、清晰的普通话为教育产品介绍视频配音。"
    "像一位专业讲解者面对老师娓娓道来，音色成熟舒展，情绪克制。"
    "语速适中，每秒约四个汉字，按完整语义短句停顿，句尾自然收束。"
    "避免逐字顿读、机械念稿、刻意拖长尾音和夸张广告腔。"
    "知芽读作zhi ya，Python按照英文单词的自然读法发音。"
)
LINES = {
    "pain": "一个教学想法，要在多少个工具之间切换？让老师的精力，回到教学设计。",
    "brand": "知芽，从理解你的教学思路开始，与你一起共创课件。",
    "intent": "为初中生准备一节四十分钟的 Python 入门课。说清授课对象和教学目标，再告诉知芽，你希望怎样展开这堂课。",
    "demo": "教学想法，逐步变成课堂里看得见的内容。讲解配合图示，把程序的运行过程呈现出来，让抽象的知识更容易理解。",
    "close": "知芽，让想法长成一堂课。",
}


def generate(scene: str, key: str, endpoint: str) -> None:
    payload = {
        "model": MODEL,
        "input": {
            "text": LINES[scene],
            "voice": VOICE,
            "language_type": "Chinese",
            "instructions": STYLE,
            "optimize_instructions": True,
        },
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        # Do not log response bodies or request headers containing credentials.
        raise RuntimeError(f"TTS request failed: HTTP {exc.code}") from None
    if result.get("code"):
        code = str(result["code"]).replace(key, "[redacted]")
        message = str(result.get("message", "")).replace(key, "[redacted]")
        raise RuntimeError(f"TTS provider error: {code}: {message[:300]}")
    url = result.get("output", {}).get("audio", {}).get("url")
    if url and urllib.parse.urlparse(url).scheme == "http":
        url = urllib.parse.urlparse(url)._replace(scheme="https").geturl()
    if not url or urllib.parse.urlparse(url).scheme != "https":
        shape = {k: list(v) if isinstance(v, dict) else type(v).__name__ for k, v in result.items()}
        raise RuntimeError(f"TTS returned no HTTPS audio file; response fields: {shape}")
    # The provider's signed asset URL needs no Authorization header.
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read()
    folder = ROOT / "public" / "voice-qwen"
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / f"{scene}.wav"
    destination.write_bytes(data)
    with wave.open(str(destination)) as audio:
        duration = audio.getnframes() / audio.getframerate()
    print(f"{scene}: {duration:.2f}s ({MODEL}, {VOICE})", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", choices=list(LINES))
    args = parser.parse_args()
    base = yaml.safe_load((SOURCE / "config.yaml").read_text()).get("speech", {})
    local = yaml.safe_load((SOURCE / "config.local.yaml").read_text()).get("speech", {})
    config = base | local
    key = os.environ.get("ZHIYA_SERVER_SPEECH_TTS_API_KEY") or config.get("tts_api_key")
    if not key:
        raise RuntimeError("Project TTS credential is missing")
    host = urllib.parse.urlparse(config["endpoint"]).hostname
    if host not in {"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"}:
        raise RuntimeError("Configured speech host is not a supported DashScope endpoint")
    endpoint = f"https://{host}/api/v1/services/aigc/multimodal-generation/generation"
    for scene in [args.scene] if args.scene else LINES:
        generate(scene, key, endpoint)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Narration failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
