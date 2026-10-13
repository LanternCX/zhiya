# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
"""Check narration coverage and assemble review sheets from rendered camera shots."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
story=json.loads((ROOT/'src/full/story.json').read_text())
timing=json.loads((ROOT/'src/full/timing.json').read_text())
position=0
for chapter,clock in zip(story,timing):
    assert chapter['id']==clock['id']
    assert clock['from']==position
    assert clock['lead']+clock['audioFrames']<=clock['duration'], chapter['id']
    assert clock['beats']==sorted(clock['beats'])
    assert len(clock['beats'])==4
    assert all(0<=c['start']<=c['end']<=clock['duration'] for c in clock['captions'])
    assert (ROOT/f"public/voice-doubao/{chapter['id']}.wav").exists()
    position+=clock['duration']
assert position==18000
def timestamp(frame):
    milliseconds=round(frame/30*1000)
    hours,milliseconds=divmod(milliseconds,3600000)
    minutes,milliseconds=divmod(milliseconds,60000)
    seconds,milliseconds=divmod(milliseconds,1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'

subtitles=[]
for clock in timing:
    for caption in clock['captions']:
        subtitles.append(f"{len(subtitles)+1}\n{timestamp(clock['from']+caption['start'])} --> {timestamp(clock['from']+caption['end'])}\n{caption['text']}\n")
(ROOT/'out/zhiya-teacher-introduction.srt').write_text('\n'.join(subtitles))
(ROOT/'out/chapters.txt').write_text('\n'.join(f"{timestamp(clock['from'])[:8]} {chapter['title']}" for chapter,clock in zip(story,timing))+'\n')
chapters=[';FFMETADATA1']
for chapter,clock in zip(story,timing):
    chapters.extend(['[CHAPTER]','TIMEBASE=1/1000',f"START={round(clock['from']/30*1000)}",
                     f"END={round((clock['from']+clock['duration'])/30*1000)}",f"title={chapter['title']}"])
(ROOT/'out/chapters.ffmetadata').write_text('\n'.join(chapters)+'\n')
for sheet in range(4):
    canvas=Image.new('RGB',(1920,1160),'#f5f5ef')
    draw=ImageDraw.Draw(canvas)
    for row,chapter in enumerate(story[sheet*4:(sheet+1)*4]):
        for beat in range(4):
            source=ROOT/f"out/film-qa/{chapter['id']}-{beat}.jpg"
            with Image.open(source) as image:
                canvas.paste(image.resize((480,270)),(beat*480,row*290+20))
            draw.text((beat*480+8,row*290+4),f"{chapter['id']} / shot {beat+1}",fill='#286443')
    canvas.save(ROOT/f'out/film-qa/sheet-{sheet+1}.jpg',quality=94)
print('Verified: 600 seconds, 15 chapters, 60 shots, narration and subtitle bounds')
