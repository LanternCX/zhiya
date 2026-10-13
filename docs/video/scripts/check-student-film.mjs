import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const timeline=JSON.parse(await readFile(path.join(root,'src/student/timing.json'),'utf8'));
await mkdir(path.join(root,'out/student-film-qa'),{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts')});
const browser=await openBrowser('chrome');
try{
  const composition=await selectComposition({serveUrl,id:'StudentFilm',puppeteerInstance:browser});
  for(const scene of timeline){
    if(process.env.STUDENT_QA_SCENES&&!process.env.STUDENT_QA_SCENES.split(',').includes(scene.id))continue;
    const samples=scene.id==='speech'?[9,16,23,31]:scene.id==='practice'?[9,16]:scene.id==='export'?[3,7]:scene.id==='knowledge'?[3,11]:[6];
    const times=[...new Set([...samples,scene.frames/30-.2].map(s=>Math.min(s,scene.frames/30-.2)))];
    for(const seconds of times)await renderStill({serveUrl,composition,frame:scene.from+Math.round(seconds*30),puppeteerInstance:browser,output:path.join(root,`out/student-film-qa/${scene.id}-${seconds}.png`),scale:.5,logLevel:'error'});
    console.log('Verified student film',scene.id);
  }
}finally{await browser.close({silent:true})}
