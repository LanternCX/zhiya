import {fixture,courseState,shot,replayCourse} from './state';
import {sharing} from './class-data';
import evidence from './evidence.json';
import {studentMode,studentKnowledge} from './student-data';
export class APIError extends Error{constructor(public status:number,message:string){super(message)}}
export const connectionRetryDelay=()=>1000;
export const retryRateLimited=<T,>(fn:()=>Promise<T>)=>fn();
export async function api(path:string,method='GET',body?:any){
  if(studentMode&&path.startsWith('/knowledge/'))return path.endsWith('/original')?{url:new URL('./student-reference.md',location.href).href}:studentKnowledge;
  const active=['references','upload','speech','material-process'].includes(shot)?evidence.state:fixture.course;
  if(path==='/account-rules')return fixture.rules;
  if(path==='/me')return studentMode?{...sharing.student,nickname:'小芽同学'}:['class-join','materials','reader'].includes(shot)?sharing.student:fixture.user;
  if(path==='/classes')return method==='POST'?sharing.classroom:['class-create','class-join'].includes(shot)?{classes:[]}:sharing.classes;
  if(path==='/classes/join')return sharing.classroom;
  if(path.endsWith('/invitation'))return sharing.invitation;
  if(path.startsWith('/classes/')&&path.endsWith('/shares'))return sharing.materials;
  if(path.startsWith('/classes/'))return sharing.classroom;
  if(path.startsWith('/shares/'))return sharing.reader;
  if(path.endsWith('/share'))return method==='PUT'?sharing.saved:sharing.before;
  if(path.includes('/materials/')&&path.includes('/content')){
    const id=path.split('/materials/')[1].split('/')[0];
    const content=structuredClone((evidence.contents as Record<string,any>)[id]);
    const query=new URL(path,location.origin).searchParams;
    const start=Number(query.get('startLine')??1),end=Number(query.get('endLine')??Infinity);
    content.excerpt.lines=content.excerpt.lines.filter((line:any)=>line.number>=start&&line.number<=end);
    content.excerpt.nextLine=null;
    return content;
  }
  if(path==='/learning/model')return {id:'replay',available:true};
  if(path.includes('/illustrations/')&&path.endsWith('/download'))return {url:new URL('./illustration.png',location.href).href};
  if(path.includes('/deliverable-images/'))return {url:new URL('./illustration.png',location.href).href};
  if(path==='/courses')return {courses:[{...replayCourse,state:courseState().lesson,conversationId:active.conversationId}]};
  if(path.endsWith('/deliverables'))return fixture.deliverables;
  if(path.includes('/deliverables/'))return {deliverable:fixture.deliverables.deliverables.find(item=>item.id===path.split('/deliverables/')[1])};
  if(path.endsWith('/materials'))return evidence.materials;
  if(path.includes('/classes'))return {classes:[]};
  if(path.startsWith('/courses/'))return {course:{...replayCourse,state:courseState().lesson,conversationId:active.conversationId}};
  throw new Error(`Uncaptured replay request: ${path}`);
}
