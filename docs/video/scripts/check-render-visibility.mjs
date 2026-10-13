import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const external=new Set();
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname))external.add(url.origin)});
  await page.goto('http://127.0.0.1:3102/?shot=generate&time=12');
  for(const [shot,seconds] of [['generate',12],['revision',0],['revision',15],['animation',0],['animation',15],['practice',0],['practice',20],['question',0],['question',6],['illustration',0],['illustration',0.1],['illustration',3],['document',0],['document',3],['illustration',0],['illustration',3]]){
    await page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
      const id=Math.random(),timer=setTimeout(()=>reject(new Error('Seek timeout')),20000);
      const listener=e=>{if(e.data?.id!==id||!['zhiya-ready','zhiya-error'].includes(e.data.type))return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve():reject(new Error(e.data.message))};
      window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
    }),{shot,seconds});
    const state=await page.evaluate(()=>({
      roomOpacity:document.querySelector('.course-room')?getComputedStyle(document.querySelector('.course-room')).opacity:null,
      animations:document.getAnimations().map(a=>({name:a.animationName,time:a.currentTime,target:a.effect?.target?.className})),
      image:document.querySelector('.illustration-page img')?.complete,
    }));
    console.log(JSON.stringify({shot,seconds,...state}));
    assert.equal(state.roomOpacity,'1',`${shot} at ${seconds}s must preserve the visible course surface`);
    if(shot==='illustration'&&seconds===3)await page.screenshot({path:'out/visibility-illustration.png'});
  }
  console.log('External request origins:',[...external]);
  assert.equal(external.size,0,'Render must not use online services');
  assert.equal(await page.locator('.course-room').evaluate(el=>getComputedStyle(el).opacity),'1','Scene content must be visible after its entrance');
}finally{await browser.close()}
