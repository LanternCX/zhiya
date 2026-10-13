import React from 'react';
import {ArrowRight, BookOpen, Code, FileText, Layers, MessageCircle, Sprout, Users} from 'lucide-react';
import {AbsoluteFill, interpolate} from 'remotion';

const palettes={ink:'#244c35',paper:'#fffefa',wash:'#edf2e7',line:'#c2d2b8'};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t)};
const content:Record<string,{question:string;items:string[];icons:typeof Users[]}>= {
  context:{question:'同一个课题，为什么不能直接给出同一套课件？',items:['初一 · 零基础','40 分钟 · 两人一机','变量 · 输入 · 输出'],icons:[Users,BookOpen,Code]},
  goals:{question:'先确定学生能做什么，再安排课堂。',items:['听懂一个概念','预测一个结果','运行一段代码'],icons:[BookOpen,MessageCircle,Code]},
  generate:{question:'课堂流程明确了，材料怎样接上？',items:['讲解页','过程动画','教师教案'],icons:[Layers,Code,FileText]},
  animation:{question:'代码是静止的，数据怎样流动？',items:['输入','存入变量','输出'],icons:[MessageCircle,Layers,Code]},
  practice:{question:'从看懂，到自己做出来。',items:['补一行代码','实际运行','查看结果'],icons:[Code,ArrowRight,Layers]},
  revision:{question:'第一版太复杂？老师继续判断。',items:['找到问题','说出修改','对照结果'],icons:[BookOpen,MessageCircle,Layers]},
  document:{question:'讲什么，与怎样组织课堂，需要接起来。',items:['课堂内容','教学流程','教师教案'],icons:[Layers,ArrowRight,FileText]},
  export:{question:'准备好的材料，怎样带进课堂？',items:['课堂展示','课件文件','备课文档'],icons:[Layers,FileText,BookOpen]},
  closing:{question:'让教学想法，走到实际课堂。',items:['说出需求','查看与修改','带进课堂'],icons:[MessageCircle,Layers,Users]},
};

export function MotionBridge({kind,frame}:{kind:string;frame:number}) {
  const c=content[kind]??content.generate;
  const active=Math.min(2,Math.floor(frame/55));
  const moving=interpolate(frame,[40,155],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:palettes.wash,fontFamily:'PingFang SC,sans-serif',color:palettes.ink,padding:'100px 140px'}}>
    <div style={{display:'flex',alignItems:'center',gap:16,fontSize:27}}><Sprout size={32}/>知芽 · 教师备课</div>
    <h1 style={{fontSize:52,maxWidth:1500,lineHeight:1.4,marginTop:54,fontWeight:550}}>{c.question}</h1>
    <svg style={{position:'absolute',left:0,top:390,width:1920,height:420}} viewBox="0 0 1920 420">
      <path d="M430 200H1480" stroke={palettes.line} strokeWidth={4} strokeDasharray="10 10"/>
      <circle cx={430+moving*1050} cy={200} r={12} fill={palettes.ink}/>
    </svg>
    <div style={{display:'flex',gap:100,marginTop:120,position:'relative'}}>{c.items.map((item,i)=>{
      const Icon=c.icons[i];const p=ease((frame-i*20)/32);
      return <div key={item} style={{width:440,height:250,background:active===i?'#dce8d3':palettes.paper,border:`2px solid ${active===i?'#6c9060':palettes.line}`,borderRadius:24,padding:42,opacity:p,transform:`translateY(${(1-p)*45}px)`,boxShadow:'0 20px 50px #25452a0d'}}>
        <Icon size={52} strokeWidth={1.5}/><div style={{fontSize:34,marginTop:32}}>{item}</div>
      </div>;
    })}</div>
  </AbsoluteFill>;
}
