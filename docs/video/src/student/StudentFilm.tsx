import React from 'react';
import {AbsoluteFill,Audio,Sequence,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {ArrowRight,BookOpen,MessageCircle,Code2,Sprout} from 'lucide-react';
import {SourceReplay} from '../real/SourceReplay';
import {Subtitle} from '../real/Subtitle';
import timeline from './timing.json';
import {studentReplaySeconds} from './playback';
import dialogue from './dialogue-timing.json';

export const studentFrames=timeline.reduce((sum,scene)=>sum+scene.frames,0);
function Motion({title,lead}:{title:string;lead:string}){
  const s=useCurrentFrame()/30;
  return <AbsoluteFill style={{background:'#edf2e7',padding:'125px 140px',color:'#2c5139'}}>
    <div style={{display:'flex',gap:15,alignItems:'center',fontSize:28}}><Sprout/>知芽 · 学生端</div>
    <h1 style={{fontSize:76,fontWeight:500,marginTop:95,transform:`translateY(${interpolate(s,[0,.6],[25,0],{extrapolateRight:'clamp'})}px)`}}>{title}</h1>
    <p style={{fontSize:32,color:'#71836a'}}>{lead}</p>
    <div style={{display:'flex',gap:50,marginTop:110}}>{[[MessageCircle,'提出问题'],[BookOpen,'观察与理解'],[Code2,'动手与反馈']].map(([Icon,label],i)=>{
      const Symbol=Icon as typeof MessageCircle;
      return <div key={String(label)} style={{display:'flex',alignItems:'center',gap:35,opacity:interpolate(s,[1+i*.6,1.5+i*.6],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><div style={{background:'#fff',padding:35,borderRadius:25,minWidth:330}}><Symbol size={48}/><div style={{fontSize:34,marginTop:24}}>{String(label)}</div></div>{i<2&&<ArrowRight size={36}/>}</div>;
    })}</div>
  </AbsoluteFill>;
}
export function StudentFilm(){
  const frame=useCurrentFrame();
  const active=timeline.find(scene=>frame>=scene.from&&frame<scene.from+scene.frames)!;
  const s=(frame-active.from)/30;
  const shot='shot' in active?active.shot:undefined;
  const replaySeconds=studentReplaySeconds(active.id,s);
  return <AbsoluteFill style={{background:'#edf2e7',fontFamily:'PingFang SC,sans-serif'}}>
    <AbsoluteFill style={{visibility:shot?'visible':'hidden',overflow:'hidden'}}><SourceReplay audience="student" shot={shot??'onboarding'} seconds={shot?replaySeconds:0}/></AbsoluteFill>
    {timeline.map(scene=><Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames}>
      {!('shot' in scene)&&<Motion title={scene.title} lead={'lead' in scene?scene.lead:''}/>}
      <StudentCaption scene={scene}/>
      <Audio src={staticFile(scene.voice.file)}/>
      {scene.id==='speech'&&dialogue.map(turn=><Sequence key={turn.id} from={Math.round(turn.from*30)} durationInFrames={Math.ceil(turn.duration*30)}><Audio src={staticFile(turn.file)}/></Sequence>)}
    </Sequence>)}
  </AbsoluteFill>;
}
function StudentCaption({scene}:{scene:typeof timeline[number]}){
  return <Subtitle seconds={useCurrentFrame()/30} voices={[{from:0,captions:scene.voice.captions},...(scene.id==='speech'?dialogue:[])]}/>;
}
