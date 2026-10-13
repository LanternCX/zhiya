import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const folder=path.join(root,'out/real-qa');
await mkdir(folder,{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),enableCaching:true});
const browser=await openBrowser('chrome');
try {
  const review=await selectComposition({serveUrl,id:'TeacherRhythmReview',puppeteerInstance:browser});
  for(const frame of [180,420,750,1020,1350,1590]) {
    await renderStill({serveUrl,composition:review,frame,puppeteerInstance:browser,output:path.join(folder,`rhythm-${frame}.jpg`),scale:.5,imageFormat:'jpeg',logLevel:'error'});
  }
  const film=await selectComposition({serveUrl,id:'ArchivedRecordedFilm',puppeteerInstance:browser});
  const timing=JSON.parse(await readFile(path.join(root,'src/real/journey-timing.json'),'utf8'));
  for(const chapter of timing) {
    const processFrames=chapter.id==='generate'?[12,16,21,30,38,47,54]:chapter.id==='revision'?[14,20,29,39,48]:[];
    for(const seconds of [...new Set([-1,0,3,10,chapter.units[1].at+8,chapter.seconds-5,...processFrames])]) {
      await renderStill({serveUrl,composition:film,frame:Math.round((chapter.from+seconds)*30),puppeteerInstance:browser,output:path.join(folder,`${chapter.id}-${seconds.toFixed(1)}.jpg`),scale:.5,imageFormat:'jpeg',logLevel:'error'});
    }
    console.log(`Checked ${chapter.id}`);
  }
  console.log(`Rhythm review: ${(review.durationInFrames/30).toFixed(2)}s`);
} finally {await browser.close({silent:true});}
