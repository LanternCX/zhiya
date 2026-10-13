import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createMemoryRouter,RouterProvider} from 'react-router';
import App from '../../../apps/client/src/App';
import SharedDeliverable from '../../../apps/client/src/features/deliverables/SharedDeliverable';
import {pageRoutes} from '../../../apps/client/src/routes';
import {TooltipProvider} from '../../../apps/client/src/components/ui/tooltip';
import '../../../apps/client/src/styles.css';
import './elements.css';
import '../../../apps/client/src/motion.css';
import {fixture,seek,materialReplyEnd} from './state';
import './replay.css';
import {classRoute,classActions,actionStage} from './class-actions';
import evidence from './evidence.json';
import {replayTranscript,replayDialogue} from './voice-input';
import {resetCamera,guide} from './visual-guidance';
import {studentMode} from './student-data';

const coursePath=`/courses/${fixture.course.course.id}/conversations/${fixture.course.conversationId}`;
const params=new URLSearchParams(location.search);
let shot=params.get('shot')??'generate';
seek(shot,Number(params.get('time')??0));
const route=(s:string)=>classRoute(s)??(['references','upload','speech','material-process'].includes(s)?`/courses/${fixture.course.course.id}/conversations/${evidence.state.conversationId}`:s==='outline'?`/courses/${fixture.course.course.id}`:s==='profile'?'/learning-profile':s==='onboarding'?'/':coursePath);
const router=createMemoryRouter([{path:'/shares/:token',Component:SharedDeliverable},{path:'/',Component:App,children:pageRoutes}],{initialEntries:[route(shot)]});
const root=createRoot(document.getElementById('root')!);
let mount=0;
const renderApp=()=>root.render(<TooltipProvider key={mount}><RouterProvider router={router}/></TooltipProvider>);
renderApp();
let appliedStage='';
let materialPrevious=-1;
let actionPrevious=0;
let seekPrevious=-1;
const animationStarts=new WeakMap<Animation,number>();
const raf=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
let latest=0;
type SeekRequest={id:number;seconds:number;nextShot:string;preview?:boolean};
let pending:SeekRequest|null=null;
let processing=false;
window.addEventListener('message',async(event)=>{
  if(event.source!==parent||event.data?.type!=='zhiya-seek')return;
  pending=event.data;latest=event.data.id;
  if(processing)return;
  processing=true;
  try{
    while(pending){const request=pending;pending=null;await applySeek(request)}
  }catch(error){parent.postMessage({type:'zhiya-error',id:latest,message:String(error)},'*')}
  finally{processing=false}
});
async function applySeek({id,seconds,nextShot,preview=false}:SeekRequest){
  const stage=nextShot==='speech'?(seconds<1?0:seconds<10?1:seconds<12?2:seconds<13.3?3:4):['upload','material-process'].includes(nextShot)?(seconds<1?0:seconds<4?1:2):actionStage(nextShot,seconds);
  const stageKey=`${nextShot}:${stage}`;
  const changedShot=shot!==nextShot;
  if(changedShot&&shot==='voice-dialogue'){
    document.querySelector<HTMLButtonElement>('[aria-label="退出语音对话"]')?.click();await raf();
  }
  // Reused surfaces belong to the preceding shot. Keep them settled when the
  // local clock restarts, instead of rewinding their entrance to opacity zero.
  if(changedShot){
    for(const animation of document.getAnimations()){
      const end=animation.effect?.getComputedTiming().endTime;
      if(typeof end==='number'&&Number.isFinite(end))animationStarts.set(animation,-end/1000);
      else animationStarts.set(animation,0);
    }
  }
  const student=(value:string)=>['class-join','materials','reader'].includes(value);
  const changedAccount=changedShot&&(student(shot)!==student(nextShot)||(shot==='onboarding')!==(nextShot==='onboarding'));
  const backwards=!changedShot&&seconds<seekPrevious;
  const staged=nextShot==='sharing'||classRoute(nextShot)!==null;
  const resetActions=changedAccount||(backwards&&staged)||(stageKey!==appliedStage&&['speech','upload'].includes(nextShot))||(nextShot==='material-process'&&seconds<materialPrevious);
  const previousStage=changedShot||backwards?0:actionPrevious;
  materialPrevious=nextShot==='material-process'?seconds:-1;
  flushSync(()=>seek(nextShot,seconds));
  if(changedShot){shot=nextShot;if(router.state.location.pathname!==route(shot))await router.navigate(route(shot))}
  if(resetActions){await router.navigate(route(nextShot));mount++;flushSync(renderApp)}
  if(staged&&(changedShot||backwards||stageKey!==appliedStage))await classActions(nextShot,stage,previousStage);
  appliedStage=stageKey;actionPrevious=stage;seekPrevious=seconds;
  if(!preview){
  await document.fonts.ready;
  for(let i=0;i<180;i++){
    await raf();
    const loading=/正在排版课件|正在连接知芽/.test(document.body.innerText)
      ||(nextShot==='reader'&&!document.querySelector('.reader-section'))
      ||(nextShot==='profile'&&(document.querySelector('.memory-document')?.textContent?.length??0)<30)
      ||(nextShot==='practice'&&!document.querySelector('.cm-content'))
      ||(nextShot==='animation'&&!document.querySelector('.x6-node'))
      ||(nextShot==='illustration'&&!document.querySelector<HTMLImageElement>('.illustration-page img')?.complete);
    const slides=[...document.querySelectorAll<HTMLIFrameElement>('.lesson-slide')];
    const slidesReady=slides.every(el=>Boolean(el.contentDocument?.querySelector('svg,section')));
    if(i>=5&&!loading&&slidesReady&&document.querySelector('.workspace,.app,.reader-page'))break;
    if(i===179){parent.postMessage({type:'zhiya-error',id,message:'Original page did not finish loading'},'*');return}
  }
  for(const el of document.querySelectorAll<HTMLIFrameElement>('.lesson-slide'))await el.contentDocument?.fonts.ready;
  }
  if(id!==latest)return;
  if(studentMode&&['document','export'].includes(nextShot)){
    const area=nextShot==='export'&&seconds>=5?'课堂展示':'文档';
    const tab=document.querySelector<HTMLButtonElement>(`button[aria-label="${area}"]`);
    if(tab?.getAttribute('aria-pressed')==='false'){tab.click();await raf();await raf()}
  }
  let target:Element|null=null;
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
  if(nextShot==='voice-dialogue'){
    if(seconds>=.8&&!document.querySelector('[aria-label="退出语音对话"]')){
      buttons.find(button=>button.getAttribute('aria-label')==='进入语音对话')?.click();await raf();await raf();
    }
    flushSync(()=>replayDialogue(seconds));
    target=seconds<2?document.querySelector('[aria-label="退出语音对话"]'):null;
  }
  if(studentMode&&nextShot==='knowledge'&&seconds>=9){
    const citation=buttons.find(button=>button.getAttribute('aria-label')==='查看引用：Python 入门学习资料');
    if(!document.querySelector('[aria-label="知识库引用"]')){citation?.click();await raf()}
    target=citation??null;
  }
  if(nextShot==='speech'&&stage>=1&&stage<4){
    if((resetActions||stage===1)&&!document.querySelector('.chat-composer-capture')){
      buttons.find(button=>button.getAttribute('aria-label')==='开始听写')?.click();await raf();
    }
    flushSync(()=>replayTranscript(seconds));
    target=document.querySelector('[aria-label="停止听写"],[aria-label="开始听写"]');
    if(stage===3){
      const input=document.querySelector<HTMLTextAreaElement>('.course-composer textarea');
      if(input){const text=input.value.replace('先确认范围，再准备材料。','先准备导入和练习。');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));target=document.querySelector('[aria-label="发送"]')??input}
    }
  }
  if(['upload','material-process'].includes(nextShot)&&stage===1&&!document.querySelector('.chat-composer-attachments')){
    const input=document.querySelector<HTMLInputElement>('input[type="file"][aria-label="Upload files"]');
    if(input){
      const files=new DataTransfer();
      for(const [path,name,type] of [['teacher-plan.docx','教师教案.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['illustration.png','食堂情境.png','image/png']]){
        const blob=await(await fetch(new URL(path,location.href))).blob();files.items.add(new File([blob],name,{type}));
      }
      input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));await raf();
      const text=document.querySelector<HTMLTextAreaElement>('.course-composer textarea');
      if(text){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text,'结合这份教案和图片，设计课堂导入。');text.dispatchEvent(new Event('input',{bubbles:true}));}
    }
    target=document.querySelector('[aria-label="发送"]');
  }
  if(nextShot==='material-process'&&stage===2){
    document.querySelectorAll<HTMLButtonElement>('.chat-composer-attachment-remove').forEach(button=>button.click());
    const input=document.querySelector<HTMLTextAreaElement>('.course-composer textarea');
    if(input?.value){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));}
  }
  if(nextShot==='sharing')target=document.querySelector(stage===1?'input[value="class"]':stage===2?'.share-class-option input':stage===3?'.share-class-choice button':'.share-status');
  if((nextShot==='speech'&&stage===4)||(nextShot==='upload'&&stage===2))target=document.querySelector('.chat-composer-submit');
  if(nextShot==='class-create'||nextShot==='class-join')target=document.querySelector(stage===1?'#class-draft':'.class-heading');
  if(nextShot==='class-invite')target=document.querySelector('.class-invitation-code');
  if(nextShot==='materials')target=document.querySelector('.class-material-card');
  if(nextShot==='references'||nextShot==='material-process'){
    const citationAt=nextShot==='material-process'?materialReplyEnd+1:6;
    const citation=buttons.find(button=>button.getAttribute('aria-label')==='查看引用：教师教案.docx');
    const open=Boolean(document.querySelector('[aria-label="文件引用"]'));
    if(seconds>=citationAt&&!open&&citation){citation.click();await raf();await raf()}
    if(seconds<citationAt&&open)document.querySelector<HTMLElement>('[aria-label="文件引用"] button')?.click();
    target=citation??null;
  }
  if(nextShot==='generate'||nextShot==='revision'){
    const prompt=fixture.course.lesson.messages.find(m=>m.id===(nextShot==='generate'?7:19))!.text;
    const input=document.querySelector<HTMLTextAreaElement>('.course-composer textarea,textarea');
    if(input){input.value=seconds<3?prompt.slice(0,Math.floor(seconds/2.5*prompt.length)):'';input.style.height=seconds<3?'140px':''}
    if(seconds<3)target=buttons.find(b=>b.getAttribute('aria-label')==='发送')??input;
  }
  if(nextShot==='onboarding'&&seconds>=4){
    const checkbox=[...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(e=>e.parentElement?.textContent?.includes(studentMode?'初中':'信息技术'));
    if(checkbox&&checkbox.getAttribute('aria-checked')!=='true')checkbox.click();
    target=checkbox??null;
  }
  if(nextShot==='onboarding'&&seconds<4){
    document.querySelectorAll<HTMLElement>('[role="checkbox"][aria-checked="true"]').forEach(e=>e.click());
  }
  if(nextShot==='practice'){
    const output=document.querySelector<HTMLElement>('.coding-page');
    const editor=document.querySelector<HTMLElement>('.coding-editor-shell');
    if(output&&editor)output.scrollTop=seconds<3?0:Math.max(0,editor.offsetTop-output.offsetTop-25);
    target=buttons.find(b=>b.classList.contains('coding-run-button'))??null;
  }
  if(nextShot==='export'){
    const button=buttons.find(b=>b.textContent?.trim()==='导出与分享');
    if(button&&((seconds>=2)!==(button.getAttribute('aria-expanded')==='true'))){
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,ctrlKey:false,pointerType:'mouse'}));
    }
    target=button??null;
  }
  if(nextShot==='animation'){
    const page=fixture.course.lesson.pages.find(p=>p.id==='io-flow-v2')!;
    const button=page.buttons![Math.min(2,Math.floor(seconds/6))];
    target=buttons.find(b=>b.textContent?.trim()===button.label)??null;
    const actions=(seconds%6<2?[]:seconds%6<4?button.steps.slice(0,1):button.steps).flat();
    for(const el of document.querySelectorAll<SVGElement>('[data-replay-stroke]')){el.setAttribute('stroke',el.dataset.replayStroke!);el.setAttribute('stroke-width',el.dataset.replayWidth!)}
    for(const action of actions){
      const cell=document.querySelector(`.animation-page-slot:not([hidden]) [data-cell-id="${action.targetId}"]`);
      if(action.type==='highlight'||action.type==='flow')cell?.querySelectorAll<SVGElement>('path,rect,ellipse,polygon').forEach(el=>{if(!el.dataset.replayStroke){el.dataset.replayStroke=el.getAttribute('stroke')??'none';el.dataset.replayWidth=el.getAttribute('stroke-width')??'1'}el.setAttribute('stroke','#39754d');el.setAttribute('stroke-width','4')});
    }
  }
  for(const animation of document.getAnimations()){
    if(preview){if(animation.playState==='paused')animation.play();continue}
    if(!animationStarts.has(animation)){
      const target=animation.effect instanceof KeyframeEffect?animation.effect.target:null;
      const isOverlay=target instanceof Element&&Boolean(target.closest('[role="dialog"],[role="menu"],.share-overlay,.class-dialog-overlay'));
      const dialog=target instanceof Element&&target.matches('.share-dialog,.share-overlay,.class-dialog,.class-dialog-overlay');
      const boundaries=dialog?(nextShot==='sharing'?[0,2]:[0,1]):isOverlay?(nextShot==='sharing'?[0,2,4,6,9]:nextShot==='export'?[0,2]:[0,1,3.5]):[0];
      animationStarts.set(animation,boundaries.filter(time=>time<=seconds).at(-1)??0);
    }
    animation.pause();animation.currentTime=Math.max(0,seconds-animationStarts.get(animation)!)*1000;
  }
  if(nextShot==='document'){
    const doc=document.querySelector<HTMLElement>('.deliverable-paper');
    let scroll=doc?.parentElement;
    while(scroll&&scroll.scrollHeight<=scroll.clientHeight+5)scroll=scroll.parentElement;
    if(scroll){const progress=seconds<3?0:seconds<3.7?(seconds-3)/.7*.35:seconds<6.5?.35:seconds<7.2?.35+(seconds-6.5)/.7*.35:.7;scroll.scrollTop=progress*(scroll.scrollHeight-scroll.clientHeight)}
  }
  if(nextShot==='profile'){
    const panel=document.querySelector<HTMLElement>('.memory-panel');
    if(panel){let scroll=panel.parentElement;while(scroll&&scroll.scrollHeight<=scroll.clientHeight+5)scroll=scroll.parentElement;if(scroll)scroll.scrollTop=Math.max(0,Math.min(1,(seconds-3)/.8))*.55*(scroll.scrollHeight-scroll.clientHeight)}
  }
  if(nextShot==='class-members'){
    const student=document.querySelector<HTMLElement>('.class-member-section[aria-label="学生"]');
    let scroll=student?.parentElement;
    while(scroll&&scroll.scrollHeight<=scroll.clientHeight+5)scroll=scroll.parentElement;
    if(scroll)scroll.scrollTop=Math.max(0,Math.min(1,(seconds-3)/.7))*Math.min(480,scroll.scrollHeight-scroll.clientHeight);
  }
  if(nextShot==='reader'){
    const scroll=document.scrollingElement;
    if(scroll)scroll.scrollTop=Math.max(0,Math.min(1,(seconds-3)/.7))*650;
  }
  if(!preview){await raf();await raf()}
  document.querySelectorAll<HTMLElement>('.course-thread').forEach(el=>{el.scrollTop=Math.max(0,el.scrollHeight-el.clientHeight)});
  resetCamera();guide(nextShot,seconds,target);
  if(id===latest)parent.postMessage({type:'zhiya-ready',id},'*');
}
parent.postMessage({type:'zhiya-loaded'},'*');
