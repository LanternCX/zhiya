import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await launchBrowser();
await mkdir('out/student-qa',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const external=new Set();
  page.on('request',request=>{const u=new URL(request.url());if(['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))external.add(u.origin)});
  await page.goto('http://127.0.0.1:3102/?audience=student&shot=onboarding');
  for(const [shot,times] of [['onboarding',[3,6]],['profile',[2]],['grade-primary',[3]],['grade-high',[3]],['speech',[4,11,13.7]],['material-process',[6,12,18,25]],['knowledge',[2,6,11]],['generate',[2,8,14,21]],['revision',[5,15]],['animation',[3,9,15]],['illustration',[3]],['practice',[3,9,16]],['question',[3,5,7,14]],['document',[3]],['class-join',[2,4]],['materials',[2]],['reader',[5]],['sharing',[3,5,7,11]],['export',[3]]]){
    for(const seconds of times){
      await page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
        const id=Math.random(),timer=setTimeout(()=>reject(new Error('Seek timeout')),20000);
        const listener=e=>{if(e.data?.id!==id||!['zhiya-ready','zhiya-error'].includes(e.data.type))return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve():reject(new Error(e.data.message))};
        window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
      }),{shot,seconds}).catch(async error=>{console.error(shot,seconds,(await page.locator('body').innerText()).slice(-1000));throw error});
      const text=await page.locator('body').innerText();
      assert.ok(!/对话不存在|Uncaptured replay request/.test(text),shot);
      if(shot==='profile')assert.ok(text.includes('初中一年级')&&!text.includes('备课偏好'));
      if(shot==='knowledge'&&seconds===2)assert.ok(text.includes('正在搜索知识库'));
      if(shot==='knowledge'&&seconds===11)assert.ok(await page.locator('[aria-label="知识库引用"]').isVisible());
      if(shot==='practice'&&seconds===9)assert.ok(text.includes('SyntaxError'));
      if(shot==='practice'&&seconds===16)assert.ok(text.includes('Completed'));
      if(shot==='question'&&seconds===7)assert.ok(text.includes('答案已提交'));
      if(shot==='document'){await page.screenshot({path:'out/student-qa/document-debug.png'});assert.ok(text.includes('我的学习笔记'),text)}
      if(await page.locator('.course-room').isVisible())assert.equal(await page.locator('.course-room').evaluate(el=>getComputedStyle(el).opacity),'1',`${shot} visible`);
      await page.screenshot({path:`out/student-qa/${shot}-${seconds}.png`});
    }
    console.log('Verified student',shot);
  }
  assert.equal(external.size,0,'Replay requires no online service');
}finally{await browser.close()}
