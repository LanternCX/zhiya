import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {ArrowDown, ArrowRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Code, Download, FileText, Image as ImageIcon, Layers, Mic, MousePointer2, Play, Plus, Search, Send, Sprout, Users, X} from 'lucide-react';
import story from './story.json';
import timing from './timing.json';
import './film.css';

type Chapter = typeof story[number];
type Timing = typeof timing[number];
type View = {chapter:Chapter; beat:number; tick:number; frame:number};
const green='#286443';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const type=(text:string,tick:number,speed=2.5)=>text.slice(0,Math.floor(Math.max(0,tick)*speed));

function Breakfast({active=-1,compact=false}:{active?:number;compact?:boolean}) {
  return <svg viewBox="0 0 880 250" className={compact?'breakfast compact':'breakfast'}>
    {['准备食材','放入锅中','加热烹饪','装盘享用'].map((label,i)=><g key={label} transform={`translate(${30+i*220},20)`}>
      <rect width="160" height="160" rx="36" fill={active===i?'#d9eadd':'#f2f3ec'} stroke={active===i?green:'#e0e3d9'} strokeWidth="2"/>
      {i===0&&<g><ellipse cx="61" cy="84" rx="22" ry="29" fill="#fff" stroke="#a9b7a4" strokeWidth="3"/><ellipse cx="102" cy="87" rx="23" ry="28" fill="#e2b861"/><circle cx="102" cy="87" r="11" fill="#d98c49"/><path d="M37 120h89" stroke="#698563" strokeWidth="5" strokeLinecap="round"/></g>}
      {i===1&&<g><path d="M35 76q45 65 90 0z" fill="#7c9581"/><path d="M29 76h101m-64 33h29m-58-41-13-15m105 15 13-15" stroke="#46674e" strokeWidth="7" strokeLinecap="round"/><ellipse cx="80" cy="78" rx="18" ry="7" fill="#e9c274"/></g>}
      {i===2&&<g><path d="M45 92q35 50 70 0z" fill="#748d78"/><path d="M39 91h82" stroke="#3f6249" strokeWidth="6"/><path d="M61 58q-12-12 0-25m19 25q-12-12 0-25m19 25q-12-12 0-25" fill="none" stroke="#c39556" strokeWidth="4"/><path d="m62 137 9-15 9 15 9-15 9 15" fill="none" stroke="#d88848" strokeWidth="5"/></g>}
      {i===3&&<g><ellipse cx="80" cy="99" rx="50" ry="21" fill="#fff" stroke="#9eb59f" strokeWidth="3"/><ellipse cx="80" cy="97" rx="33" ry="12" fill="#e6b65d"/><path d="m65 93 20 6m-14-4 22-5" stroke="#548565" strokeWidth="4"/><path d="M133 63v53m-6-53v15m12-15v15" stroke="#798c7e" strokeWidth="3"/></g>}
      <text x="80" y="204" textAnchor="middle" fill="#243c2c" fontSize="22">{label}</text>
      {i<3&&<path d="M175 80h24m-8-7 8 7-8 7" stroke={active>i?green:'#bbc7b7'} fill="none" strokeWidth="3"/>}
    </g>)}
  </svg>;
}

function Status({children}:{children:React.ReactNode}) {return <span className="f-status"><Check size={15}/>{children}</span>;}
function Reply({children}:{children:React.ReactNode}) {return <div className="f-reply"><Sprout size={22}/><div>{children}</div></div>;}
function Bubble({children}:{children:React.ReactNode}) {return <div className="f-bubble">{children}</div>;}

const intentions=['初一 · 零基础','40 分钟 · 机房','理解顺序与输出','两人一组 · 动手练习'];
const outline=['第一行代码，从这里开始','先做好一份早餐','程序怎样运行？','你的第一行代码','先预测，再运行','今天，我们学会了什么'];
const pageKinds=['cover','breakfast','process','code','quiz','summary'];

function Composer({text='',tick=0}:{text?:string;tick?:number}) {return <div className="f-composer"><div>{text?type(text,tick,1.6):'告诉知芽，你想怎样调整这堂课…'}{text&&tick<text.length/1.6&&<span className="f-caret">│</span>}</div><footer><Plus size={19}/><Mic size={19}/><span>文字 / 语音</span><span className="f-send"><Send size={17}/></span></footer></div>;}

