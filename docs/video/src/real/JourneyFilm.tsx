import React from 'react';
import {AbsoluteFill,Audio,OffthreadVideo,Sequence,staticFile,useCurrentFrame} from 'remotion';
import {Sprout} from 'lucide-react';
import {RhythmReview,rhythmReviewFrames} from './RhythmReview';
import {Subtitle} from './Subtitle';
import {SceneLayout,DataFlow} from './SceneLayouts';
import timeline from './journey-timing.json';

type Scene=typeof timeline[number];
const ink='#2c5139',muted='#71836a';
const phases:Record<string,{lead:string;items:string[];details:string[];code?:string}[]>={
  goals:[
    {lead:'学生听完以后，能做什么？',items:['看懂','预测','运行'],details:['读懂一段简单代码','说出预期输出','亲手检查结果']},
    {lead:'先看目标，再看课堂安排',items:['生活导入','概念讲解','动手练习'],details:['食堂点餐','变量 · 输入 · 输出','两人合作']},
    {lead:'两人一机，也影响课堂设计',items:['一人操作','一人检查','交换角色'],details:['输入与运行','对照与预测','每个人都动手']},
  ],
  generate:[
    {lead:'把备课要求，说成明确的任务',items:['三张讲解页','一个过程动画','一份教师教案'],details:['输出 · 变量 · 输入','分步观察数据流动','组织四十分钟课堂']},
    {lead:'同一个工作区，逐步出现内容',items:['提出要求','模型处理','查看内容'],details:['对话','任务与回应','课堂区']},
    {lead:'生成以后，逐项检查用途',items:['听得懂','看得清','做得出'],details:['讲解与案例','过程与变化','练习与课堂组织']},
  ],
  slides:[
    {lead:'一个点餐场景，串起三个概念',items:['输出','变量','输入'],details:['告诉顾客欢迎词','用名字保存包子价格','接收顾客的回答']},
    {lead:'翻看材料，检查讲解能否接上',items:['解释','代码','预测'],details:['生活中的意思','程序中的写法','运行前先想一想']},
    {lead:'静止的代码，怎样连成一个过程？',items:['从哪里来','存在哪里','到哪里去'],details:['顾客输入','变量保存','屏幕输出']},
  ],
  animation:[
    {lead:'数据每次只走一步',items:['输入','变量','输出'],details:['顾客给出数据','给数据起名字','让结果看得见']},
    {lead:'老师决定，什么时候继续',items:['顾客输入','存入变量','打印输出'],details:['点击第一步','停下来观察','再看下一步']},
    {lead:'过程展开以后，留一个追问',items:['现在在哪里？','下一步去哪？','自己试一次'],details:['定位数据','预测变化','走向练习']},
  ],
  practice:[
    {lead:'先完成一个小任务',items:['欢迎词','你的名字','两行输出'],details:['已有的一行代码','学生补一行','检查代码与结果'],code:'print("欢迎光临食堂")\nprint("我是小芽")'},
    {lead:'编辑、运行、结果放在一起',items:['补代码','点运行','看输出'],details:['任务是否说清楚','代码是否可执行','结果是否符合预期']},
    {lead:'变量到底在做什么？',items:['给数据起名字','让屏幕显示','等待顾客输入'],details:['变量','print 输出','input 输入'],code:'baozi_price = 2'},
  ],
  revision:[
    {lead:'第一版太复杂，注意力会被分散',items:['定义','例子','代码与提问'],details:['信息太密','同时争抢注意力','需要重新安排']},
    {lead:'告诉知芽，保留什么',items:['一句解释','一行代码','一个追问'],details:['变量就是给数据起个名字','baozi_price = 2','把 2 改成 3，会发生什么？']},
    {lead:'让理解有顺序，让问题有落点',items:['理解一句话','观察一行代码','带着问题思考'],details:['概念','例子','课堂追问'],code:'baozi_price = 2'},
  ],
  document:[
    {lead:'给学生看的内容，怎样变成老师的课堂？',items:['什么时候问','留多久练习','出错怎么办'],details:['课堂提问','时间分配','判断与应对']},
    {lead:'教案把课堂动作组织起来',items:['目标与流程','讲法与模板','错误与预案'],details:['明确先后顺序','准备操作步骤','处理常见卡点']},
    {lead:'修改后的讲法，也接进教案',items:['先猜','再改','运行检查'],details:['提出预测','修改变量的值','观察有没有输出']},
  ],
  export:[
    {lead:'把准备好的材料带走',items:['课堂内容','PPTX 课件','Word 教案'],details:['同一堂课','投影与继续编辑','备课与打印']},
    {lead:'带进课堂前，再检查一遍',items:['适合学生','内容一致','能够运行'],details:['目标与学生起点','案例 · 代码 · 教案','练习与操作步骤']},
    {lead:'沿着老师的备课思路，推进同一件事',items:['提出需求','查看与修改','带走材料'],details:['确定边界','落实教学判断','进入实际课堂']},
  ],
  closing:[
    {lead:'明天这节课，需要的准备连起来了',items:['组织讲解','动画与练习','课件与教案'],details:['从一句需求出发','观察与动手','查看与修改']},
    {lead:'这堂课怎么教，始终由老师决定。',items:['教学想法','知芽协助','实际课堂'],details:['老师提出','生成与修改','老师决定']},
  ],
};

function NativeStage({scene,phase,seconds}:{scene:Scene;phase:number;seconds:number}) {
  if((scene.id==='slides'&&phase===2)||(scene.id==='animation'&&phase===0))return null;
  return <SceneLayout id={scene.id} phase={phase} seconds={seconds} {...phases[scene.id][phase]}/>;
}

