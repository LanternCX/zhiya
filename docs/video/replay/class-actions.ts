import {sharing} from './class-data';

const raf=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
async function waitFor(selector:string){
  for(let i=0;i<120;i++){const element=[...document.querySelectorAll<HTMLElement>(selector)].find(el=>el.getClientRects().length>0&&!el.closest('[hidden]'));if(element)return element;await raf()}
  throw new Error(`Replay element missing: ${selector}`);
}
async function clickText(text:string){
  for(let i=0;i<120;i++){
    const button=[...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(el=>el.textContent?.trim()===text&&el.getClientRects().length>0&&!el.closest('[hidden]'));
    if(button){button.click();await raf();return button}
    await raf();
  }
  throw new Error(`Replay action missing: ${text}`);
}
function fill(input:HTMLInputElement,value:string){
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
export const classroomPath=`/classes/${sharing.classroom.class.id}`;
export function classRoute(shot:string){
  if(shot==='class-create'||shot==='class-join')return '/classes';
  if(shot==='class-invite')return `${classroomPath}/manage`;
  if(shot==='class-members')return classroomPath;
  if(shot==='materials')return `${classroomPath}/shares`;
  if(shot==='reader')return `/shares/${sharing.saved.token}`;
  return null;
}
export function actionStage(shot:string,seconds:number){
  if(shot==='sharing')return seconds<2?0:seconds<4?1:seconds<6?2:seconds<9?3:4;
  if(['class-create','class-join'].includes(shot))return seconds<1?0:seconds<3.5?1:2;
  if(shot==='class-invite')return seconds<1?0:1;
  return 0;
}
export async function classActions(shot:string,stage:number,previous=0){
  if(!stage)return;
  if(shot==='class-invite'){await clickText('邀请成员');await waitFor('.class-invitation-code');return}
  if(shot==='class-create'||shot==='class-join'){
    if(previous<1)await clickText(shot==='class-create'?'创建班级':'加入班级');
    const input=await waitFor('#class-draft') as HTMLInputElement;
    fill(input,shot==='class-create'?sharing.classroom.class.name:sharing.invitation.code);
    if(stage>=2&&previous<2){await raf();input.form!.requestSubmit();await waitFor('.class-detail-header')}
    return;
  }
  if(shot==='sharing'){
    // The original workspace resolves its selected deliverable after mounting.
    // Wait for that selection before opening its menu, which otherwise unmounts.
    if(previous<1){
    const documentTab=document.querySelector<HTMLButtonElement>('button[aria-label="文档"]');
    if(documentTab?.getAttribute('aria-pressed')==='false'){documentTab.click();await raf()}
    await waitFor('.deliverable-paper');
    for(let i=0;i<8;i++)await raf();
    const trigger=await waitFor('.share-actions-trigger:not(:disabled)');
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown'}));
    await clickText('分享设置');
    await waitFor('input[value="class"]');
    }
    if(stage>=2&&previous<2){(document.querySelector('input[value="class"]') as HTMLElement).click();await raf()}
    if(stage>=3&&previous<3){const checkbox=await waitFor('.share-class-option input') as HTMLInputElement;if(!checkbox.checked)checkbox.click();await raf()}
    if(stage>=4&&previous<4){await clickText('保存班级分享');await raf()}
  }
}
