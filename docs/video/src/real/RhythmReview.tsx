import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {ArrowUp, MessageCircle} from 'lucide-react';
import {MotionBridge} from './MotionBridge';
import {OpeningMotion} from '../full/FullFilm';
import timing from './timing.json';
import {Subtitle} from './Subtitle';

const opening=timing[0].voices[0];
const context=timing[1].voices;
const introEnd=Math.ceil((opening.duration+.8)*30);
const questionAt=introEnd;
const detailAt=questionAt+Math.ceil((context[0].duration+.45)*30);
const resultAt=detailAt+Math.ceil((context[1].duration+.65)*30);
export const rhythmReviewFrames=resultAt+Math.ceil((context[2].duration+2)*30);

export function RhythmReview() {
  const frame=useCurrentFrame();
  const transition=interpolate(frame,[introEnd-18,introEnd+10],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const lines=[{from:0,voice:opening},{from:questionAt,voice:context[0]},{from:detailAt,voice:context[1]},{from:resultAt,voice:context[2]}];
  return <AbsoluteFill style={{background:'#f5f5ef',fontFamily:'PingFang SC,sans-serif',overflow:'hidden'}}>
    <AbsoluteFill style={{opacity:1-transition,zIndex:0}}><OpeningMotion frame={Math.min(frame,introEnd)}/></AbsoluteFill>
    <Sequence from={introEnd-18} durationInFrames={detailAt-introEnd+18}><AbsoluteFill style={{opacity:transition,zIndex:1}}><MotionBridge kind="context" frame={frame-introEnd+18}/></AbsoluteFill></Sequence>
    <Sequence from={detailAt} durationInFrames={resultAt-detailAt}><AbsoluteFill style={{zIndex:1,background:'#edf2e7',padding:90,color:'#244c35'}}>
      <div style={{fontSize:46,marginTop:15}}>老师提出的需求，决定这一课的边界。</div>
      <div style={{position:'absolute',left:90,top:250,width:840,height:570,boxSizing:'border-box',padding:'42px 48px',borderRadius:24,border:'1px solid #b7ccb0',boxShadow:'0 18px 45px #25452a12',background:'#fffefa'}}>
        <div style={{display:'flex',alignItems:'center',gap:14,fontSize:25,color:'#74836c',marginBottom:30}}><MessageCircle size={28}/>老师的备课需求</div>
        <div style={{fontSize:37,lineHeight:1.8,color:'#304a35'}}>
          <div>明天给<span style={{background:'#e4eddb',borderRadius:5}}>初一零基础学生</span></div>
          <div>上一节 Python 入门课。</div>
          <div style={{marginTop:15}}><span style={{background:'#e4eddb',borderRadius:5}}>40 分钟，两人一机。</span></div>
          <div style={{marginTop:15}}>用食堂点餐讲清楚</div>
          <div><span style={{background:'#e4eddb',borderRadius:5}}>变量、输入和输出。</span></div>
        </div>
        <div style={{position:'absolute',right:38,bottom:30,width:54,height:54,borderRadius:27,background:'#356746',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',transform:`scale(${interpolate(frame,[resultAt-12,resultAt-6,resultAt],[1,.88,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})})`}}><ArrowUp size={28}/></div>
      </div>
      <div style={{position:'absolute',left:1030,top:265,display:'flex',flexDirection:'column',gap:28}}>{['教学对象：初一 · 零基础','课堂条件：40 分钟 · 两人一机','知识范围：变量 · 输入 · 输出'].map((text,i)=><div key={text} style={{fontSize:34,padding:'32px 38px',width:780,borderRadius:18,background:'#fffefa',border:'1px solid #c2d2b8',opacity:interpolate(frame-detailAt,[i*70,i*70+18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>{text}</div>)}</div>
    </AbsoluteFill></Sequence>
    <Sequence from={resultAt}><AbsoluteFill style={{zIndex:1}}><OffthreadVideo src={staticFile('demo/01-prepare.webm')} trimBefore={90} muted style={{width:1920,height:1080}}/></AbsoluteFill></Sequence>
    <Subtitle seconds={frame/30} voices={lines.map(line=>({from:line.from/30,captions:line.voice.captions}))}/>
    {lines.map((l,i)=><Sequence key={i} from={l.from} durationInFrames={Math.ceil(l.voice.duration*30)}><Audio src={staticFile(l.voice.file)}/></Sequence>)}
  </AbsoluteFill>;
}
