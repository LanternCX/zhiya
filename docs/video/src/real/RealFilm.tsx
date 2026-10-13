import React from 'react';
import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import timing from './timing.json';
import {OpeningMotion} from '../full/FullFilm';
import {MotionBridge} from './MotionBridge';
import {Subtitle} from './Subtitle';

type Shot = {at:number; end:number; file:string; start?:number; focus?:[number,number,number]; label?:string; box?:[number,number,number,number]};
const shots:Record<string,Shot[]> = {
  opening:[{at:0,end:45,file:'slide.png',focus:[.66,.43,1.3]}],
  context:[{at:0,end:18,file:'01-prepare.webm',start:0,label:'谁来学？有多少时间？'}, {at:18,end:36,file:'01-prepare.webm',start:3,focus:[.235,.30,2.1],label:'把教学条件说清楚'}, {at:36,end:50,file:'01-prepare.webm',start:10,label:'同一节课，继续向下准备'}],
  goals:[{at:0,end:22,file:'01-prepare.webm',start:14,focus:[.23,.5,1.85],label:'先确定学生能做什么'}, {at:22,end:42,file:'01-prepare.webm',start:40,focus:[.23,.55,1.85],label:'再检查课堂安排'}, {at:42,end:55,file:'01-prepare.webm',start:68,label:'老师先确认方向'}],
  generate:[{at:0,end:18,file:'02-generate.webm',start:35,focus:[.24,.78,1.7],label:'提出明确的材料需求'}, {at:18,end:42,file:'02-generate.webm',start:50,label:'模型执行，课堂内容生成'}, {at:42,end:65,file:'02-generate.webm',start:77,focus:[.67,.52,1.4],label:'生成后，直接查看'}],
  slides:[{at:0,end:18,file:'slide.png',focus:[.66,.49,1.45],label:'输出：让结果看得见'}, {at:18,end:36,file:'variable.png',focus:[.66,.49,1.45],label:'变量：为数据命名'}, {at:36,end:55,file:'input.png',focus:[.66,.49,1.45],label:'输入：接收顾客的回答'}],
  animation:[{at:0,end:12,file:'animation.png',label:'数据如何一步步流动？'}, {at:12,end:26,file:'08-animation.webm',start:6,label:'输入：顾客提供数据'}, {at:26,end:40,file:'08-animation.webm',start:28,label:'变量：保存输入的数据'}, {at:40,end:50,file:'08-animation.webm',start:87,label:'输出：屏幕显示结果'}, {at:50,end:60,file:'animation.png',label:'回到全景，检查整个过程'}],
  practice:[{at:0,end:15,file:'run.png',focus:[.66,.6,1.4],label:'老师先试一遍'}, {at:15,end:42,file:'06-run.webm',start:57,focus:[.66,.62,1.4],label:'运行代码，检查实际输出'}, {at:42,end:60,file:'question.png',focus:[.66,.50,1.4],label:'确认理解，再继续讲解'}],
  revision:[{at:0,end:16,file:'variable.png',focus:[.66,.49,1.45],label:'第一版：内容偏多'}, {at:16,end:42,file:'04-revise.webm',start:21,label:'用一句话，提出具体修改'}, {at:42,end:65,file:'revised.png',focus:[.66,.49,1.45],label:'一句解释 · 一行代码 · 一个追问'}],
  document:[{at:0,end:15,file:'teacher-plan.png',label:'课堂内容与备课文档'}, {at:15,end:35,file:'09-document.webm',start:9,label:'检查课堂流程'}, {at:35,end:48,file:'09-document.webm',start:36,label:'对照讲解与操作步骤'}, {at:48,end:60,file:'09-document.webm',start:60,label:'准备学生出错时的应对'}],
  export:[{at:0,end:55,file:'10-export.webm',start:0,label:'把材料带进课堂'}],
  closing:[{at:0,end:30,file:'revised.png',focus:[.66,.49,1.4]}],
};

function Camera({shot,tick}:{shot:Shot;tick:number}) {
  const style:React.CSSProperties={position:'absolute',inset:0,width:1920,height:1080};
  return <div style={style}>
    {shot.file.endsWith('.webm')?<OffthreadVideo src={staticFile(`demo/${shot.file}`)} trimBefore={Math.round((shot.start??0)*30)} muted style={{width:'100%',height:'100%'}}/>:<Img src={staticFile(`demo/${shot.file}`)} style={{width:'100%',height:'100%'}}/>}
  </div>;
}

function Chapter({chapter}:{chapter:typeof timing[number]}) {
  const frame=useCurrentFrame();
  const seconds=frame/30;
  const list=shots[chapter.id];
  const shot=list.find(s=>seconds>=s.at&&seconds<s.end)??list[list.length-1];
  const isBookend=chapter.id==='opening'||chapter.id==='closing';
  return <AbsoluteFill style={{background:'#f7f8f4',fontFamily:'PingFang SC, sans-serif',overflow:'hidden'}}>
    {list.map((s,i)=><Sequence key={i} from={s.at*30} durationInFrames={(s.end-s.at)*30}><Camera shot={s} tick={frame-s.at*30}/></Sequence>)}
    {chapter.id==='opening'?<OpeningMotion frame={frame}/>:isBookend?<MotionBridge kind="closing" frame={frame}/>:frame<180&&chapter.id!=='slides'?<MotionBridge kind={chapter.id} frame={frame}/>:null}
    {!isBookend&&frame>=180&&<>
      <div style={{position:'absolute',top:22,left:26,background:'rgba(249,251,247,.97)',border:'1px solid #d6dfd1',borderRadius:16,padding:'14px 25px',fontSize:26,color:'#285d3c',boxShadow:'0 8px 30px #18382012'}}>{chapter.title}</div>
      {shot.label&&<div style={{position:'absolute',right:32,bottom:105,background:'#244c35',color:'white',padding:'16px 26px',borderRadius:14,fontSize:28}}>{shot.label}</div>}
    </>}
    <Subtitle seconds={seconds} voices={chapter.voices.map(voice=>({from:voice.at,captions:voice.captions}))}/>
    {chapter.voices.map((v,i)=><Sequence key={i} from={v.at*30} durationInFrames={Math.ceil(v.duration*30)}><Audio src={staticFile(v.file)}/></Sequence>)}
    <div style={{position:'absolute',bottom:0,left:0,height:4,width:`${seconds/chapter.seconds*100}%`,background:'#39704b'}}/>
  </AbsoluteFill>;
}

export const RealFilm:React.FC=()=> <AbsoluteFill>{timing.map(chapter=><Sequence key={chapter.id} from={chapter.from*30} durationInFrames={chapter.seconds*30}><Chapter chapter={chapter}/></Sequence>)}</AbsoluteFill>;
