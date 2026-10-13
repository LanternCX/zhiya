import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ArrowRight, BookOpen, Check, FileText, Layers, MessageCircle, Mic, MonitorPlay, Sprout} from 'lucide-react';
import './style.css';
import {LessonWorkspace} from './demo/LessonWorkspace';

const enter = (frame: number, start = 0) => spring({frame: frame - start, fps: 30, config: {damping: 22, stiffness: 110}});
const fade = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

function Reveal({children, delay = 0, className = ''}: {children: React.ReactNode; delay?: number; className?: string}) {
  const frame = useCurrentFrame();
  const p = enter(frame, delay);
  return <div className={className} style={{opacity: p, transform: `translateY(${(1-p)*42}px)`}}>{children}</div>;
}

function Shell({children, section}: {children: React.ReactNode; section: string}) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  return <AbsoluteFill className="film">
    <div className="paper-grid" />
    <header><span className="brand"><Sprout size={31} strokeWidth={1.8} />知芽<span className="brand-en">ZHIYA</span></span><span className="section-label">{section}</span></header>
    {children}
    <footer><span>A12 · 多模态 AI 互动式教学智能体</span><span>教师课件共创 / 视觉样片</span></footer>
    <div className="progress-track"><div style={{width: `${frame/durationInFrames*100}%`}} /></div>
  </AbsoluteFill>;
}

function Pain() {
  const frame = useCurrentFrame();
  const cards = [
    {title: '梳理教学思路', text: '目标 · 重点 · 授课顺序', icon: BookOpen, left: 1030, top: 238, angle: -7},
    {title: '制作演示课件', text: '案例 · 配图 · 页面排版', icon: Layers, left: 1210, top: 430, angle: 6},
    {title: '编写配套教案', text: '讲解 · 活动 · 课后练习', icon: FileText, left: 1000, top: 630, angle: -3},
  ];
  return <AbsoluteFill>
    <div className="intro-copy">
      <Reveal><div className="eyebrow">明天，又是一节新课。</div></Reveal>
      <Reveal delay={12}><h1>一个教学想法，<br />多少次工具切换？</h1></Reveal>
      <Reveal delay={30}><p>从内容组织到形式制作，<br />备课的每一步，都需要老师投入精力。</p></Reveal>
      <Reveal delay={65}><div className="pill">让老师的精力，回到教学设计。</div></Reveal>
    </div>
    <svg className="connection" viewBox="0 0 1920 1080"><path d="M 1150 315 C 1620 315 1600 765 1110 750" /></svg>
    {cards.map(({title,text,icon: Icon,left,top,angle},i) => {
      const p=enter(frame,20+i*22);
      return <div key={title} className="task-card" style={{left,top,opacity:p,transform:`translateY(${(1-p)*65}px) rotate(${angle*p}deg)`}}>
        <div className="task-icon"><Icon size={37} strokeWidth={1.5} /></div>
        <span className="task-num">0{i+1}</span><h3>{title}</h3><p>{text}</p>
      </div>;
    })}
  </AbsoluteFill>;
}

function Brand({closing = false}: {closing?: boolean}) {
  const frame=useCurrentFrame();
  return <AbsoluteFill className="brand-scene">
    <div className="orbit orbit-one" style={{transform:`rotate(${frame*.08}deg)`}} /><div className="orbit orbit-two" />
    <Reveal><div className="sprout-seal"><Sprout size={84} strokeWidth={1.35} /></div></Reveal>
    <Reveal delay={12}><div className="eyebrow">以教师的教学思路为核心</div></Reveal>
    <Reveal delay={24}><h1>{closing ? <>让教学想法，<br />长成一堂课。</> : <>把你的教学想法，<br />交给知芽一起完成。</>}</h1></Reveal>
    <Reveal delay={40}><p>{closing ? '知芽 · 多模态 AI 互动式教学智能体' : '理解意图 / 融合资料 / 共创课件 / 持续优化'}</p></Reveal>
  </AbsoluteFill>;
}

