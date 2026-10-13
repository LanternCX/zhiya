# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Create a local teacher for filming the real onboarding flow."""
import json
import secrets
import time
from pathlib import Path
import requests

root = Path(__file__).resolve().parents[1]
email = f"video-profile-{int(time.time())}@example.invalid"
password = secrets.token_urlsafe(24)
session = requests.Session()
session.headers.update({"X-Zhiya-Request": "1"})
base = "http://127.0.0.1:8080/api"
response = session.post(base + "/auth/register/start", json={"email": email}, timeout=20)
response.raise_for_status()
flow = response.json()["flow"]
code = None
for _ in range(20):
    inbox = requests.get("http://127.0.0.1:8025/api/v1/messages", timeout=10).json()
    for message in inbox.get("messages", []):
        if any(item["Address"] == email for item in message["To"]):
            import re
            detail = requests.get("http://127.0.0.1:8025/api/v1/message/" + message["ID"], timeout=10).json()
            match = re.search(r"验证码：(\d{8})", detail["Text"])
            if match:
                code = match.group(1)
    if code:
        break
    time.sleep(.5)
if not code:
    raise RuntimeError("Local registration email did not arrive")
response = session.post(base + "/auth/register/complete", json={"flow": flow, "code": code, "password": password, "role": "teacher"}, timeout=20)
response.raise_for_status()
destination = root / "out/profile-account.json"
destination.touch(mode=0o600, exist_ok=True)
destination.chmod(0o600)
destination.write_text(json.dumps({"email": email, "password": password}))
print("Local teacher account created; credentials saved privately.")
