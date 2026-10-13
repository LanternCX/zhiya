# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "websocket-client"]
# ///
"""Send a reproducible narration sample through the product's actual ASR API."""
import json
import subprocess
import threading
import time
from pathlib import Path
import requests
import websocket

root=Path(__file__).resolve().parents[1]
session=requests.Session()
session.trust_env=False
session.headers["X-Zhiya-Request"]="1"
response=session.post('http://127.0.0.1:8080/api/auth/login',json=json.loads((root/'out/demo-account.json').read_text()),timeout=30)
response.raise_for_status()
response=session.post('http://127.0.0.1:8080/api/socket-ticket',json={},timeout=30)
response.raise_for_status()
ticket=response.json()['ticket']
socket=websocket.create_connection('ws://127.0.0.1:8080/api/speech/stream?ticket='+ticket,timeout=45,http_no_proxy=['127.0.0.1'])
pcm=subprocess.run(['ffmpeg','-v','error','-i',str(root/'public/voice-compact/task.wav'),'-f','s16le','-ar','16000','-ac','1','pipe:1'],capture_output=True,check=True).stdout
socket.send(json.dumps({'type':'start'}))
events=[]
def send():
    for offset in range(0,len(pcm),3200):
        socket.send_binary(pcm[offset:offset+3200]);time.sleep(.1)
    socket.send(json.dumps({'type':'stop'}))
while True:
    event=json.loads(socket.recv());events.append(event)
    if event['type']=='ready':threading.Thread(target=send,daemon=True).start()
    if event['type']=='error':raise RuntimeError(event.get('message','ASR failed'))
    if event['type']=='complete':break
socket.close()
(root/'replay/speech-evidence.json').write_text(json.dumps({'audio':'voice-compact/task.wav','events':events},ensure_ascii=False,indent=2))
print('Actual ASR completed; captured',len(events),'events.')
