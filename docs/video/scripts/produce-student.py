# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Build the independent student film narration and frame-aligned timing."""
import importlib.util
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tts',root/'scripts/narrate-doubao.py')
tts=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)
story=json.loads((root/'src/student/story.json').read_text())
folder=root/'public/voice-student'
folder.mkdir(exist_ok=True)
dialogue=json.loads((root/'src/student/dialogue.json').read_text())
for turn in dialogue:
    wav=folder/('dialogue-'+turn['id']+'.wav')
    cache=wav.with_suffix('.txt')
    if wav.exists() and cache.exists() and cache.read_text()==turn['text']:
        meta=json.loads(wav.with_suffix('.json').read_text())
    else:
        style='自然的一对一学习对话，按语义连贯表达，不要播音腔。'+('你是好奇的学习者，带着疑问向老师提问。' if turn['role']=='user' else '你是耐心的学习伙伴，直接回答学生的问题，清楚轻快，不夸张。')
        meta=tts.synthesize(turn['text'],wav,style)
        cache.write_text(turn['text'])
    captions=[]
    for sentence in meta.get('sentences',[]):
        words=sentence.get('words',[])
        if words:captions.append({'text':('学生：' if turn['role']=='user' else '知芽：')+sentence['text'],'start':words[0]['startTime'],'end':words[-1]['endTime']})
    turn.update(file='voice-student/'+wav.name,duration=meta['duration'],captions=captions)
frame=0
for scene in story:
    wav=folder/(scene['id']+'.wav')
    cache=wav.with_suffix('.txt')
    if wav.exists() and cache.exists() and cache.read_text()==scene['text']:
        meta=json.loads(wav.with_suffix('.json').read_text())
    else:
        meta=tts.synthesize(scene['text'],wav,'向第一次了解产品的观众介绍学生如何使用知芽。自然口语，清楚轻快，按完整意思换气，重点处稍慢。不要逐句机械停顿，不要广告腔。')
        cache.write_text(scene['text'])
    captions=[]
    for sentence in meta.get('sentences',[]):
        group=[]
        for word in sentence.get('words',[]):
            group.append(word)
            text=''.join(w['word'] for w in group)
            if len(text)>=25 or text.endswith(('，','。','？','：','；')):
                captions.append({'text':text,'start':group[0]['startTime'],'end':group[-1]['endTime']})
                group=[]
        if group:captions.append({'text':''.join(w['word'] for w in group),'start':group[0]['startTime'],'end':group[-1]['endTime']})
    # Leave a short reading beat after narration; longer scenes must earn their
    # time through a visible operation rather than a fixed story placeholder.
    minimum={'references':24,'animation':17}.get(scene['id'],0)
    if scene['id']=='speech':
        cursor=meta['duration']+.6
        for turn in dialogue:
            turn['from']=round(cursor*30)/30
            cursor=turn['from']+turn['duration']+(1.3 if turn['role']=='user' else .5)
        minimum=cursor+.5
    scene['frames']=round(max(minimum,meta['duration']+1.3)*30)
    scene['from']=frame
    scene['voice']={'file':'voice-student/'+wav.name,'duration':meta['duration'],'captions':captions}
    frame+=scene['frames']
    print(scene['id'],scene['frames']/30,flush=True)
(root/'src/student/timing.json').write_text(json.dumps(story,ensure_ascii=False,indent=2))
(root/'src/student/dialogue-timing.json').write_text(json.dumps(dialogue,ensure_ascii=False,indent=2))
print('Student film seconds:',frame/30)
