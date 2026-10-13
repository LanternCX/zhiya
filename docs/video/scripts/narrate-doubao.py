# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Create a continuous Mandarin narration sample using Doubao TTS 2.0."""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import uuid
import wave

from dotenv import dotenv_values
import requests

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
STYLE = (
    "你正在和一位熟悉的老师交流备课经验，用开朗、自然的普通话说话。"
    "这是口头讲述，不是念稿。整体节奏轻快，有真实交流时的语气变化。"
    "开头设想明天上课的场景，像聊天一样带入；"
    "列举找案例、做课件、准备练习时一口气顺畅地说，节奏稍快，不逐项停顿。"
    "说到备课想法散在多个工具里时，稍微放慢，让听者感受到困扰。"
    "引出知芽时，语气轻松明亮，转折前短暂停顿。"
    "介绍操作过程时，连贯流畅，次要信息轻轻带过，不给每句话同样的重音。"
    "最后说老师始终决定这堂课怎么教时，放慢一点，强调老师决定，随后自然收束。"
    "只在完整意思结束或话题转折处停顿，句中保持连贯；不要播音腔或夸张广告腔。"
)
SCRIPT = """想象一下，明天你要给一群第一次接触编程的学生上课。
教什么，你已经想好了。可接下来呢？找案例、做课件、准备练习，还得把这些内容整理成教案。
忙了一圈，一个完整的教学想法，反倒散在了好几个工具里。

知芽，就是想帮老师把这些准备工作串起来。
你先说说这堂课教给谁，学生有什么基础，最希望他们学会什么。
再把参考资料交给知芽：哪些内容要保留，哪里想换一种讲法，都可以直接告诉它。

接下来，我们就拿一节编程入门课，看看这个过程。
先明确教学目标，再组织讲解，准备图示和互动活动。觉得哪里不合适？继续提意见，让它修改。
这堂课怎么教，始终由老师决定。知芽做的，是帮你把想法变成可以使用的教学材料。"""


def synthesize(text: str, destination: Path, style: str = STYLE) -> dict:
    parser_config = dotenv_values(ROOT / ".env.local")
    key = os.environ.get("VOLCENGINE_TTS_API_KEY") or parser_config.get("VOLCENGINE_TTS_API_KEY")
    voice = os.environ.get("VOLCENGINE_TTS_VOICE") or parser_config.get("VOLCENGINE_TTS_VOICE")
    if not key or not voice:
        raise RuntimeError("TTS key or voice is missing in .env.local")
    payload = {
        "user": {"uid": "zhiya-video"},
        "req_params": {
            "text": text,
            "speaker": voice,
            "audio_params": {"format": "pcm", "sample_rate": 24000, "speech_rate": 12,
                             "enable_timestamp": True, "enable_subtitle": True},
            "additions": json.dumps({"context_texts": [style]}, ensure_ascii=False),
        },
    }
    headers = {
        "X-Api-Key": key,
        "X-Api-Resource-Id": "seed-tts-2.0",
        "X-Api-Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }
    chunks = []
    sentences = []
    complete = False
    with requests.post(ENDPOINT, headers=headers, json=payload, stream=True, timeout=(15, 120)) as response:
        if response.status_code != 200:
            body = None
            try:
                body = response.json()
                detail = body.get("error", body.get("header", body))
                message = detail.get("message", detail.get("msg", "")) if isinstance(detail, dict) else str(detail)
            except ValueError:
                message = response.text[:250]
            if not message:
                message = f"Response fields: {list(body)}" if isinstance(body, dict) else "Empty error response"
            message = str(message).replace(key, "[redacted]")
            raise RuntimeError(f"Doubao HTTP {response.status_code}: {message[:250]}")
        for raw in response.iter_lines():
            if not raw:
                continue
            event = json.loads(raw)
            code = event.get("code")
            if code not in (0, 20000000):
                message = str(event.get("message", "")).replace(key, "[redacted]")
                raise RuntimeError(f"Doubao code {code}: {message[:250]}")
            if event.get("data"):
                chunks.append(base64.b64decode(event["data"], validate=True))
            if event.get("sentence"):
                sentences.append(event["sentence"])
            if code == 20000000:
                complete = True
                break
    pcm = b"".join(chunks)
    if not complete or not pcm or len(pcm) % 2:
        raise RuntimeError("Doubao returned incomplete audio")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(pcm)
    duration = len(pcm) / 48000
    print(f"Generated {destination.name}: {duration:.2f}s; voice={voice}")
    metadata = {"duration": duration, "sentences": sentences}
    destination.with_suffix(".json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def generate(smoke: bool) -> None:
    name = "doubao-smoke" if smoke else "doubao-narration-v2"
    text = "知芽，帮助老师把教学想法，整理成一堂课。" if smoke else SCRIPT
    synthesize(text, ROOT / "out" / f"{name}.wav")
    if not smoke:
        (ROOT / "out" / f"{name}.txt").write_text(SCRIPT + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    try:
        generate(args.smoke)
    except requests.RequestException as error:
        # Avoid dumping request objects or headers that contain API credentials.
        print(f"Doubao request failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