function Chat({chapter,beat,tick}:View) {
  const mode=chapter.mode;
  let request='给初一零基础学生准备一节 40 分钟的 Python 入门课，先用生活案例引入，再安排动手活动。';
  let response='围绕你的教学目标，准备课堂内容和配套教案。';
  if(mode==='sources') {request='这份讲义保留执行顺序的知识点，用图片里的早餐流程做开场案例。';response='参考范围已明确：PDF 提供知识结构，图片提供生活案例。';}
  if(mode==='knowledge') {request='找一段适合零基础学生的解释，帮助他们理解程序执行顺序。';response='根据当前教学目标，从本地知识库选择相关片段。';}
  if(mode==='outline') {request='保留 8 分钟活动、3 分钟总结，先确认完整教学顺序。';response='已组织六页结构，课件与教案使用同一份教学安排。';}
  if(mode==='plan') {request='教案中写清老师提问、学生任务和每个环节的时间。';response='按课件顺序展开教学过程，并补充课堂活动与课后练习。';}
  if(mode==='revision') {request='第三页简化成三步，每步一句话，去掉本节课不需要的术语。';response=beat===0?'定位第 3 页：保留执行逻辑，减少文字密度。':'第 3 页已调整；配套教案的讲解提示同步更新。';}
  if(mode==='revision2') {request='活动前增加预测问题，先说结果再运行验证。活动仍为 8 分钟。';response='增加预测与验证环节，压缩重复解释，保持总课时 40 分钟。';}
  if(mode==='export') {request='确认这一版，整理课件、教案和网页活动。';response='三种教学材料归入同一备课任务。导出状态为演示数据。';}
  return <section className="f-chat"><div className="f-chat-top"><ChevronLeft size={18}/><strong>第一行代码 · 备课共创</strong><span>•••</span></div><div className="f-chat-body">
    <div className="f-date">本次教学任务</div>
    <Bubble>{mode==='intent'&&beat===0?type(request,tick-20,.55):request}</Bubble>
    {(mode!=='intent'||tick>95||beat>0)&&<Reply>{response}</Reply>}
    {mode==='clarify'?<><Reply>{beat<2?'学生可以使用电脑吗？这节课讲到什么程度？':'授课对象、知识范围和时间安排已确认。'}</Reply>{beat>0&&<Bubble>机房授课，两人一组。只讲指令顺序和输出，不展开变量、循环。</Bubble>}{beat>1&&<Reply>按“生活案例 → 过程观察 → 动手验证”组织，预留 8 分钟活动。</Reply>}</>:<div className="f-context"><small>已确认的教学意图</small>{intentions.map(v=><span key={v}><Check size={14}/>{v}</span>)}</div>}
    {beat>1&&<Status>{mode.startsWith('revision')?'修改已进入预览':'教学安排已确认'}</Status>}
  </div><Composer text={mode==='intent'&&beat===1?'先讲生活案例，不要堆术语，让每个学生看到运行结果。':''} tick={tick}/></section>;
}

function Brief({beat,tick,voice=false}:{beat:number;tick:number;voice?:boolean}) {
  return <div className="f-brief"><div className="f-kicker">TEACHING BRIEF / 本次教学任务</div><h1>第一行代码，<br/>从这里开始。</h1><p>用一节课，让零基础学生理解程序的顺序与输出。</p><div className="f-brief-grid">{[['授课对象','初一 · 零基础'],['课堂条件','机房 · 两人一组'],['授课时长','40 分钟'],['知识范围','指令顺序 / 输出']].map(([a,b],i)=><div key={a} style={{opacity:beat>0||i<2?1:ease((tick-i*25)/30)}}><small>{a}</small><strong>{b}</strong></div>)}</div><div className="f-brief-bottom"><span><Check size={20}/>生活案例 → 过程观察 → 动手验证</span><button>{beat===3?'需求已确认':'确认教学安排'}<ArrowRight size={19}/></button></div>{voice&&<div className="f-wave"><Mic size={24}/>{Array.from({length:48},(_,i)=><i key={i} style={{height:12+Math.abs(Math.sin(tick*.09+i*.6))*45}}/>)}<span>语音输入示意</span></div>}</div>;
}

function References({beat,tick}:View) {
  return <div className="f-references"><div className="f-pane-heading"><h2>课堂参考资料</h2><span><Plus size={17}/>添加资料</span></div><div className="f-files"><div className={beat===1?'selected':''}><FileText size={25}/><span>编程入门讲义.pdf<small>知识结构 · 第 3 页</small></span><Status>已解析</Status></div><div className={beat===2?'selected':''}><ImageIcon size={25}/><span>早餐流程.png<small>生活案例 · 流程图</small></span><Status>已解析</Status></div></div>
    {beat===0?<div className="f-dropzone"><div style={{transform:`translateY(${mix(-20,0,ease(tick/70))}px)`}}><FileText size={65}/><ImageIcon size={65}/></div><h3>参考资料，放进同一个备课任务</h3><p>保留知识结构 · 提取案例关系 · 明确使用范围</p><span className="f-upload">{tick<70?'正在导入参考资料…':'两份资料已就绪'}<i style={{width:`${clamp(tick/70)*100}%`}}/></span></div>:beat===1?<div className="f-pdf"><small>编程入门讲义.pdf / 3</small><h2>程序的执行顺序</h2><p>程序由一组指令构成。运行时，指令按照规定的顺序执行。</p><p className="f-highlight">指令顺序影响结果。编写代码与运行代码，是两个不同的动作。</p><div className="f-pdf-lines"/><aside>老师的要求：保留知识点，将长段解释改成步骤演示。</aside></div>:beat===2?<div className="f-image-preview"><span>早餐流程.png · 关系提取</span><Breakfast active={Math.min(3,Math.floor(tick/70))}/><div className="f-extract"><Check size={20}/>已提取：4 个步骤 / 顺序关系 / 生活案例</div></div>:<div className="f-source-map"><div><FileText size={40}/><h3>PDF · 执行顺序</h3><p>知识讲解 / 第 3 页</p></div><ArrowRight size={35}/><div><ImageIcon size={40}/><h3>图片 · 早餐流程</h3><p>开场案例 / 第 2 页</p></div><div className="f-source-result"><Check size={21}/>资料用途已与教学意图关联</div></div>}
  </div>;
}

