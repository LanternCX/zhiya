import React from 'react';
import {AbsoluteFill} from 'remotion';
import {BookOpen,Check,Code,FileText,Play,Sprout,Users} from 'lucide-react';

const ink='#2c5139',muted='#71836a',paper='#fffef9',line='#d3ddca';
const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t)};
type Props={id:string;phase:number;seconds:number;lead:string;items:string[];details:string[]};
const mono:React.CSSProperties={fontFamily:'Menlo,monospace'};
const reveal=(seconds:number,delay=0):React.CSSProperties=>({opacity:ease((seconds-delay)/.6),transform:`translateY(${24*(1-ease((seconds-delay)/.6))}px)`});
function Heading({children}:{children:React.ReactNode}){return <h2 style={{fontSize:48,fontWeight:500,lineHeight:1.4,margin:0,maxWidth:1500}}>{children}</h2>}

// These are editorial explanations, not replicas of the product interface.
export function SceneLayout({id,phase,seconds,lead,items,details}:Props){
  const intro=reveal(seconds);
  const base:React.CSSProperties={position:'absolute',inset:'150px 120px 130px',color:ink};
  if(id==='goals')return <div style={base}>
    <div style={{position:'absolute',top:75,left:0,width:500,...intro}}><div style={{fontSize:24,color:muted}}>明天的入门课</div><div style={{fontSize:180,fontWeight:300,lineHeight:1.2}}>40<span style={{fontSize:32,marginLeft:20}}>分钟</span></div><div style={{fontSize:29,marginTop:20}}>初一 · 零基础 · 两人一机</div><div style={{marginTop:55,display:'flex',alignItems:'center',gap:25}}><Users size={58} strokeWidth={1.3}/><span style={{fontSize:25}}>每个人都要动手</span></div></div>
    <div style={{position:'absolute',left:630,top:30,right:0,borderLeft:`1px solid ${line}`,paddingLeft:70}}><Heading>{lead}</Heading>{items.map((item,i)=><div key={item} style={{display:'flex',alignItems:'baseline',gap:30,marginTop:48,...reveal(seconds,1+i*2)}}><span style={{fontSize:22,color:muted,...mono}}>0{i+1}</span><div><div style={{fontSize:43}}>{item}</div><div style={{fontSize:26,color:muted,marginTop:10}}>{details[i]}</div></div></div>)}</div>
  </div>;
  if(id==='generate')return <div style={base}>
    <Heading>{lead}</Heading>
    <div style={{position:'absolute',left:0,top:190,width:780,...intro}}><div style={{fontSize:24,color:muted,marginBottom:25}}>老师的任务</div><div style={{fontSize:45,lineHeight:1.85}}>用食堂点餐讲清楚<br/><span style={{borderBottom:'3px solid #90a77e'}}>输出、变量和输入</span>。</div><div style={{marginTop:50,fontSize:27,color:muted}}>同一个案例，准备不同用途的材料。</div></div>
    <div style={{position:'absolute',left:940,top:145,width:620}}>{items.map((item,i)=>{const Icon=[BookOpen,Play,FileText][i];return <div key={item} style={{display:'flex',gap:26,padding:'29px 0',borderBottom:`1px solid ${line}`,...reveal(seconds,2+i*3)}}><Icon size={43} strokeWidth={1.4}/><div><div style={{fontSize:35}}>{item}</div><div style={{fontSize:25,color:muted,marginTop:14}}>{details[i]}</div></div></div>})}</div>
  </div>;
  if(id==='slides')return <div style={base}>
    <Heading>{lead}</Heading>
    <div style={{position:'absolute',top:190,left:0,width:475,height:420,background:'#e2ead6',padding:48,boxSizing:'border-box',borderRadius:'140px 140px 20px 20px',...intro}}><div style={{textAlign:'center',fontSize:34}}>今日食堂</div><div style={{fontSize:100,textAlign:'center',margin:'40px 0 20px'}}>包子</div><div style={{fontSize:30,textAlign:'center'}}>单价 2 元</div></div>
    <div style={{position:'absolute',top:180,left:580,right:0}}>{['print("欢迎光临食堂")','baozi_price = 2','num = input("要几份？")'].map((code,i)=><div key={code} style={{display:'grid',gridTemplateColumns:'110px 1fr',alignItems:'center',gap:30,padding:'36px 0',borderBottom:`1px solid ${line}`,...reveal(seconds,1+i*3)}}><span style={{fontSize:30,color:muted}}>{['输出','变量','输入'][i]}</span><code style={{fontSize:35}}>{code}</code></div>)}</div>
  </div>;
  if(id==='practice'&&phase===2)return <div style={base}>
    <Heading>{lead}</Heading><div style={{fontSize:65,...mono,marginTop:75}}>baozi_price = <span style={{color:'#bd763a'}}>2</span></div>
    <div style={{marginTop:70,width:1350}}>{items.map((item,i)=><div key={item} style={{display:'flex',gap:30,padding:'23px 0',borderBottom:`1px solid ${line}`,...reveal(seconds,i*.7)}}><span style={{fontSize:27,color:muted,...mono}}>{['A','B','C'][i]}</span><span style={{fontSize:34}}>{item}</span>{i===0&&seconds>8&&<span style={{marginLeft:'auto',fontSize:26,color:muted,...reveal(seconds,8)}}>给这份数据一个名字 <Check size={25}/></span>}</div>)}</div>
  </div>;
  if(id==='practice')return <div style={base}>
    <div style={{width:510}}><Heading>{lead}</Heading><div style={{fontSize:29,lineHeight:1.8,color:muted,marginTop:40}}>先显示欢迎词，<br/>再让程序说出你的名字。</div><div style={{marginTop:90,display:'flex',gap:20,alignItems:'center',fontSize:26}}><Code size={42}/>只补一行，就能开始。</div></div>
    <div style={{position:'absolute',left:610,top:35,right:0,height:530,background:paper,border:`1px solid ${line}`,borderRadius:18,padding:46,boxSizing:'border-box'}}><div style={{fontSize:23,color:muted,marginBottom:65}}>两行代码</div>{['print("欢迎光临食堂")','print("我是小芽")'].map((s,i)=><div key={s} style={{fontSize:37,lineHeight:2.3,...mono,...reveal(seconds,i*4)}}><span style={{color:'#b2bfa8',marginRight:32}}>{i+1}</span>{s}</div>)}<div style={{marginTop:80,fontSize:26,color:muted,...reveal(seconds,8)}}>运行以后，屏幕会显示什么？</div></div>
  </div>;
  if(id==='revision'&&phase===0)return <div style={base}>
    <Heading>{lead}</Heading>
    <div style={{position:'absolute',left:0,top:170,width:1040,padding:45,boxSizing:'border-box',background:paper,border:`1px solid ${line}`,...intro}}><div style={{fontSize:36}}>变量：给数据贴个名字标签</div><div style={{fontSize:26,color:muted,lineHeight:1.9,margin:'28px 0'}}>把右边的数据存在左边的名字里，方便以后取用。</div><pre style={{fontSize:34,lineHeight:1.8,...mono}}>{'baozi_price = 2\nnum = 3\nprint(baozi_price)'}</pre><div style={{fontSize:25,color:muted,borderTop:`1px solid ${line}`,paddingTop:25}}>名字、赋值、屏幕输出，需要逐一解释。</div></div>
    <div style={{position:'absolute',left:1140,top:210,right:0}}>{['读定义','理解类比','看代码','想问题'].map((s,i)=><div key={s} style={{fontSize:32,padding:'23px 0',borderBottom:`1px solid ${line}`,...reveal(seconds,1+i)}}>{s}</div>)}<div style={{fontSize:27,marginTop:35,color:muted}}>先把注意力集中起来。</div></div>
  </div>;
  if(id==='revision')return <div style={base}>
    <Heading>{lead}</Heading>
    <div style={{position:'absolute',left:0,top:195,width:460,fontSize:29,lineHeight:2,color:muted}}><div style={{fontSize:25}}>老师的修改要求</div><div style={{fontSize:42,color:ink,marginTop:20}}>保留最重要的<br/>三件事。</div></div>
    <div style={{position:'absolute',left:590,top:175,right:0,padding:'45px 55px',background:paper,borderLeft:'4px solid #99ad88',boxShadow:'0 20px 50px #244c3509'}}>
      <div style={{fontSize:34,...reveal(seconds,1)}}>变量就是给数据起个名字</div><div style={{fontSize:52,margin:'60px 0',...mono,...reveal(seconds,4)}}>baozi_price = <span style={{color:'#bd763a'}}>2</span></div><div style={{fontSize:33,paddingTop:32,borderTop:`1px solid ${line}`,...reveal(seconds,7)}}>把 2 改成 3，会发生什么？</div>
    </div>
  </div>;
  if(id==='document')return <div style={base}>
    <div style={{width:510}}><Heading>{lead}</Heading><div style={{fontSize:28,lineHeight:1.9,color:muted,marginTop:50}}>从给学生看的内容，<br/>走到老师的课堂安排。</div></div>
    <div style={{position:'absolute',left:650,top:0,width:860,height:645,background:paper,boxShadow:'12px 16px 0 #e1e8d8',padding:'45px 65px',boxSizing:'border-box',transform:`rotate(${(1-ease(seconds/1.2))*-3}deg)`}}><div style={{fontSize:22,color:muted}}>教师备课笔记</div><div style={{fontSize:38,margin:'24px 0 36px'}}>Python 入门 · 40 分钟</div>{items.map((s,i)=><div key={s} style={{borderTop:`1px solid ${line}`,padding:'24px 0',display:'flex',gap:26,...reveal(seconds,1+i*2)}}><span style={{fontSize:24,color:muted,...mono}}>0{i+1}</span><div><div style={{fontSize:31}}>{s}</div><div style={{fontSize:24,color:muted,marginTop:9}}>{details[i]}</div></div></div>)}</div>
  </div>;
  if(id==='export')return <div style={base}>
    <Heading>{lead}</Heading>
    {phase===2?<div style={{marginTop:140,display:'flex',alignItems:'center',gap:60}}>{items.map((s,i)=><React.Fragment key={s}>{i>0&&<div style={{width:100,height:2,background:line}}/>}<div style={{...reveal(seconds,i*2)}}><div style={{fontSize:70,color:'#9aaf89',...mono}}>0{i+1}</div><div style={{fontSize:38,marginTop:30}}>{s}</div><div style={{fontSize:26,color:muted,marginTop:18}}>{details[i]}</div></div></React.Fragment>)}</div>:<div style={{display:'flex',gap:90,marginTop:95,alignItems:'center'}}><div style={{width:450,fontSize:34,lineHeight:1.9}}>同一堂课的准备，<br/>带进熟悉的工作方式。</div>{['PPTX','DOCX'].map((s,i)=><div key={s} style={{width:360,height:370,background:paper,border:`1px solid ${line}`,padding:42,boxSizing:'border-box',boxShadow:'12px 12px 0 #dde5d3',...reveal(seconds,1+i*3)}}><FileText size={60} strokeWidth={1.2}/><div style={{fontSize:56,margin:'45px 0 24px',...mono}}>{s}</div><div style={{fontSize:26,color:muted}}>{i===0?'投影讲解 · 继续编辑':'备课参考 · 编辑打印'}</div></div>)}</div>}
  </div>;
  if(id==='closing')return <div style={{...base,textAlign:'center',paddingTop:75}}><Sprout size={85} strokeWidth={1.3}/><div style={{fontSize:phase===0?60:72,lineHeight:1.6,margin:'40px auto',maxWidth:1300,...intro}}>{lead}</div><div style={{fontSize:30,color:muted,marginTop:70,...reveal(seconds,2)}}>{phase===0?'讲解、动画、练习、教案，围绕同一堂课展开。':'知芽 · 让教学想法走到实际课堂'}</div></div>;
  if(id==='animation')return <div style={base}><Heading>{lead}</Heading><div style={{fontSize:90,marginTop:120,...intro}}>数据现在在哪里？</div><div style={{display:'flex',alignItems:'center',gap:25,marginTop:80,fontSize:31,color:muted,...reveal(seconds,4)}}><Play size={42}/>老师决定什么时候继续，学生先想一想。</div></div>;
  return null;
}

