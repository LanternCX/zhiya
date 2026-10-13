import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const dialogue=JSON.parse(await readFile('src/student/dialogue-timing.json','utf8'));
const timeline=JSON.parse(await readFile('src/student/timing.json','utf8'));
const voiceScene=timeline.find(scene=>scene.id==='speech');
assert.ok(dialogue[0].from>=voiceScene.voice.duration,'Narrator finishes before dialogue starts');
for(let i=1;i<dialogue.length;i++)assert.ok(dialogue[i].from>=dialogue[i-1].from+dialogue[i-1].duration,'Voices do not overlap');
assert.ok(voiceScene.frames/30>=dialogue.at(-1).from+dialogue.at(-1).duration,'Last spoken reply is not cut');
const browser=await launchBrowser();
await mkdir('out/student-content-qa',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const external=[];
  page.on('request',r=>{const u=new URL(r.url());if(['http:','https:','ws:','wss:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))external.push(r.url())});
  page.on('websocket',s=>{const u=new URL(s.url());if(!(u.hostname==='127.0.0.1'&&u.port==='3102'&&u.pathname==='/'&&u.searchParams.has('token')))external.push(s.url())});
  await page.goto('http://127.0.0.1:3102/?audience=student&shot=generate');
  async function seek(shot,seconds){
    await page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
      const id=Math.random(),timer=setTimeout(()=>reject(Error('seek timeout')),20000);
      const listener=e=>{if(e.data?.id!==id||!['zhiya-ready','zhiya-error'].includes(e.data.type))return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve():reject(Error(e.data.message))};
      window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
    }),{shot,seconds});
  }
  for(const shot of ['grade-primary','grade-high']){
    await seek(shot,2);
    const early=await page.locator('.course-thread').innerText();
    await seek(shot,7);
    const later=await page.locator('.course-thread').innerText();
    assert.ok(later.length>early.length+200,`${shot}: learning explanation must keep growing`);
    await seek(shot,9);
    const complete=await page.locator('.course-thread').innerText();
    assert.ok(complete.length>550&&complete.includes('先预测'),`${shot}: include a full example and a prediction task`);
    await page.screenshot({path:`out/student-content-qa/${shot}.png`});
  }
  await seek('generate',8);
  const early=await page.locator('.course-thread').innerText();
  await seek('generate',16);
  const middle=await page.locator('.course-thread').innerText();
  await seek('generate',23);
  const full=await page.locator('.course-thread').innerText();
  assert.ok(middle.length>early.length+250,'Generation continues with substantial learning content');
  assert.ok(full.length>1000&&full.includes('哪一句欢迎词'),`Complete learning response survives until scene end (${full.length} characters)`);
  await page.screenshot({path:'out/student-content-qa/generation.png'});
  await seek('voice-dialogue',dialogue[0].from+1);
  assert.ok(await page.getByRole('button',{name:'退出语音对话',exact:true}).isVisible(),'Uses native dialogue mode, not dictation');
  const firstComposer=await page.locator('.course-composer').elementHandle();
  for(const turn of dialogue){
    await seek('voice-dialogue',turn.from+turn.duration/2);
    const text=await page.locator(turn.role==='user'?'.chat-composer-capture':'.course-thread').innerText();
    assert.ok(text.includes(turn.text.slice(0,5)),`Shows ${turn.id} during its audio`);
    assert.ok(await firstComposer.evaluate(el=>el.isConnected),'Dialogue remains mounted across turns');
    await page.screenshot({path:`out/student-content-qa/voice-${turn.id}.png`});
  }
  await seek('voice-dialogue',dialogue.at(-1).from+dialogue.at(-1).duration+.2);
  const conversation=await page.locator('.course-thread').innerText();
  for(const turn of dialogue)assert.ok(conversation.includes(turn.text),`Preserves ${turn.id}`);
  await seek('document',3);
  assert.equal(await page.getByRole('button',{name:'退出语音对话',exact:true}).count(),0,'Ends dialogue before next scene');
  const notes=await page.locator('.deliverable-paper').innerText();
  assert.ok(notes.includes('我的一次排错记录')&&notes.includes('回顾与继续学习'),'Full notes retain experiments, errors and revision');
  assert.deepEqual(external,[],'Playback never connects to live audio or model services');
  console.log('Verified substantial streaming content, native two-turn voice dialogue, complete notes, offline replay');
}finally{await browser.close()}