function Knowledge({beat,tick}:View) {
  const hits=['程序按顺序执行','书写与运行的区别','零基础课堂常见误区'];
  return <div className="f-knowledge"><div className="f-pane-heading"><h2>本地知识库</h2><Status>教学资料 · 示例</Status></div><div className="f-search"><Search size={23}/>{beat===0?type('怎样向零基础学生解释执行顺序？',tick,.6):'怎样向零基础学生解释执行顺序？'}</div><div className="f-knowledge-columns"><div>{hits.map((hit,i)=><div className={`f-hit ${i===Math.min(beat,2)?'selected':''}`} key={hit} style={{opacity:ease((tick-i*14)/24)}}><small>编程基础 / 示例资料 {i+1}</small><h3>{hit}</h3><p>{['指令顺序会影响执行结果。','代码需要运行，才能产生结果。','避免同时引入过多新语法。'][i]}</p><span>打开来源片段<ArrowRight size={15}/></span></div>)}</div><div className="f-evidence"><BookOpen size={36}/><small>来源片段 / 教学知识库示例</small><h2>{beat===2?'让解释有依据':'先理解顺序，再学习语法'}</h2><p className="f-highlight">程序中的指令按规定的顺序执行。编写完成之后，需要运行程序，才能观察到输出。</p><p>用于本次课件：第三页过程演示、第五页排序活动。</p><div className="f-evidence-use"><Check size={19}/>对应目标：理解指令顺序与输出</div>{beat===3&&<div className="f-three-inputs">教学意图<Plus size={19}/>上传资料<Plus size={19}/>知识依据<ArrowDown size={23}/><strong>课件生成任务</strong></div>}</div></div></div>;
}

function Outline({beat,tick}:View) {return <div className="f-outline"><div className="f-pane-heading"><h2>教学结构预览</h2><Status>40 分钟 / 6 页</Status></div><div className="f-outline-list">{outline.map((title,i)=><div key={title} className={i===(beat===1?2:beat===2?4:Math.min(5,Math.floor(tick/75)))?'selected':''} style={{opacity:ease((tick-i*10)/30),transform:`translateX(${(1-ease((tick-i*10)/30))*35}px)`}}><span>0{i+1}</span><div><h3>{title}</h3><small>{['封面 / 引出问题','生活案例 / 建立顺序概念','过程动画 / 观察执行','代码与结果 / 对照理解','互动任务 / 预测与验证','总结与练习 / 巩固目标'][i]}</small></div><ChevronRight size={20}/></div>)}</div><div className="f-timebar">{[['开场',5],['核心讲解',24],['活动',8],['总结',3]].map(([name,minutes],i)=><div key={name} style={{flex:Number(minutes),background:['#b8cfb8','#286443','#8fb292','#d9dbc4'][i],color:i===1?'white':green}}><strong>{name}</strong><small>{minutes} min</small></div>)}</div><div className="f-outline-note"><Layers size={20}/>同一教学结构 → 演示课件 + 配套教案</div></div>;}

function Process({tick,simple=false}:{tick:number;simple?:boolean}) {
  const phase=Math.floor(tick/95)%4;
  const steps=simple?['编写代码','运行程序','查看结果']:['输入代码','保存指令','运行程序','查看输出'];
  const notes=simple?['把想法写成指令','让计算机执行指令','观察屏幕上的结果']:['把想法写成指令','将代码保存为文件','让计算机执行指令','观察屏幕上的结果'];
  return <div className="f-process"><div className="f-process-steps">{steps.map((step,i)=><React.Fragment key={step}><div className={phase%steps.length===i?'active':''}><span>0{i+1}</span>{i===0?<Code size={42}/>:i===steps.length-1?<Check size={42}/>:<Play size={42}/>}<strong>{step}</strong><small>{notes[i]}</small></div>{i<steps.length-1&&<ArrowRight size={29} color={phase>i?green:'#becbbd'}/>}</React.Fragment>)}</div><div className="f-path"><i style={{left:`${(tick%380)/380*95}%`}}/></div><div className="f-terminal"><header><span>first_lesson.py</span><span>Python / 课堂示例</span></header><pre><span>1</span> <b>print</b>(<em>"{tick>190?'你好，小芽！':'你好，世界！'}"</em>)</pre><footer><span>运行结果</span><strong style={{opacity:tick>=150?1:.18}}>{tick>190?'你好，小芽！':'你好，世界！'}</strong><button><Play size={15}/>运行</button></footer></div></div>;
}