// Only this boundary shares an object: the same input value survives the
// change from reading code to tracing execution. There is no generic bridge.
export function DataFlow({seconds,running}:{seconds:number;running:boolean}){
  const progress=running?ease(seconds/10):0;
  return <AbsoluteFill style={{background:running?'#edf2e7':'#f8f6ee',color:ink,fontFamily:'PingFang SC,sans-serif'}}>
    <div style={{position:'absolute',left:120,top:150,fontSize:48}}>{running?'跟着这份数据，逐步看执行过程':'代码是静止的，数据会走到哪里？'}</div>
    <svg width="1920" height="1080" style={{position:'absolute'}}><path d="M330 530H1570" stroke={line} strokeWidth="4" strokeDasharray="8 12"/></svg>
    {['顾客输入','变量保存','屏幕输出'].map((s,i)=><div key={s} style={{position:'absolute',left:120+i*620,top:375,width:420,height:235,background:paper,border:`2px solid ${running&&Math.round(progress*2)===i?'#8fa77c':line}`,borderRadius:i===0?120:18,display:'grid',placeContent:'center',textAlign:'center',gap:30}}><div style={{fontSize:35}}>{s}</div><code style={{fontSize:27,color:muted}}>{['input(…)','num = "3"','print(num)'][i]}</code></div>)}
    <div style={{position:'absolute',left:285+1240*progress,top:655,width:90,height:80,display:'grid',placeItems:'center',background:ink,color:paper,borderRadius:18,fontSize:40}}>3</div>
    <div style={{position:'absolute',left:120,top:825,fontSize:28,color:muted}}>{running?'输入一份数据 → 给它名字 → 把它显示出来':'同一个点餐场景，同一份数据。'}</div>
  </AbsoluteFill>;
}
