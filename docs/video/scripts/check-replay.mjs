import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'out/replay-qa'),{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts')});
const browser=await openBrowser('chrome');
try{
  const film=await selectComposition({serveUrl,id:'TeacherFilm',puppeteerInstance:browser});
  const timeline=JSON.parse(await readFile(path.join(root,'src/real/compact-timing.json'),'utf8'));
  for(const scene of timeline){
    const samples={profile:[4,12],references:[2,4.2,6,8.2,10,12.5,16,22],generate:[2,8,14,18],revision:[5,9,13],animation:[3,7,10],practice:[2,6,10],classes:[2,6,10,16],sharing:[3,7,11],receiving:[2,8],export:[3]};
    const times=(scene.id==='references'?[2,6,9,10.5,13,17,21,25]:scene.id==='export'?[3]:scene.id.startsWith('export-')?[1,6,12]:samples[scene.id])??[Math.min(8,scene.seconds-1)];
    for(const seconds of times)await renderStill({serveUrl,composition:film,frame:Math.round((scene.from+seconds)*30),puppeteerInstance:browser,output:path.join(root,`out/replay-qa/${scene.id}-${seconds}.png`),scale:.5,logLevel:'error'});
    console.log(`Verified ${scene.id}`);
  }
  if(film.durationInFrames!==Math.round(timeline.reduce((total,scene)=>total+scene.seconds,0)*30))throw new Error('Unexpected film duration');
}finally{await browser.close({silent:true})}