function Slide({kind,tick,simple=false}:{kind:string;tick:number;simple?:boolean}) {
  return <div className={`f-slide f-slide-${kind}`}><div className="f-slide-kicker">PYTHON / 初一 · 第一行代码</div>
    {kind==='cover'?<><div className="f-cover-code">&gt;_</div><h1>第一行代码，<br/>从这里开始。</h1><p>程序是一组指令。今天，让它说一句你好。</p><span className="f-cover-pill">生活案例 → 过程观察 → 动手验证</span></>:kind==='breakfast'?<><h2>先做好一份早餐</h2><p>如果先装盘，再加热，会发生什么？</p><Breakfast active={Math.floor(tick/85)%4}/><div className="f-question">从生活中的顺序，走向程序中的指令。</div></>:kind==='process'?<><h2>程序怎样运行？</h2><p>观察每一步：从指令，到看得见的结果。</p><Process tick={tick} simple={simple}/></>:kind==='code'?<><h2>你的第一行代码</h2><p>先预测结果，再运行观察。</p><div className="f-large-code"><small>输入 / first_lesson.py</small><code>print(<em>"你好，世界！"</em>)</code><button><Play size={20}/>运行代码</button><div className="f-code-result" style={{opacity:ease((tick-60)/25),transform:`translateY(${(1-ease((tick-60)/25))*20}px)`}}><small>输出</small><strong>你好，世界！</strong><Check size={26}/></div></div><div className="f-question">改成自己的名字，再运行一次。</div></>:kind==='quiz'?<><h2>先预测，再运行</h2><p>两句问候，哪一句先出现在屏幕上？</p><div className="f-quiz-code"><code>print(<em>"你好，小芽！"</em>)<br/>print(<em>"欢迎来到编程课堂！"</em>)</code></div><div className="f-quiz-options"><span className={tick>100?'chosen':''}>A · 你好，小芽！先出现</span><span>B · 欢迎来到编程课堂！先出现</span></div><div className="f-quiz-answer" style={{opacity:ease((tick-155)/30)}}><Check size={22}/>先运行第一条，再运行第二条。输出顺序与指令顺序对应。</div></>:<><h2>今天，我们学会了什么？</h2><div className="f-summary-items">{['程序是一组指令','执行有顺序','运行后能看到结果'].map((text,i)=><div key={text} style={{opacity:ease((tick-i*45)/30)}}><span>0{i+1}</span><strong>{text}</strong><Check size={30}/></div>)}</div><div className="f-question">试着写出两句问候，预测它们的输出顺序。</div></>}
    <div className="f-slide-footer"><span>知芽 / 教师课件共创</span><span>教学示例</span></div>
  </div>;
}

function Deck({beat,tick,chapter}:View) {
  const selected=chapter.mode==='animation'?2:chapter.mode==='revision'?2:chapter.mode==='revision2'?4:[0,1,3,5][beat];
  return <div className="f-deck"><div className="f-thumbnails">{outline.map((title,i)=><div key={title} className={i===selected?'selected':''}><span>{String(i+1).padStart(2,'0')}</span><div>{title}</div></div>)}</div><div className="f-page-container"><div className="f-page-toolbar"><span><Layers size={17}/>课堂预览</span><span>{selected+1} / 6</span><span><Play size={16}/>播放<Download size={16}/></span></div><Slide kind={pageKinds[selected]} tick={chapter.mode==='animation'&&beat===2?tick+130:tick} simple={chapter.mode==='revision'&&beat>0}/><div className="f-page-nav"><ChevronLeft size={19}/><span>点击缩略图切换页面</span><ChevronRight size={19}/></div></div></div>;
}

