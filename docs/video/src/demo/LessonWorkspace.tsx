import {ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Code, Download, FileText, Mic, Monitor, Play, Save, Sprout, Users} from 'lucide-react';
import {interpolate, spring, useCurrentFrame} from 'remotion';
import lesson from './lesson.json';
import './workspace.css';

const icons = [Code, Save, Play, Monitor];

export function LessonWorkspace() {
  const frame = useCurrentFrame();
  const current = Math.min(3, Math.max(-1, Math.floor((frame - 50) / 72)));
  const progress = Math.min(1, Math.max(0, (frame - 20) / 40));
  return <div className="mock-workspace">
    <aside className="mock-nav"><div className="mock-logo"><Sprout size={27}/>知芽</div><div className="mock-nav-active"><BookOpen size={20}/>学习</div><div><Users size={20}/>我的班级</div><small>最近对话</small><div className="mock-recent">第一行程序<br/><small>Python 入门</small></div><div className="mock-profile"><span>陈</span>{lesson.teacher}</div></aside>
    <section className="mock-chat"><div className="mock-chat-title"><ChevronLeft size={20}/>{lesson.title}</div><div className="mock-chat-body"><div className="mock-request">{lesson.request}</div><div className="mock-reply" style={{opacity:progress}}><Sprout size={23}/><div>{lesson.response}</div></div><div className="mock-status" style={{opacity:progress}}><Check size={15}/>课堂页面已准备好</div><div className="mock-context"><span>教学安排</span><strong>生活案例 → 过程图示 → 动手练习</strong><p>重点：理解运行过程。<br/>保留老师指定的讲解顺序。</p></div></div><div className="mock-composer">告诉知芽你想怎样调整…<Mic size={18}/><ArrowRight size={18}/></div></section>
    <section className="mock-classroom"><div className="mock-toolbar"><span>课堂展示</span><span className="mock-data-label">演示数据 · 当前平台布局</span><Download size={19}/></div><div className="mock-slide"><div className="mock-slide-kicker">PYTHON / 第一行程序</div><h3>{lesson.pageTitle}</h3><p>{lesson.pageSubtitle}</p><div className="mock-steps">{lesson.steps.map((step,i) => {
      const Icon=icons[i];
      const p=spring({fps:30,frame:frame-35-i*18,config:{damping:24}});
      return <div className="mock-step-wrap" key={step.name} style={{opacity:p,transform:`translateY(${(1-p)*25}px)`}}><div className="mock-step" style={{background:current===i?'#e4eee7':'#f7f7f5',borderColor:current===i?'#286443':'#d8dad5',transform:`scale(${current===i?1.04:1})`}}><Icon size={49} strokeWidth={1.5}/><div className="mock-step-num">0{i+1}</div></div><strong>{step.name}</strong><small>{step.note}</small>{i<3 && <ArrowRight className="mock-step-arrow" size={25} style={{color:current>i?'#286443':'#d8dad5'}}/>}</div>;
    })}</div><div className="mock-code"><span>你的第一行代码</span><code>print(<em>"你好，世界！"</em>)</code><div style={{opacity:interpolate(frame,[270,292],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><span>运行结果</span><code>你好，世界！</code><Check size={20}/></div></div><div className="mock-summary">{lesson.summary}</div></div><div className="mock-pagination"><ChevronLeft size={19}/><span>3 / 6</span><ChevronRight size={19}/></div></section>
    <aside className="mock-deliverables"><div className="mock-area-active"><Monitor size={21}/><span>课堂展示</span></div><div><FileText size={21}/><span>文档</span></div><div className="mock-document-name">课程文档<br/><small>随课堂内容更新</small></div></aside>
  </div>;
}
