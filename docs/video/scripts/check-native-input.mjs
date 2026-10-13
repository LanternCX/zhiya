import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser();
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 for(const [shot,times] of [['speech',[4,11,13,13.7,4,13]],['upload',[2,5,2]]]){
  await page.goto(`http://127.0.0.1:3102/?shot=${shot}&time=0`);
  await page.locator('.course-composer').waitFor();
  for(const seconds of times){
   await page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
    const id=Math.random();const timeout=setTimeout(()=>reject(new Error('seek timeout')),20000);
    const listener=e=>{if(e.data?.id!==id)return;if(['zhiya-ready','zhiya-error'].includes(e.data.type)){clearTimeout(timeout);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve(true):reject(new Error(e.data.message))}};
    window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
   }),{shot,seconds});
   if(shot==='speech'&&seconds===4)assert.ok((await page.locator('.chat-composer-capture').innerText()).length>5);
   if(shot==='speech'&&seconds===13)assert.ok((await page.locator('.course-composer textarea').inputValue()).includes('先准备导入和练习'));
   if(shot==='speech'&&seconds===13.7){assert.equal(await page.locator('.course-composer textarea').inputValue(),'');assert.ok((await page.locator('.course-thread').innerText()).includes('先准备导入和练习'));}
   if(shot==='upload'&&seconds===2)assert.ok((await page.locator('.chat-composer-attachments').innerText()).includes('教师教案'));
   await page.screenshot({path:`out/replay-qa/native-${shot}-${seconds}.png`});
  }
  console.log(`Verified native ${shot}, including reverse seeks`);
 }
}finally{await browser.close()}