function Activity({beat,tick}:View) {
  const order=beat===0?[0,1,2]:beat===1?[1,0,2]:beat===2?[0,2,1]:[0,1,2];
  const initial=beat===1?[1,0,2]:beat===2?[0,2,1]:[0,1,2];
  const fixed=beat===1?tick>100:beat===2?tick>180:true;
  const positions=fixed?[0,1,2]:initial;
  const cards=['编写代码','运行程序','查看结果'];
  return <div className="f-activity"><div className="f-pane-heading"><h2>动手试一试</h2><span>两人一组 / 8 分钟</span></div><div className="f-activity-intro"><small>CLASSROOM ACTIVITY</small><h1>{beat===0?'让程序，说出你的名字。':'把三步，放进正确的顺序。'}</h1><p>{beat===0?'修改问候语 → 预测结果 → 运行验证':'拖动步骤卡片，再解释你为什么这样排列。'}</p></div>{beat===0?<div className="f-activity-terminal"><code>print(<em>"你好，{tick>80?'陈同学':'世界'}！"</em>)</code><span style={{opacity:ease((tick-140)/30)}}>输出：你好，陈同学！<Check size={22}/></span></div>:<><div className="f-sort">{cards.map((card,i)=>{const old=initial.indexOf(i);const next=positions.indexOf(i);const p=ease((tick-(beat===2?180:100))/35);return <div key={card} style={{left:mix(old*292,next*292,p),transform:`translateY(${i===0&&!fixed?-22:0}px) rotate(${i===0&&!fixed?-3:0}deg)`,zIndex:i===0?2:1}}><span>{i+1}</span><strong>{card}</strong>{i===0?<Code size={32}/>:i===1?<Play size={32}/>:<Check size={32}/>}</div>;})}</div><div className={`f-sort-feedback ${!fixed?'wrong':''}`} style={{opacity:ease((tick-45)/25)}}>{fixed?<><Check size={25}/>顺序正确：先写代码，再运行，最后看结果。</>:<><X size={25}/>还没有运行程序，输出不会出现。再试一次。</>}</div></>}{beat===3&&<div className="f-activity-time"><span>独立尝试 · 3 分钟</span><ArrowRight size={21}/><span>两人讨论 · 3 分钟</span><ArrowRight size={21}/><span>解释顺序 · 2 分钟</span></div>}</div>;
}

function LessonPlan({beat,tick}:View) {
  const offset=beat===0?0:beat===1?180:beat===2?375:555;
  return <div className="f-plan"><div className="f-pane-heading"><h2><FileText size={25}/>配套教案</h2><span>与课堂内容对应 · DOCX</span></div><div className="f-document-viewport"><div className="f-document" style={{transform:`translateY(${-offset-ease(tick/80)*35}px)`}}><small>第一行代码 / 教学设计</small><h1>Python 入门课教案</h1><div className="f-doc-meta">初一 · 零基础 ｜ 40 分钟 ｜ 机房 / 两人一组</div><h3>一、教学目标与重点</h3><p>理解程序是一组指令；能够说明执行顺序与输出结果的关系；完成一次代码修改和运行。</p><h3>二、教学过程</h3><table><thead><tr><th>环节</th><th>教师引导</th><th>学生任务</th><th>时间</th></tr></thead><tbody>{[['开场案例','观察早餐流程，提问步骤能否交换','说明生活中的顺序关系','5 min'],['核心讲解','结合过程动画，区分书写与运行','预测输出，观察结果，修改文字','24 min'],['动手活动','组织两人一组操作，检查理解','修改问候语，排序并解释步骤','8 min'],['课堂总结','回到三个核心要点','用自己的话说明执行过程','3 min']].map(row=><tr key={row[0]} className={row[0]===(beat===1?'核心讲解':beat===2?'动手活动':'')?'selected':''}>{row.map(cell=><td key={cell}>{cell}</td>)}</tr>)}</tbody></table><h3>三、课堂提问与预期反馈</h3><p className={beat===2?'f-highlight':''}>问：写完代码，为什么还要运行？<br/>预期：运行使指令得到执行，随后才能观察输出。<br/>追问：如果把查看结果放在运行之前，会怎样？</p><h3>四、课后练习</h3><p className={beat===3?'f-highlight':''}>用自己的话描述程序执行过程。写出两句不同的问候语，预测输出顺序，再运行验证。</p><div className="f-doc-foot">第 1 页 / 教学示例 · 老师可继续修改</div></div></div><div className="f-plan-link"><Layers size={22}/>课件第 {beat===3?'6':beat===2?'5':'3'} 页 ↔ 教案对应环节<Check size={20}/></div></div>;
}

function Revision({beat,tick,chapter,frame}:View) {
  if(beat===2&&chapter.mode==='revision') return <div className="f-compare"><div className="f-pane-heading"><h2>第三页 · 修改前后</h2><Status>保留教学关系，减少文字密度</Status></div><div className="f-compare-grid"><div><small>修改前</small><h2>程序的解释</h2><p>程序由一组有顺序的指令构成，需要经过书写、保存、执行与输出等过程。指令的先后关系影响执行结果，初学者需要区分输入代码与运行代码……</p><div className="f-dense-lines"/></div><ArrowRight size={30}/><div><small>修改后</small><h2>程序怎样运行？</h2>{['编写代码','运行程序','查看结果'].map((s,i)=><div className="f-simple-row" key={s}><span>0{i+1}</span>{s}<Check size={19}/></div>)}<p>每步一句话，让学生跟得上。</p></div></div></div>;
  if(beat===3&&chapter.mode==='revision') return <LessonPlan chapter={chapter} beat={1} tick={tick} frame={frame}/>;
  if(beat===2&&chapter.mode==='revision2') return <Outline chapter={chapter} beat={2} tick={tick} frame={frame}/>;
  return <Deck chapter={chapter} beat={beat} tick={tick} frame={frame}/>;
}