type Clip={file:string;start:number;duration:number;cut?:boolean};
const demos:Record<string,Clip[]>={
  goals:[{file:'01-prepare.webm',start:6,duration:18},{file:'01-prepare.webm',start:24,duration:12}],
  generate:[{file:'02-generate.webm',start:27,duration:8},{file:'02-generate.webm',start:55,duration:29,cut:true},{file:'03-preview.webm',start:0,duration:7}],
  slides:[{file:'03-preview.webm',start:0,duration:18},{file:'03-preview.webm',start:18,duration:10}],
  animation:[{file:'08-animation.webm',start:6,duration:8},{file:'08-animation.webm',start:28,duration:8},{file:'08-animation.webm',start:87,duration:10}],
  practice:[{file:'06-run.webm',start:62,duration:22}],
  revision:[{file:'04-revise.webm',start:20,duration:41}],
  document:[{file:'09-document.webm',start:9,duration:18},{file:'09-document.webm',start:35,duration:16},{file:'09-document.webm',start:58,duration:14}],
  export:[{file:'11-export-clean.webm',start:8,duration:24}],
};

function DemoStage({scene}:{scene:Scene}) {
  const clips=demos[scene.id];
  let offset=0;
  return <div style={{position:'absolute',left:192,top:118,width:1536,height:864,borderRadius:18,overflow:'hidden',boxShadow:'0 20px 65px #23452d18',border:'1px solid #c9d6c0',background:'#fff'}}>
    {clips.map((clip,i)=>{const from=offset;offset+=clip.duration;return <Sequence key={i} from={Math.round(from*30)} durationInFrames={Math.round(clip.duration*30)}><OffthreadVideo src={staticFile(`demo/${clip.file}`)} trimBefore={Math.round(clip.start*30)} muted style={{width:1536,height:864}}/>{clip.cut&&<Sequence durationInFrames={75}><div style={{position:'absolute',right:20,top:16,padding:'8px 15px',background:'#f5f5ef',color:muted,fontSize:21}}>等待过程已剪短</div></Sequence>}</Sequence>})}
  </div>;
}

function SceneContent({scene}:{scene:Scene}) {
  const frame=useCurrentFrame();const seconds=frame/30;
  let phase=0;scene.units.forEach((u,i)=>{if(seconds>=u.at)phase=i});
  const phaseSeconds=seconds-scene.units[phase].at;
  const processWindow=scene.id==='generate'?{start:12,end:56}:scene.id==='revision'?{start:14,end:55}:null;
  const demoStart=processWindow?.start??scene.units[1]?.at??0;
  const demoLength=(demos[scene.id]??[]).reduce((n,c)=>n+c.duration,0);
  const demoEnd=Math.min(processWindow?.end??scene.units[2]?.at??scene.seconds-3,demoStart+demoLength);
  const demo=scene.id!=='closing'&&seconds>=demoStart&&seconds<demoEnd;
  return <AbsoluteFill style={{background:phase===1?'#f5f5ef':'#edf2e7',color:ink,fontFamily:'PingFang SC,sans-serif'}}>
    <div style={{position:'absolute',left:120,top:45,display:'flex',gap:14,alignItems:'center',fontSize:24,color:muted}}><Sprout size={28}/>知芽 · 教师备课</div>
    {!demo&&<NativeStage scene={scene} phase={phase} seconds={phaseSeconds}/>}
    {demo&&<Sequence from={Math.round(demoStart*30)} durationInFrames={Math.round((demoEnd-demoStart)*30)}><DemoStage scene={scene}/></Sequence>}
    {demo&&<div style={{position:'absolute',left:192,top:76,fontSize:24,color:muted}}>{scene.title}</div>}
    {scene.units.map((u,i)=><Sequence key={i} from={Math.round(u.at*30)} durationInFrames={Math.ceil(u.duration*30)}><Audio src={staticFile(u.file)}/></Sequence>)}
    <Subtitle seconds={seconds} voices={scene.units.map(u=>({from:u.at,captions:u.captions}))}/>
  </AbsoluteFill>;
}


export function JourneyFilm() {
  const frame=useCurrentFrame();
  const slides=timeline.find(s=>s.id==='slides')!;
  const animation=timeline.find(s=>s.id==='animation')!;
  const flowStart=slides.from+slides.units[2].at;
  const flowEnd=animation.from+animation.units[1].at;
  const now=frame/30;
  return <AbsoluteFill style={{background:'#edf2e7'}}>
    <Sequence durationInFrames={rhythmReviewFrames}><RhythmReview/></Sequence>
    {timeline.map(scene=><Sequence key={scene.id} from={Math.round(scene.from*30)} durationInFrames={Math.round(scene.seconds*30)}><SceneContent scene={scene}/></Sequence>)}
    {now>=flowStart&&now<flowEnd&&<div style={{position:'absolute',inset:0,pointerEvents:'none'}}><DataFlow seconds={now-animation.from} running={now>=animation.from}/><div style={{position:'absolute',left:120,top:45,display:'flex',gap:14,alignItems:'center',fontSize:24,color:muted}}><Sprout size={28}/>知芽 · 教师备课</div><Subtitle seconds={now-(now<animation.from?slides.from:animation.from)} voices={(now<animation.from?slides:animation).units.map(u=>({from:u.at,captions:u.captions}))}/></div>}
  </AbsoluteFill>;
}
