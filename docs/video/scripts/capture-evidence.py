# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Capture actual reference parsing and a focused evidence-backed teacher reply."""
import base64
import json
import time
import uuid
import sys
from pathlib import Path
import requests

root=Path(__file__).resolve().parents[1]
session=requests.Session()
session.headers["X-Zhiya-Request"]="1"
base="http://127.0.0.1:8080/api"
def call(method,path,body=None):
    response=session.request(method,base+path,json=body,timeout=60)
    response.raise_for_status()
    return response.json() if response.content else {}
call("POST","/auth/login",json.loads((root/"out/demo-account.json").read_text()))
fixture=json.loads((root/"replay/fixtures.json").read_text())
identity={"kind":"course","courseId":fixture["course"]["course"]["id"]}
cache=root/"out/evidence-session.json"
if cache.exists():
    identity=json.loads(cache.read_text())
snapshot=call("POST","/agent/sessions",identity)
identity["conversationId"]=snapshot["state"]["conversationId"]
cache.write_text(json.dumps(identity))
def command(action,args):
    request_id=str(uuid.uuid4())
    call("POST",f"/agent/sessions/{snapshot['id']}/commands",{"requestId":request_id,"action":action,"args":args})
    for _ in range(180):
        time.sleep(2)
        state=call("POST","/agent/sessions",identity)["state"]
        receipt=state.get("commands",{}).get(request_id,{})
        if receipt.get("status")=="failed":
            raise RuntimeError(receipt.get("error","Command failed"))
        if receipt.get("status")=="complete" and not state.get("running") and not state.get("busy"):
            return state
    raise RuntimeError("Capture timed out")
materials=[]
for file,name in [(root/"out/verified-teacher-plan.docx","教师教案.docx"),(root/"replay/public/illustration.png","食堂情境.png")]:
    materials.append({"name":name,"base64":base64.b64encode(file.read_bytes()).decode()})
if '--followup' not in sys.argv and '--refresh' not in sys.argv:
    state=command("materials",[materials])
    (root/"out/evidence-upload.json").write_text(json.dumps(state,ensure_ascii=False,indent=2))
    print("Material command completed",flush=True)
prompt="请结合刚上传的教师教案.docx和食堂情境.png，为初一零基础学生准备变量、输入和输出的课堂导入。先读取这两份资料，说明图片里哪个场景可以用于导入、教案里哪项活动可以保留；检索并读取平台知识库中的相关依据，再用不超过300字总结教学安排，附实际引用。先不要生成课件。"
if '--followup' in sys.argv:
    prompt="根据你刚才已经读过的两份资料，请只保留三句话：图片中可用的导入场景、教案中可保留的活动、两者怎样组合。附原有的真实资料引用，总共不超过150字，不要其他说明。最后问我一个有助于确定导入讲法的问题。"
state=call("POST","/agent/sessions",identity)["state"] if '--refresh' in sys.argv else command("prompt",[prompt,[],"text"])
result={"state":state,"materials":call("GET",f"/courses/{identity['courseId']}/materials")}
result["contents"]={}
for material in result["materials"]["materials"]:
    if material["name"] in ["教师教案.docx","食堂情境.png"]:
        path=f"/courses/{identity['courseId']}/materials/{material['id']}/content"
        content=call("GET",path)
        next_line=content["excerpt"].get("nextLine")
        while next_line:
            more=call("GET",path+f"?startLine={next_line}")
            content["excerpt"]["lines"].extend(more["excerpt"]["lines"])
            next_line=more["excerpt"].get("nextLine")
        content["excerpt"]["nextLine"]=None
        result["contents"][material["id"]]=content
result["knowledge"]={}
for message in state["lesson"]["messages"]:
    for search in message.get("knowledgeSearches",[]):
        for source in search.get("sources",[]):
            path=f"/knowledge/{source['version']}/blocks/{source['blockId']}"
            result["knowledge"][path]=call("GET",path)
(root/"replay/evidence.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
print("Captured",len(result["contents"]),"parsed references and",len(result["knowledge"]),"knowledge blocks",flush=True)