function Export({beat,tick}:View) {
  const files=[['PPTX','第一行代码_课件.pptx','演示课件 / 6 页'],['DOCX','第一行代码_教案.docx','目标、过程、活动与作业'],['HTML','程序运行顺序_活动.html','过程动画 / 排序互动']];
  return <div className="f-export"><div className="f-pane-heading"><h2>本次教学材料</h2><Status>预览确认 · 演示版本</Status></div><div className="f-export-cover"><Sprout size={45}/><h1>第一行代码，<br/>从这里开始。</h1><span>40 分钟 / 初一 · 零基础</span></div><div className="f-export-files">{files.map(([ext,name,note],i)=><div key={name} className={beat===i?'selected':''}><span className={`f-ext ext-${ext}`}>{ext}</span><div><strong>{name}</strong><small>{note}</small></div><button>{beat>i||tick>110?<Check size={22}/>:<Download size={22}/>}</button></div>)}</div><div className="f-export-note">模拟导出流程 · 正式使用前核验实际文件</div></div>;
}

function Workflow({beat,tick}:View) {
  const nodes=[{x:210,y:210,title:'教师意图',sub:'对象 / 目标 / 顺序',icon:Users},{x:620,y:90,title:'资料解析',sub:'PDF / 图片 / 参考关系',icon:FileText},{x:620,y:340,title:'本地知识库',sub:'文本处理 / 向量化 / 检索',icon:BookOpen},{x:1080,y:210,title:'生成与预览',sub:'课件 / 教案 / 动态活动',icon:Layers},{x:1080,y:555,title:'老师的反馈',sub:'定位修改 / 再生成',icon:Mic}];
  const active=beat===0?0:beat===1?1:beat===2?3:4;
  const token=clamp((tick%270)/270);
  return <div className="f-workflow"><div className="f-workflow-heading"><small>TEACHER CO-CREATION / 方案流程示意</small><h1>一条任务，贯穿整个备课过程。</h1></div><svg viewBox="0 0 1500 820"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#92af92"/></marker></defs><g fill="none" stroke="#a7bda6" strokeWidth="3" markerEnd="url(#arrow)"><path d="M400 275C470 275 500 155 605 155"/><path d="M400 275C470 275 500 405 605 405"/><path d="M815 155C950 155 950 275 1065 275"/><path d="M815 405C950 405 950 275 1065 275"/><path d="M1180 345V540"/><path d="M1065 620H330Q300 620 300 590V355"/></g><circle cx={mix(400,1065,token)} cy={275+Math.sin(token*Math.PI)*90} r="9" fill={green}/>{nodes.map(({x,y,title,sub,icon:Icon},i)=><g key={title} transform={`translate(${x},${y})`}><rect width="200" height="140" rx="20" fill={active===i?'#e1ede1':'#fff'} stroke={active===i?green:'#d4ded0'} strokeWidth="2"/><foreignObject x="20" y="20" width="170" height="110"><div className="f-flow-node"><Icon size={25}/><strong>{title}</strong><small>{sub}</small></div></foreignObject></g>)}<text x="620" y="676" fill={green} fontSize="23">预览 → 反馈 → 修改 → 再预览</text></svg><div className="f-workflow-bottom"><Check size={20}/>意图理解 · 两种格式资料利用 · 本地 RAG · 多模态生成 · 迭代与交付</div></div>;
}

function Opening({beat,tick}:View) {
  const tasks=[{x:155,y:225,angle:-7,title:'案例与参考',ext:'PDF',icon:BookOpen},{x:715,y:195,angle:5,title:'演示课件',ext:'PPT',icon:Layers},{x:1235,y:250,angle:-4,title:'配套教案',ext:'DOC',icon:FileText}];
  return <div className="f-opening"><div className="f-desktop-caption">明天，给零基础学生上一节编程课。</div>{tasks.map(({x,y,angle,title,ext,icon:Icon},i)=>{const p=ease((tick-i*20)/60);const join=beat>0?ease(tick/100):0;return <div className="f-desktop-window" key={title} style={{left:mix(x,280+i*410,join),top:mix(y,240,join)+(1-p)*60,opacity:p,transform:`rotate(${mix(angle,0,join)}deg)`}}><div className="f-window-bar"><i/><i/><i/><span>{ext}</span></div><Icon size={60}/><h2>{title}</h2><div className="f-paper-lines"/>{i===1&&<code>print("你好，世界！")</code>}</div>;})}<svg className="f-desktop-links" viewBox="0 0 1700 800"><path d="M450 420H1260" stroke="#c1d1ba" fill="none" strokeWidth="3" strokeDasharray="8 10"/></svg>{beat>0&&<div className="f-desktop-brand" style={{opacity:ease(tick/50),transform:`translateY(${(1-ease(tick/50))*30}px)`}}><Sprout size={48}/><strong>知芽</strong><span>把备课工作串起来</span></div>}<div className="f-desktop-task"><span>当前教学任务</span><strong>初一 / Python 入门 / 40 分钟</strong><ArrowRight size={22}/></div></div>;
}