const request = '为初中生准备一节 40 分钟的 Python 入门课。先用生活案例引入，再讲解程序的运行过程，加入一个动手活动。';

function Intent() {
  const frame=useCurrentFrame();
  const typed=request.slice(0,Math.floor(interpolate(frame,[25,140],[0,request.length],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})));
  return <AbsoluteFill>
    <div className="intent-copy"><Reveal><div className="eyebrow">01 / 从教学意图开始</div></Reveal><Reveal delay={10}><h1>你决定怎么教。<br /><span>知芽协助实现。</span></h1></Reveal><Reveal delay={25}><p>用自然语言表达目标、<br />授课对象和你希望的课堂体验。</p></Reveal><Reveal delay={175}><div className="intent-note"><Check size={26} />围绕教学任务，持续沟通与调整</div></Reveal></div>
    <div className="brief-panel" style={{opacity:enter(frame,10),transform:`translateY(${(1-enter(frame,10))*40}px)`}}>
      <div className="panel-top"><span><MessageCircle size={25} />一节课，从一个想法开始</span><small>教学场景示意</small></div>
      <div className="teacher-avatar">师</div><div className="teacher-bubble">{typed}<span className="caret" style={{opacity:frame<140 && frame%24<12 ? 1:0}}>│</span></div>
      <div className="brief-context" style={{opacity:fade(frame,155,180)}}><span><Check size={21} />初中 · 零基础</span><span><Check size={21} />40 分钟</span><span><Check size={21} />案例 + 动手活动</span></div>
      <div className="agent-response" style={{opacity:fade(frame,195,215),transform:`translateY(${(1-enter(frame,195))*25}px)`}}><Sprout size={32} /><div><strong>让教学安排围绕你的目标展开</strong><p>梳理讲解顺序，为关键知识点选择合适的呈现方式。</p></div></div>
      <div className="input-decoration">继续补充你的教学想法…<Mic size={23} /><div><ArrowRight size={24} /></div></div>
    </div>
  </AbsoluteFill>;
}

function Demo() {
  const frame=useCurrentFrame();
  const scale=interpolate(frame,[0,390],[1,1.04],{extrapolateRight:'clamp'});
  return <AbsoluteFill>
    <div className="demo-heading"><Reveal><div className="eyebrow">02 / 从想法，到可展示的内容</div></Reveal><Reveal delay={8}><h2>把程序的运行过程，讲得更直观。</h2></Reveal><div className="recording-label"><span />网页 MG 动画 · 演示数据</div></div>
    <div className="demo-window" style={{opacity:fade(frame,0,16),transform:`scale(${scale})`}}><LessonWorkspace /></div>
    <div className="demo-caption"><MonitorPlay size={26} /><span>讲解、过程动画与课程文档，围绕同一个教学目标。</span></div>
  </AbsoluteFill>;
}

const scenes = [
  {start:0,duration:270,component:Pain,audio:'pain',subtitle:'让老师的精力，回到教学设计。'},
  {start:270,duration:180,component:Brand,audio:'brand',subtitle:'知芽，让教学思路成为课件共创的起点。'},
  {start:450,duration:360,component:Intent,audio:'intent',subtitle:'表达授课对象、教学目标和你希望的课堂体验。'},
  {start:810,duration:390,component:Demo,audio:'demo',subtitle:''},
  {start:1200,duration:150,component:()=><Brand closing />,audio:'close',subtitle:''},
];

export function TeacherSample() {
  const frame=useCurrentFrame();
  const section=frame<270?'教学设计，值得更多专注':frame<810?'从教学想法出发':frame<1200?'让知识更好懂':'知芽 / 教师课件共创';
  return <Shell section={section}>{scenes.map(({start,duration,component:Scene,audio,subtitle}) => <Sequence key={start} from={start} durationInFrames={duration}>
    <Scene />
    <Sequence from={audio === 'intent' ? 3 : 12}><Audio src={staticFile(`voice-qwen/${audio}.wav`)} /></Sequence>
    {subtitle && <div className="subtitle">{subtitle}</div>}
  </Sequence>)}</Shell>;
}
