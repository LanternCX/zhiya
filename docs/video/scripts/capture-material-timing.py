# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Capture the full material-processing interval without editing out waits."""
import base64
import json
import time
import uuid
from pathlib import Path
import requests

root=Path(__file__).resolve().parents[1]
session=requests.Session();session.trust_env=False
session.headers['X-Zhiya-Request']='1'
def call(method,path,body=None):
    response=session.request(method,'http://127.0.0.1:8080/api'+path,json=body,timeout=240)
    response.raise_for_status();return response.json() if response.content else {}
call('POST','/auth/login',json.loads((root/'out/demo-account.json').read_text()))
identity=json.loads((root/'out/evidence-session.json').read_text())
files=[(root/path,name) for path,name in [('replay/public/teacher-plan.docx','教师教案.docx'),('replay/public/illustration.png','食堂情境.png')]]
started=time.monotonic();events=[];materials=[]
def record(phase,name):
    events.append({'at':round(time.monotonic()-started,3),'progress':{'phase':phase,'total':2,'completed':len(materials),'fileName':name}})
    print(events[-1]['at'],phase,name,flush=True)
for file,name in files:
    record('uploading',name)
    path=f"/courses/{identity['courseId']}/material-uploads"
    raw=file.read_bytes()
    upload=call('POST',path,{'name':name,'sizeBytes':len(raw)})['upload']
    response=requests.put(upload['url'],headers=upload.get('headers',{}),data=raw,timeout=60)
    response.raise_for_status()
    record('parsing',name)
    materials.append(call('POST',path+'/'+upload['id']+'/complete',{})['material'])
record('complete','')
duration=events[-1]['at']
(root/'replay/material-timing.json').write_text(json.dumps({'duration':duration,'events':events,'materials':materials},ensure_ascii=False,indent=2))
print('Full elapsed seconds:',duration,flush=True)