export function OpeningMotion({frame}:{frame:number}) {
  const beat=frame<420?0:1;
  return <div className="f-film" style={{position:'absolute',inset:0,background:'#f5f5ef'}}><div className="f-stage"><Opening chapter={story[0]} beat={beat} tick={beat===0?frame:frame-420} frame={frame}/></div></div>;
}

function Closing({beat,tick}:View) {
  return <div className="f-closing">{beat<3?<><div className="f-closing-pages"><div style={{transform:`rotate(-6deg) translateY(${Math.sin(tick/100)*6}px)`}}><Slide kind="breakfast" tick={tick}/></div><div><Slide kind="process" tick={tick} simple/></div><div style={{transform:`rotate(5deg) translateY(${Math.cos(tick/100)*6}px)`}}><div className="f-closing-doc"><FileText size={50}/><h2>配套教案</h2><div className="f-paper-lines"/><span>目标 / 过程 / 活动 / 作业</span></div></div></div><div className="f-closing-copy"><Sprout size={45}/><h1>{beat===0?'从一个想法，到一堂课。':beat===1?'教学判断，始终在老师手里。':'让老师的精力，回到教学设计。'}</h1></div></>:<div className="f-end-brand"><Sprout size={95}/><h1>知芽</h1><p>让教学想法，长成一堂课。</p><span>多模态 AI 互动式教学智能体 / 教师课件共创</span><small>教师流程概念演示 · 模拟数据</small></div>}</div>;
}

function Workspace(view:View) {
  const {chapter,beat,tick}=view;
  const mode=chapter.mode;
  let content:React.ReactNode;
  if(mode==='intent'||mode==='clarify')content=<Brief beat={beat} tick={tick} voice={mode==='intent'&&beat===2}/>;
  else if(mode==='sources')content=<References {...view}/>;
  else if(mode==='knowledge')content=<Knowledge {...view}/>;
  else if(mode==='outline')content=<Outline {...view}/>;
  else if(mode==='activity')content=<Activity {...view}/>;
  else if(mode==='plan')content=<LessonPlan {...view}/>;
  else if(mode.startsWith('revision'))content=<Revision {...view}/>;
  else if(mode==='export')content=<Export {...view}/>;
  else content=<Deck {...view}/>;
  return <div className="f-app"><aside className="f-nav"><div className="f-logo"><Sprout size={27}/><strong>知芽</strong></div><div className="active"><BookOpen size={21}/>学习</div><div><Users size={21}/>我的班级</div><small>最近任务</small><div className="f-nav-task">第一行代码<br/><span>教师备课演示</span></div><div className="f-nav-profile"><span>陈</span>陈老师</div></aside><Chat {...view}/><section className="f-preview"><div className="f-preview-top"><span className={mode==='plan'?'':'active'}><Layers size={18}/>课堂展示</span><span className={mode==='plan'?'active':''}><FileText size={18}/>文档</span><small>教师流程概念演示 · 模拟数据</small></div>{content}</section></div>;
}

// Focus coordinates are in the fixed 1920×1080 world; all motion is frame-driven.
function targets(mode:string):number[][] {
  if(mode==='opening')return [[960,540,.96],[950,515,1.1],[570,460,1.32],[1120,490,1.13]];
  if(mode==='closing')return [[960,470,.94],[570,455,1.25],[1130,500,1.18],[960,500,1]];
  if(mode==='workflow')return [[520,465,1.4],[850,450,1.35],[1280,490,1.28],[960,560,.95]];
  if(mode==='intent')return [[410,515,1.65],[415,760,1.55],[415,675,1.52],[1160,500,1.18]];
  if(mode==='clarify')return [[410,420,1.55],[430,575,1.52],[1150,670,1.33],[1130,510,1.13]];
  if(mode==='sources')return [[1110,490,1.12],[1190,580,1.38],[1150,565,1.33],[1120,580,1.17]];
  if(mode==='knowledge')return [[1090,320,1.27],[820,540,1.5],[1400,550,1.46],[1120,585,1.15]];
  if(mode==='outline')return [[1140,510,1.1],[1110,505,1.4],[1150,825,1.4],[1100,530,1.16]];
  if(mode==='deck')return [[1030,515,1.04],[1260,515,1.28],[1260,560,1.46],[1280,540,1.24]];
  if(mode==='animation')return [[1190,510,1.22],[1150,470,1.48],[1300,680,1.65],[1150,530,1.14]];
  if(mode==='activity')return [[1150,530,1.17],[1120,550,1.38],[1220,660,1.42],[1150,530,1.13]];
  if(mode==='plan')return [[1160,475,1.12],[1170,550,1.4],[1210,600,1.38],[1200,655,1.35]];
  if(mode==='revision')return [[425,370,1.58],[1260,510,1.28],[1120,535,1.13],[1210,550,1.28]];
  if(mode==='revision2')return [[420,390,1.6],[1270,580,1.37],[1120,770,1.32],[1180,530,1.14]];
  return [[1120,460,1.13],[1180,590,1.38],[1160,745,1.4],[1120,530,1.1]];
}

