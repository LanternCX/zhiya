import React from 'react';
import {AbsoluteFill,Audio,OffthreadVideo,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {Sprout,ArrowRight,UserRound,BookOpen,FileText} from 'lucide-react';
import {OpeningMotion} from '../full/FullFilm';
import {SourceReplay} from './SourceReplay';
import {Subtitle} from './Subtitle';
import {SceneLayout} from './SceneLayouts';
import timeline from './compact-timing.json';
const ink='#2c5139',muted='#71836a';
type Scene=typeof timeline[number];
export const compactFrames=Math.round(timeline.reduce((n,s)=>n+s.seconds,0)*30);

function Request({revision=false,seconds}:{revision?:boolean;seconds:number}){
  const lines=revision?['一句解释：变量就是给数据起个名字','一行代码：baozi_price = 2','一个追问：把 2 改成 3，会发生什么？']:['初一学生，完全没有编程基础','40 分钟，两人一机','用食堂点餐，讲变量、输入和输出'];
  return <div style={{position:'absolute',inset:'160px 130px',color:ink}}><div style={{fontSize:27,color:muted}}>老师确定内容</div><h2 style={{fontSize:60,fontWeight:500,margin:'30px 0 70px'}}>{revision?'太复杂了，就把修改说具体。':'先把这堂课的边界说清楚。'}</h2>{lines.map((text,i)=><div key={text} style={{fontSize:42,padding:'30px 0',borderBottom:'1px solid #cbd8c1',opacity:interpolate(seconds,[i*1.5,i*1.5+.5],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><span style={{fontSize:24,marginRight:40,color:muted}}>0{i+1}</span>{text}</div>)}<div style={{marginTop:48,fontSize:27,color:muted,display:'flex',gap:20,alignItems:'center'}}>{revision?'检查修改结果':'确定范围，开始生成'}<ArrowRight size={28}/></div></div>;
}
function ProfileIntro(){return <div style={{position:'absolute',inset:'170px 130px',color:ink}}><UserRound size={70} strokeWidth={1.3}/><h2 style={{fontSize:64,fontWeight:500}}>先了解老师，再协助备课。</h2><div style={{display:'flex',gap:110,marginTop:80}}>{['教学背景','学生起点','课堂条件'].map((s,i)=><div key={s}><div style={{fontSize:25,color:muted}}>0{i+1}</div><div style={{fontSize:42,marginTop:22}}>{s}</div></div>)}</div></div>}
function nativePosition(scene:Scene,s:number):{shot:string;seconds:number}|null{
  if(scene.id==='profile')return s<2?null:{shot:s<8?'onboarding':'profile',seconds:s-(s<8?2:8)};
  if(scene.id==='generate')return s<17?{shot:'generate',seconds:s*1.5}:null;
  if(scene.id==='revision')return s<4?null:{shot:'revision',seconds:(s-4)*2};
  if(scene.id==='classes')return {shot:s<4?'class-create':s<8?'class-invite':s<12?'class-join':'class-members',seconds:s-(s<4?0:s<8?4:s<12?8:12)};
  if(scene.id==='receiving')return {shot:s<4?'materials':'reader',seconds:s-(s<4?0:4)};
  if(['speech','references','animation','practice','question','illustration','document','sharing','export'].includes(scene.id))return {shot:scene.id==='references'?'material-process':scene.id,seconds:s*(scene.id==='animation'?1.7:scene.id==='practice'?2.5:1)};
  return null;
}
function CompactScene({scene}:{scene:Scene}){
  const frame=useCurrentFrame(),s=frame/30;
  let content:React.ReactNode;
  switch(scene.id){
    case 'opening':content=<OpeningMotion frame={frame}/>;break;
    case 'profile':content=<Sequence durationInFrames={60}><ProfileIntro/></Sequence>;break;
    case 'task':content=<Request seconds={s}/>;break;
    case 'generate':content=<Sequence from={510}><SceneLayout id="generate" phase={2} seconds={s-17} lead="同一任务，形成不同用途的材料" items={['讲解页','过程动画','教师教案']} details={['讲清概念','观察变化','组织课堂']}/></Sequence>;break;
    case 'revision':content=<Sequence durationInFrames={120}><Request revision seconds={s}/></Sequence>;break;
    case 'speech':case 'references':case 'animation':case 'practice':case 'question':case 'illustration':case 'document':case 'classes':case 'sharing':case 'receiving':case 'export':content=null;break;
    case 'export-word':content=<OffthreadVideo src={staticFile('office/user-word.mp4')} muted style={{width:'100%',height:'100%',objectFit:'contain',background:'#f4f4f4'}}/>;break;
    case 'export-ppt':content=<OffthreadVideo src={staticFile('office/user-ppt.mp4')} muted style={{width:'100%',height:'100%',objectFit:'contain',background:'#f4f4f4'}}/>;break;
    default:content=<SceneLayout id="closing" phase={1} seconds={s} lead="这堂课怎么教，由老师决定。" items={[]} details={[]}/>;
  }
  return <AbsoluteFill style={{fontFamily:'PingFang SC,sans-serif'}}>{content}<Subtitle seconds={s} voices={[{from:0,captions:scene.voice.captions}]}/><Sequence durationInFrames={Math.ceil(scene.voice.duration*30)}><Audio src={staticFile(scene.voice.file)}/></Sequence></AbsoluteFill>;
}
export function CompactFilm(){
  const seconds=useCurrentFrame()/30;
  const scene=timeline.find(s=>seconds>=s.from&&seconds<s.from+s.seconds);
  const position=scene?nativePosition(scene,seconds-scene.from):null;
  const previous=React.useRef({shot:'onboarding',seconds:0});
  if(position)previous.current=position;
  return <AbsoluteFill style={{background:'#edf2e7'}}><AbsoluteFill style={{visibility:position?'visible':'hidden',overflow:'hidden'}}><SourceReplay {...previous.current}/></AbsoluteFill>{timeline.map(scene=><Sequence key={scene.id} from={Math.round(scene.from*30)} durationInFrames={Math.round(scene.seconds*30)}><CompactScene scene={scene}/></Sequence>)}</AbsoluteFill>;
}
