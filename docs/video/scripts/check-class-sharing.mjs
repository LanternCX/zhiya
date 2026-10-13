import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  for(const [shot,times] of [['class-create',[2,4,2]],['class-invite',[3]],['class-join',[2,4]],['class-members',[1,5]],['sharing',[3,5,7,11,3,11]],['materials',[2]],['reader',[2,5]]]){
    await page.goto(`http://127.0.0.1:3102/?shot=${shot}&time=0`);
    await page.waitForSelector('#root > *');
    for(const seconds of times){
      await page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
        const id=Math.random();const timeout=setTimeout(()=>reject(new Error('Seek timeout')),20000);
        const listener=e=>{if(e.data?.id!==id)return;if(['zhiya-ready','zhiya-error'].includes(e.data.type)){clearTimeout(timeout);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve(true):reject(new Error(e.data.message))}};
        window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
      }),{shot,seconds}).catch(async error=>{await page.screenshot({path:'out/class-replay-error.png'});throw error});
      const text=await page.locator('body').innerText();
      assert.ok(!text.includes('Uncaptured replay request'),text);
      if(shot==='class-members')assert.ok(text.includes('25 位成员'));
      if(shot==='sharing'&&seconds===11)assert.ok(text.includes('已分享给所选班级'));
      if(['class-create','class-join'].includes(shot)&&seconds===4)assert.ok(await page.locator('.class-detail-header').isVisible());
      if(shot==='materials')assert.ok(await page.locator('.class-material-card').count()>0);
      if(shot==='reader')assert.ok(await page.locator('.reader-section').count()>0);
      await page.screenshot({path:`out/replay-qa/${shot}-${seconds}.png`});
    }
    console.log(`Verified ${shot}`);
  }
}finally{await browser.close()}
