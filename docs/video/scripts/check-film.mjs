import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const timeline=JSON.parse(await readFile(path.join(root,'src/full/timing.json'),'utf8'));
const folder=path.join(root,'out/film-qa');
await mkdir(folder,{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),enableCaching:true});
const browser=await openBrowser('chrome');
try {
  const composition=await selectComposition({serveUrl,id:'ArchivedConcept',puppeteerInstance:browser});
  for(const chapter of timeline){
    for(let beat=0;beat<4;beat++){
      const frame=chapter.from+chapter.beats[beat]+145;
      await renderStill({serveUrl,composition,frame,puppeteerInstance:browser,
        output:path.join(folder,`${chapter.id}-${beat}.jpg`),imageFormat:'jpeg',jpegQuality:85,scale:.5,logLevel:'error'});
    }
    console.log(`Checked ${chapter.id}`);
  }
} finally {await browser.close({silent:true});}
