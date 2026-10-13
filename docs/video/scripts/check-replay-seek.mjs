import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const browser=await launchBrowser();
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.goto('http://127.0.0.1:3102/?shot=generate&time=0');
  await page.waitForSelector('.course-thread');
  const seek=async(shot,seconds,preview=false)=>page.evaluate(({shot,seconds,preview})=>new Promise((resolve,reject)=>{
    const id=Math.random();
    const timeout=setTimeout(()=>reject(new Error('Seek timeout')),15000);
    const listener=e=>{if(e.data?.id!==id)return;if(e.data.type==='zhiya-error'){clearTimeout(timeout);window.removeEventListener('message',listener);reject(new Error(e.data.message))}if(e.data.type==='zhiya-ready'){clearTimeout(timeout);window.removeEventListener('message',listener);resolve(true)}};
    window.addEventListener('message',listener);window.postMessage({type:'zhiya-seek',id,nextShot:shot,seconds,preview},'*');
  }),{shot,seconds,preview});
  await seek('generate',12);
  const observable=()=>page.locator('.lesson-slide').evaluate(el=>({text:el.contentDocument.body.innerText,rect:JSON.stringify(el.getBoundingClientRect())}));
  const beforeState=await observable();
  const before=await page.screenshot();
  await seek('generate',22);
  await seek('generate',12);
  const after=await page.screenshot();
  await writeFile('out/replay-seek-before.png',before);await writeFile('out/replay-seek-after.png',after);
  const firstPixels=await sharp(before).ensureAlpha().raw().toBuffer();
  const lastPixels=await sharp(after).ensureAlpha().raw().toBuffer();
  let changedPixels=0;
  for(let i=0;i<firstPixels.length;i+=4)if(firstPixels[i]!==lastPixels[i]||firstPixels[i+1]!==lastPixels[i+1]||firstPixels[i+2]!==lastPixels[i+2])changedPixels++;
  assert.deepEqual(await observable(),beforeState,'Backward seeking must restore content and geometry');
  // SVG text antialiasing changes between compositor surfaces; compare the
  // visible state exactly and permit less than 2% edge pixels to differ.
  assert.ok(changedPixels<1920*1080*.02,`Backward seek changed ${changedPixels} pixels`);
  await seek('revision',5);
  const old=await page.locator('.lesson-slide').evaluate(el=>el.contentDocument.body.innerText);
  await seek('revision',16);
  const changed=await page.locator('.lesson-slide').evaluate(el=>el.contentDocument.body.innerText);
  assert.ok(old.includes('num = 3'));
  assert.ok(!changed.includes('num = 3')&&changed.includes('把 2 改成 3'));
  for(const preview of [false,true]){
    const start=performance.now();
    for(let i=0;i<12;i++)await seek('revision',16+i/30,preview);
    console.log(`${preview?'Preview':'Exact'}: ${((performance.now()-start)/12).toFixed(1)} ms per acknowledged update`);
  }
  await seek('revision',5,true);
  await seek('revision',5);
  assert.ok((await page.locator('.lesson-slide').evaluate(el=>el.contentDocument.body.innerText)).includes('num = 3'),'Preview followed by exact seek must restore the requested slide');
  await page.goto('http://127.0.0.1:3102/?shot=export&time=0');
  await page.waitForSelector('.course-thread');
  await seek('export',4);
  await page.locator('[role="menu"]').waitFor({state:'visible'});
  assert.ok(await page.getByRole('menuitem',{name:'下载 Word',exact:true}).isVisible());
  await seek('export',0);
  await page.locator('[role="menu"]').waitFor({state:'hidden'});
  await seek('export',4);
  await page.locator('[role="menu"]').waitFor({state:'visible'});
  await page.screenshot({path:'out/replay-export-menu.png'});
  console.log('Passed backward seek, real before/after revision, and export menu replay checks');
}finally{await browser.close()}