function Cursor({view}:{view:View}) {
  const mode=view.chapter.mode;
  const clicks:Record<string,number[][]>={
    intent:[[470,800],[520,830],[345,870],[1630,770]],
    clarify:[[480,475],[490,570],[1230,680],[1630,770]],
    sources:[[1660,248],[890,305],[1410,305],[1240,780]],
    knowledge:[[1160,290],[870,420],[1430,530],[1280,650]],
    deck:[[780,265],[780,365],[780,563],[780,760]],
    animation:[[1620,700],[1150,450],[1620,700],[1200,470]],
    plan:[[880,170],[1250,520],[1250,650],[1250,725]],
    export:[[1700,330],[1700,470],[1700,610],[1700,610]],
  };
  const points=clicks[mode]||targets(mode);
  const target=points[view.beat];
  const p=ease(view.tick/55);
  const x=mix(target[0]-180,target[0]+45,p),y=mix(target[1]+80,target[1]+20,p);
  const click=view.tick>55&&view.tick<85;
  return <div className="f-cursor" style={{left:x-45,top:y-20,opacity:view.tick<150?1:ease((180-view.tick)/30)}}><MousePointer2 size={31} fill="#29472d" color="white" strokeWidth={1.5}/>{click&&<i style={{transform:`translate(-50%,-50%) scale(${(view.tick-55)/12})`,opacity:1-(view.tick-55)/30}}/>}</div>;
}

function ChapterScene({chapter,clock}:{chapter:Chapter;clock:Timing}) {
  const frame=useCurrentFrame();
  let beat=0;
  clock.beats.forEach((start,i)=>{if(frame>=start)beat=i;});
  const tick=Math.max(0,frame-clock.beats[beat]);
  const view={chapter,beat,tick,frame};
  const focus=targets(chapter.mode);
  const old=beat===0?[960,540,.92]:focus[beat-1];
  const dest=focus[beat];
  const p=ease((tick-15)/48);
  // A restrained drift keeps held shots alive without making UI text hard to follow.
  const scale=mix(old[2],dest[2],p)+Math.min(.025,tick*.00005);
  const x=mix(old[0],dest[0],p),y=mix(old[1],dest[1],p);
  const translateX=Math.max(1800-1810*scale,Math.min(960-x*scale,120-110*scale));
  const translateY=Math.max(890-940*scale,Math.min(500-y*scale,150-140*scale));
  const opacity=Math.min(ease(frame/20),ease((clock.duration-frame)/18));
  const caption=clock.captions.find(cap=>frame>=cap.start&&frame<=cap.end+3);
  return <AbsoluteFill className="f-film"><header className="f-film-header"><span><Sprout size={23}/>知芽 <b>教师课件共创</b></span><span>{chapter.title}</span><small>{String(story.findIndex(c=>c.id===chapter.id)+1).padStart(2,'0')} / {story.length}</small></header>
    <div className="f-camera-viewport"><div className="f-world" style={{opacity,transform:`translate(${translateX}px,${translateY}px) scale(${scale})`}}>
      <div className="f-stage">{chapter.mode==='opening'?<Opening {...view}/>:chapter.mode==='closing'?<Closing {...view}/>:chapter.mode==='workflow'?<Workflow {...view}/>:<Workspace {...view}/>}</div>
      {chapter.mode!=='closing'&&chapter.mode!=='opening'&&chapter.mode!=='workflow'&&<Cursor view={view}/>}
    </div></div>
    <div className="f-shot-label"><i/><span>{chapter.beats[beat].label}</span></div>
    {caption&&<div className="f-caption">{caption.text.replace(/[，。；：]$/,'')}</div>}
    <div className="f-film-footer"><span>A12 · 多模态 AI 互动式教学智能体</span><span>教师流程概念演示 · 模拟数据</span></div>
    <Sequence from={clock.lead}><Audio src={staticFile(`voice-doubao/${chapter.id}.wav`)} playbackRate={clock.rate}/></Sequence>
  </AbsoluteFill>;
}

export function FullFilm() {
  const frame=useCurrentFrame();
  return <AbsoluteFill>{story.map((chapter,i)=><Sequence key={chapter.id} from={timing[i].from} durationInFrames={timing[i].duration}><ChapterScene chapter={chapter} clock={timing[i]}/></Sequence>)}<Audio src={staticFile('sound/bed.wav')} loop volume={interpolate(frame,[0,70,17920,18000],[0,.055,.055,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}/><div className="f-film-progress"><i style={{width:`${frame/18000*100}%`}}/></div></AbsoluteFill>;
}
