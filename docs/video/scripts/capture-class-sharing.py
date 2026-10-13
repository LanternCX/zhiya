# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Exercise class sharing on local demo accounts and capture server responses."""
import json
import re
import secrets
import time
from pathlib import Path
import requests

root = Path(__file__).resolve().parents[1]
base = "http://127.0.0.1:8080/api"

def client():
    session = requests.Session()
    session.headers["X-Zhiya-Request"] = "1"
    return session

def request(session, method, path, body=None):
    response = session.request(method, base + path, json=body, timeout=30)
    response.raise_for_status()
    return response.json() if response.content else None

teacher = client()
request(teacher, "POST", "/auth/login", json.loads((root / "out/demo-account.json").read_text()))
classes = request(teacher, "GET", "/classes")["classes"]
classroom = next((c for c in classes if c["name"] == "初一 Python 入门演示班"), None)
if not classroom:
    classroom = request(teacher, "POST", "/classes", {"name": "初一 Python 入门演示班"})["class"]
path = "/classes/" + classroom["id"]
invitation = request(teacher, "GET", path + "/invitation")

student = client()
account_file = root / "out/student-account.json"
if account_file.exists():
    request(student, "POST", "/auth/login", json.loads(account_file.read_text()))
else:
    account = {"email": f"video-student-{int(time.time())}@example.invalid", "password": secrets.token_urlsafe(24)}
    flow = request(student, "POST", "/auth/register/start", {"email": account["email"]})["flow"]
    code = None
    for _ in range(20):
        inbox = requests.get("http://127.0.0.1:8025/api/v1/messages", timeout=10).json()
        for message in inbox.get("messages", []):
            if any(item["Address"] == account["email"] for item in message["To"]):
                detail = requests.get("http://127.0.0.1:8025/api/v1/message/" + message["ID"], timeout=10).json()
                match = re.search(r"验证码：(\d{8})", detail["Text"])
                if match:
                    code = match.group(1)
        if code:
            break
        time.sleep(.5)
    if not code:
        raise RuntimeError("Local student registration email did not arrive")
    request(student, "POST", "/auth/register/complete", {"flow": flow, "code": code, "password": account["password"], "role": "student"})
    account_file.touch(mode=0o600)
    account_file.write_text(json.dumps(account))
    request(student, "POST", "/auth/login", account)
student_classes = request(student, "GET", "/classes")["classes"]
if not any(c["id"] == classroom["id"] for c in student_classes):
    request(student, "POST", "/classes/join", {"code": invitation["code"]})

fixture = json.loads((root / "replay/fixtures.json").read_text())
course_id = fixture["course"]["course"]["id"]
item = next(d for d in fixture["deliverables"]["deliverables"] if d["kind"] == "document" and not d.get("source"))
share_path = f"/courses/{course_id}/deliverables/{item['id']}/share"
before = request(teacher, "GET", share_path)
saved = request(teacher, "PUT", share_path, {"visibility": "class", "classIds": [classroom["id"]]})
materials = request(student, "GET", path + "/shares")
reader = request(student, "GET", "/shares/" + saved["token"])
assert any(s["token"] == saved["token"] for s in materials["shares"])
assert reader["deliverable"]["id"] == item["id"]
data = {"classroom": request(teacher, "GET", path), "invitation": invitation,
        "classes": request(teacher, "GET", "/classes"), "before": before, "saved": saved,
        "materials": materials, "reader": reader, "student": request(student, "GET", "/me")}
data["student"]["email"] = "student@example.invalid"
data["student"]["nickname"] = "演示学生"
for member in data["classroom"]["class"]["members"]:
    member["nickname"] = "演示学生" if member["role"] == "student" else "演示老师"
data["classroom"]["class"]["headTeacherName"] = "演示老师"
for c in data["classes"]["classes"]:
    if c["id"] == classroom["id"]:
        c["headTeacherName"] = "演示老师"
for share in data["materials"]["shares"]:
    share["teacherName"] = "演示老师"
(root / "replay/class-sharing.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))
print("Verified local class creation, student joining, class sharing, member material list and authenticated reading.")
