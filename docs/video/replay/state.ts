import teacherFixture from './fixtures.json';
import {studentMode,makeStudentFixture,studentDialogs,studentSpeech,studentKnowledge} from './student-data';
const fixture=studentMode?makeStudentFixture():teacherFixture;
import evidence from './evidence.json';
import speech from './speech-evidence.json';
import materialTiming from './material-timing.json';
import materialPlayback from './material-playback.json';
import dialogue from '../src/student/dialogue-timing.json';
import {learningReplies} from './student-content';
export const materialComplete=4+materialPlayback.eventSeconds.at(-1)!;
export const materialReplyStart=materialComplete+1;
export const materialReplyEnd=materialReplyStart+evidence.state.lesson.messages.at(-1)!.text.length/36;
// Keep every captured conversation available while the same app stays mounted.
export const replayCourse={...fixture.course.course,sections:fixture.course.course.sections.map(section=>({
  ...section,conversations:[...new Map([
    ...section.conversations,
    ...(evidence.state.course.sections.find(item=>item.id===section.id)?.conversations??[]),
  ].map(conversation=>[conversation.id,conversation])).values()],
}))};
if(studentMode)replayCourse.sections.forEach(section=>section.conversations.forEach(conversation=>{conversation.title='我的 Python 入门学习'}));
export {fixture};
export let shot='generate';
export let seconds=0;
const listeners=new Set<()=>void>();
export const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
export function seek(next:string,time:number){shot=next;seconds=time;listeners.forEach(fn=>fn())}
export function courseState(){
  if(['references','upload','speech','material-process'].includes(shot)){
    const state=structuredClone(evidence.state);
    state.course=structuredClone(replayCourse);
    state.lesson.messages=[state.lesson.messages[0],state.lesson.messages.at(-1)!];
    if(studentMode){
      state.role='student';
      const citations=state.lesson.messages[1].text.match(/\[[^\]]+\]\([^\)]+\)/g)??[];
      state.lesson.messages[1].text=learningReplies['material-process']+'\n\n'+citations.join(' ');
    }
    const document=fixture.deliverables.deliverables.find(item=>item.kind==='document'&&!item.source)!;
    state.deliverableSelection={id:document.id,blockId:document.blocks[1].id};
    state.busy=false;state.running=false;state.activity=null;state.generating=false;
    if(shot==='material-process'){
      if(seconds<4)state.lesson.messages=[];
      else{
        state.lesson.messages[0].text='结合这份教案和图片，设计课堂导入。';
        state.lesson.messages[0].materials=['教师教案.docx','食堂情境.png'];
        if(seconds<materialReplyStart)state.lesson.messages=state.lesson.messages.slice(0,1);
        else{
          const response=state.lesson.messages[1];
          const rate=studentMode?response.text.length/(materialReplyEnd-materialReplyStart):36;
          response.text=response.text.slice(0,Math.max(0,Math.floor((seconds-materialReplyStart)*rate)));
          response.streaming=seconds<materialReplyEnd;
        }
        if(seconds<materialReplyStart){
          const index=materialPlayback.eventSeconds.findLastIndex(at=>at<=seconds-4);
          const event=materialTiming.events[Math.max(0,index)];
          state.activity={kind:'materials',progress:event.progress} as never;
          state.busy=seconds<materialComplete;state.running=state.busy;
        }
      }
    }
    if(shot==='speech'){
      const text=studentMode?studentSpeech:(speech.events.filter(event=>event.type==='transcript').at(-1)?.text??'').replace('先确认范围，再准备材料。','先准备导入和练习。');
      state.lesson.messages=seconds<13.3?[]:[{...state.lesson.messages[0],text}];
    }
    if(shot==='upload'){
      state.lesson.messages=seconds<4?[]:[state.lesson.messages[0]];
      if(state.lesson.messages[0])state.lesson.messages[0].text='结合这份教案和图片，设计课堂导入。';
      if(seconds>=4){state.busy=true;state.running=true;state.activity={kind:'materials',progress:{phase:'parsing',total:2,fileName:'食堂情境.png',completed:1}} as never}
    }
    return state;
  }
  const state=structuredClone(fixture.course);
  state.course=structuredClone(replayCourse);
  const pages=state.lesson.pages;
  if(studentMode&&shot==='voice-dialogue'){
    const template=state.lesson.messages[0];
    state.lesson.messages=dialogue.filter(turn=>seconds>=turn.from+(turn.role==='user'?turn.duration+1.2:0)).map((turn,i)=>({
      ...template,id:900+i,role:turn.role as 'user'|'assistant',
      text:turn.role==='user'?turn.text:turn.text.slice(0,Math.ceil(Math.min(1,(seconds-turn.from)/turn.duration)*turn.text.length)),
      streaming:turn.role==='assistant'&&seconds<turn.from+turn.duration,
    }));
    const page=pages.find(p=>p.kind==='slide')!;
    if(page.kind==='slide'){page.title='先赋值，再输出';page.markdown='# 先预测，再运行\n\n```python\nbaozi_price = 2\nprint(baozi_price)\n```\n\n只执行第一行，会显示数字吗？\n\n加上第二行，再检查自己的预测。'}
    state.lesson.pages=[page];state.lesson.presentations=state.lesson.presentations.filter(p=>p.pageId===page.id);
    state.lesson.currentPresentationId=state.lesson.presentations[0]?.id??'';
    state.busy=false;state.running=false;state.activity=null;state.generating=false;state.deliverableSelection=null;state.error='';
    return state;
  }
  if(shot==='generate'||shot==='slides'||(shot==='revision'&&seconds<12)){
    for(const page of pages){
      if(page.kind!=='slide')continue;
      const original=fixture.generationCalls.find(c=>c.name==='publish_slide'&&c.arguments.title===page.title);
      if(original?.arguments.markdown)page.markdown=original.arguments.markdown;
    }
  }
  let page=pages[0];
  let prompt=7,reply=17;
  let busy=false;
  if(shot==='generate'){
    busy=seconds>=3&&seconds<17;
    const count=seconds<7?0:seconds<11?1:seconds<15?2:3;
    state.lesson.pages=pages.slice(0,count);
    page=pages[Math.max(0,count-1)];
  }else if(shot==='revision'){
    prompt=19;reply=24;page=pages[1];busy=seconds>=4&&seconds<12;
  }else if(shot==='practice'){
    prompt=25;reply=30;page=pages.find(p=>p.kind==='coding')!;
    if(page.kind==='coding'){
      const original=page.code;
      page.code=seconds<5?page.starterCode:original.slice(0,Math.min(original.length,Math.floor((seconds-5)*15)+25));
      if(seconds<12)page.result=null as never;
    }
  }else if(shot==='question'){prompt=25;reply=30;page=pages.find(p=>p.kind==='question')!;
    page.selected=seconds>=5?[page.options![0]]:[];
  }else if(shot==='illustration'){prompt=33;reply=36;page=pages.find(p=>p.kind==='illustration')!;
  }else if(shot==='animation'){prompt=19;reply=24;page=pages.find(p=>p.id==='io-flow-v2')!;
    if(page.kind==='animation'){
      const button=page.buttons[Math.min(2,Math.floor(seconds/6))];
      const steps=seconds%6<2?[]:seconds%6<4?button.steps.slice(0,1):button.steps;
      for(const action of steps.flat())if(action.type==='update'){
        const node=page.nodes.find(n=>n.id===action.targetId);if(node)node.label=action.value;
      }
    }
  }else if(shot==='slides'){page=pages[Math.min(2,Math.floor(seconds/5))];
  }else if(shot==='document'||shot==='export'||shot==='sharing'){
    prompt=33;reply=36;
    const document=fixture.deliverables.deliverables.find(d=>d.kind==='document'&&!d.source)!;
    state.deliverableSelection={id:document.id,blockId:document.blocks[0].id};
  }
  const user=state.lesson.messages.find(m=>m.id===prompt)!;
  const response=state.lesson.messages.find(m=>m.id===reply)!;
  if(studentMode)Object.assign(response,{knowledgeSearches:[]});
  if(studentMode&&shot==='knowledge'){
    user.text='赋值以后，屏幕为什么没有显示数字？请查一下相关资料。';
    response.text=seconds<5?'':learningReplies.knowledge+'\n\n'+studentKnowledge.citation;
    Object.assign(response,{knowledgeSearches:[{id:'student-search',query:'Python 变量 赋值 print 输出',status:seconds<5?'running':'complete',sources:seconds<5?[]:[studentKnowledge]}]});
  }
  if(studentMode&&['grade-primary','grade-high'].includes(shot)){
    const primary=shot==='grade-primary';
    user.text=primary?'我上小学，先不要讲很多代码，能用名字标签解释变量吗？':'我上高中，会写简单程序。请更准确地说明赋值和 input 的类型。';
    response.text=learningReplies[shot];
    const slide=state.lesson.pages[0];if(slide.kind==='slide'){slide.title=primary?'先从名字标签理解':'进一步理解：名字、对象与类型';slide.markdown=primary?'# 给数字起一个名字\n\n`baozi_price = 2`\n\n用 baozi_price 这个名字，可以再次找到这个值。\n\n**想一想**：把 2 改成 3，会发生什么？':'# 赋值与输入类型\n\n```python\nquantity = input("需要几份？")\nprint(type(quantity))\n```\n\n输入 3，quantity 绑定的仍然是字符串 "3"。\n\n**再思考**：什么时候需要 int(quantity)？'}
  }
  if(studentMode&&studentDialogs[shot]){user.text=studentDialogs[shot].prompt;response.text=studentDialogs[shot].reply}
  // Replay captured text verbatim. Reveal pacing is editorial, not API latency.
  const start=studentMode&&shot==='knowledge'?5:studentMode&&['generate','revision'].includes(shot)?4:shot==='generate'?17:shot==='revision'?12:0;
  const end=studentMode?({'grade-primary':7.3,'grade-high':8.8,knowledge:9,generate:22,revision:18,animation:15,practice:14,illustration:11,document:10} as Record<string,number>)[shot]??6:start+6;
  const fullText=response.text;
  response.text=fullText.slice(0,Math.max(0,Math.floor(studentMode?(seconds-start)/(end-start)*fullText.length:(seconds-start)*65)));
  response.streaming=seconds<end;
  if(studentMode&&shot==='question'){
    const question=page as typeof pages[number]&{status:string;selected:string[];options:string[]};
    question.selected=seconds>=4?[question.options[1]]:[];
    question.status=seconds>=6?'submitted':'active';
    response.text=seconds<6?'先想一想：这一行代码会让屏幕显示数字吗？':studentDialogs.question.reply.slice(0,Math.max(0,Math.floor((seconds-6)/7*studentDialogs.question.reply.length)));
    response.streaming=seconds>=6&&seconds<13;
  }
  if(studentMode&&shot==='practice'&&page.kind==='coding'){
    if(seconds>=7&&seconds<12){page.code='print("欢迎光临食堂")\nprint("我是小芽"';page.result={...fixture.course.lesson.pages.find(p=>p.kind==='coding')!.result!,stdout:'',stderr:'SyntaxError: \'(\' was never closed',status:{description:'Runtime Error'}}}
    if(seconds>=12)page.code='print("欢迎光临食堂")\nprint("我是小芽")';
  }
  state.lesson.messages=seconds<3&&(shot==='generate'||shot==='revision')?[]:response.text?[user,response]:[user];
  if(studentMode&&shot==='knowledge'){state.lesson.messages=[user,response];response.streaming=seconds<9}
  state.lesson.presentations=state.lesson.presentations.filter(p=>state.lesson.pages.some(page=>page.id===p.pageId));
  state.lesson.currentPresentationId=state.lesson.presentations.find(p=>p.pageId===page.id)?.id??'';
  state.busy=busy;state.running=busy;state.generating=busy;
  state.activity=busy?{kind:'tool',label:'生成课堂内容',status:'running'} as never:null;
  state.animations=[];state.error='';state.retry=null;
  if(!['document','export','sharing'].includes(shot))state.deliverableSelection=null;
  return state;
}
export function profileState(){
  const original=shot==='onboarding'?fixture.onboarding:fixture.profile;
  const state=structuredClone(original);
  state.busy=false;
  state.conversation.status='idle';state.conversation.leaseUntil='';
  if(shot==='onboarding'){
    state.conversation.completed=false;
    state.conversation.messages=[];
    state.conversation.messageSequence=0;
    if(seconds<2)state.conversation.question=null as never;
  }
  return state;
}
