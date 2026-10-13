# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Capture local demo projections, not screenshots or fabricated model replies."""
import json
from pathlib import Path
import requests

root = Path(__file__).resolve().parents[1]
base = "http://127.0.0.1:8080/api"
session = requests.Session()
session.headers.update({"X-Zhiya-Request": "1"})

def login(name):
    account = json.loads((root / "out" / name).read_text())
    result = session.post(base + "/auth/login", json=account, timeout=20)
    result.raise_for_status()

def get(path):
    result = session.get(base + path, timeout=30)
    result.raise_for_status()
    return result.json()

def projection(body):
    result = session.post(base + "/agent/sessions", json=body, timeout=30)
    result.raise_for_status()
    return result.json()["state"]

login("demo-account.json")
course_id = "41ccc4eb-8c03-4867-8198-1f27758b9b25"
conversation_id = "572cf2bf-a2f9-465e-8f09-6ee223e7690b"
data = {
    "course": projection({"kind": "course", "courseId": course_id, "conversationId": conversation_id}),
    "profile": projection({"kind": "profile"}),
    "deliverables": get(f"/courses/{course_id}/deliverables"),
    "rules": get("/account-rules"),
    "user": get("/me"),
}
data["user"]["email"] = "teacher@example.invalid"
data["user"]["nickname"] = "演示老师"
calls = []
def collect(value):
    if isinstance(value, dict):
        if value.get("type") == "toolCall" and value.get("name") in {"create_lesson_page", "publish_slide", "publish_animation", "edit_lesson_page", "create_deliverable", "edit_deliverable"}:
            calls.append({"name": value["name"], "arguments": value["arguments"]})
        for child in value.values():
            collect(child)
    elif isinstance(value, list):
        for child in value:
            collect(child)
for transcript in (root / "out/demo-agent").rglob(f"*{conversation_id}*.jsonl"):
    for line in transcript.read_text().splitlines():
        collect(json.loads(line))
data["generationCalls"] = calls
picture = next(p for p in data["course"]["lesson"]["pages"] if p["kind"] == "illustration")
download = get(f"/courses/{course_id}/illustrations/{picture['assetId']}/download")
image = requests.get(download["url"], headers=download.get("headers", {}), timeout=30)
image.raise_for_status()
assets = root / "replay/public"
assets.mkdir(exist_ok=True)
(assets / "illustration.png").write_bytes(image.content)
login("profile-account.json")
data["onboarding"] = projection({"kind": "profile"})
destination = root / "replay/fixtures.json"
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(data, ensure_ascii=False, indent=2))
print("Captured course, generated pages, profile and onboarding projections.")
print("Page types:", [p.get("kind", p.get("type")) for p in data["course"]["lesson"]["pages"]])
