import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const seek=(shot,seconds)=>page.evaluate(({shot,seconds})=>new Promise((resolve,reject)=>{
    const id=Math.random(),timer=setTimeout(()=>reject(new Error('Seek timeout')),20000);
    const listener=e=>{if(e.data?.id!==id||!['zhiya-ready','zhiya-error'].includes(e.data.type))return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.type==='zhiya-ready'?resolve():reject(new Error(e.data.message))};
    window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds},'*');
  }),{shot,seconds});
  for(const shot of ['sharing','export']){
    await page.goto(`http://127.0.0.1:3102/?shot=${shot}`);
    await seek(shot,3);
    await page.evaluate(()=>{window.continuityPage=document.querySelector('.course-thread');window.continuityOverlay=document.querySelector('[role="dialog"],[role="menu"]')});
    for(const seconds of shot==='sharing'?[5,7,11]:[3.1,3.3,3.8]){
      await seek(shot,seconds);
      assert.ok(await page.evaluate(()=>window.continuityPage===document.querySelector('.course-thread')),'Click must preserve the existing course page');
      assert.ok(await page.evaluate(()=>window.continuityOverlay?.isConnected),'Click must preserve the open overlay');
    }
    if(shot==='sharing')assert.ok((await page.locator('body').innerText()).includes('已分享给所选班级'));
    await seek(shot,0);
    assert.equal(await page.locator('[role="dialog"],[role="menu"]').count(),0,'Backward seek must close the overlay');
    await seek(shot,shot==='sharing'?11:3);
    console.log(`Passed continuous ${shot} clicks and backward seek`);
  }
  await page.goto('http://127.0.0.1:3102/?shot=document');
  await seek('document',2);
  await page.evaluate(()=>window.continuityPage=document.querySelector('.course-thread'));
  await seek('sharing',3);
  assert.ok(await page.evaluate(()=>window.continuityPage===document.querySelector('.course-thread')),'Document to sharing must retain the course page');
  const origin=await page.evaluate(()=>performance.timeOrigin);
  for(const [shot,seconds] of [['class-create',2],['class-create',3.7],['class-invite',2],['class-join',2],['class-join',3.7],['class-members',2],['sharing',3],['sharing',11],['materials',2],['reader',2],['export',3]])await seek(shot,seconds);
  assert.equal(await page.evaluate(()=>performance.timeOrigin),origin,'Scene changes must not reload the replay document');
  assert.ok(await page.getByRole('menuitem',{name:'下载 Word',exact:true}).isVisible());
  console.log('Passed continuous scene navigation through classes, sharing, reader and export');
  await page.goto('http://127.0.0.1:3102/?shot=onboarding');
  await seek('onboarding',1);
  await page.evaluate(()=>{
    window.routeErrors=[];
    new MutationObserver(()=>{if(/对话不存在|课程不存在/.test(document.body.innerText))window.routeErrors.push(document.body.innerText)}).observe(document.body,{childList:true,subtree:true,characterData:true});
  });
  for(const [shot,seconds] of [['profile',2],['speech',0],['speech',13.5],['material-process',0],['material-process',10],['material-process',18],['material-process',25],['generate',0],['generate',12],['revision',5],['animation',3],['practice',8],['question',3],['illustration',3],['document',3]]){
    await seek(shot,seconds).catch(async error=>{console.error(shot,seconds,(await page.locator('body').innerText()).slice(0,1800));throw error});
  }
  assert.deepEqual(await page.evaluate(()=>window.routeErrors),[],'Continuous demo must never show a missing-conversation error, including intermediate DOM updates');
  console.log('Passed materials-to-generation navigation without missing-conversation flashes');
}finally{await browser.close()}
