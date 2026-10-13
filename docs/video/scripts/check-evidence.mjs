import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser();
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},acceptDownloads:true});
 await page.goto('http://127.0.0.1:3102/?shot=references&time=0');
 await page.getByRole('button',{name:'查看引用：教师教案.docx',exact:true}).first().waitFor();
 await page.getByRole('button',{name:'查看引用：教师教案.docx',exact:true}).first().click();
 await page.getByRole('dialog',{name:'文件引用'}).waitFor();
 assert.ok((await page.getByRole('dialog',{name:'文件引用'}).innerText()).includes('导入'));
 await page.screenshot({path:'out/replay-qa/reference-citation.png'});
 await page.goto('http://127.0.0.1:3102/?shot=export&time=0');
 await page.locator('.deliverable-paper').waitFor();
 await page.waitForTimeout(300);
 await page.getByRole('button',{name:'导出与分享'}).click();
 const download=page.waitForEvent('download');
 await page.getByRole('menuitem',{name:'下载 Word',exact:true}).click();
 const file=await download;await file.saveAs('out/verified-replay-plan.docx');
 await page.getByRole('button',{name:'课堂展示',exact:true}).click();
 await page.getByRole('button',{name:'导出与分享'}).click();
 const slidesDownload=page.waitForEvent('download');
 await page.getByRole('menuitem',{name:'下载 PPTX',exact:true}).click();
 await (await slidesDownload).saveAs('out/verified-replay-classroom.pptx');
 await page.goto('http://127.0.0.1:3102/?shot=generate&time=9');
 await page.locator('.chat-composer-footer').waitFor();
 assert.equal(await page.locator('.chat-composer-footer').evaluate(el=>getComputedStyle(el).justifyContent),'space-between');
 await page.screenshot({path:'out/replay-qa/composer-fixed.png'});
 console.log('Verified actual material citation, Word/PPTX downloads, and composer layout');
}finally{await browser.close()}
