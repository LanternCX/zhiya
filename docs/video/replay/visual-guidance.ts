const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const smooth=(value:number)=>{const t=clamp(value);return t*t*(3-2*t)};
type Focus={selector:string;start:number;end:number;scale:number};
const focuses:Record<string,Focus>={
  'voice-dialogue':{selector:'.course-conversation',start:.2,end:35,scale:1.35},
  speech:{selector:'.course-composer',start:.2,end:13.1,scale:2.05},
  upload:{selector:'.course-composer',start:.2,end:3.8,scale:1.9},
  sharing:{selector:'.share-dialog',start:2.4,end:13,scale:1.16},
  'class-create':{selector:'[role="dialog"]',start:1.1,end:3.3,scale:1.45},
  'class-join':{selector:'[role="dialog"]',start:1.1,end:3.3,scale:1.45},
  'class-invite':{selector:'[role="dialog"]',start:1.1,end:3.6,scale:1.45},
  export:{selector:'.share-menu',start:2.1,end:3.5,scale:1.55},
};
const clicks:Record<string,number[]>={'voice-dialogue':[.8],speech:[1,10,13.3],upload:[1,4],sharing:[2,4,6,9],export:[2],'class-create':[1,3.5],'class-join':[1,3.5],'class-invite':[1],references:[6],practice:[12],animation:[2,8,14]};
export function resetCamera(){document.body.style.transform='none'}
export function guide(shot:string,seconds:number,target:Element|null){
  let cursor=document.getElementById('replay-pointer');
  if(!cursor){cursor=document.createElement('div');cursor.id='replay-pointer';cursor.innerHTML='<svg width="30" height="36" viewBox="0 0 30 36"><path d="M3 2L25 22L15 23L11 33L3 2Z" fill="#244c35" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>';document.body.append(cursor)}
  const r=target?.getBoundingClientRect();
  const visible=Boolean(r&&r.width&&r.height);
  cursor.style.display=visible?'block':'none';
  let ring=document.getElementById('replay-click');
  if(!ring){ring=document.createElement('div');ring.id='replay-click';document.body.append(ring)}
  const elapsed=seconds-(clicks[shot]?.filter(time=>time<=seconds).at(-1)??-100);
  if(r&&visible){
    const x=r.x+r.width*.65,y=r.y+r.height*.6;
    cursor.style.left=`${x}px`;cursor.style.top=`${y}px`;
    const pulse=elapsed>=0&&elapsed<.42;
    let clickTarget=target;
    if(shot==='sharing')clickTarget=document.querySelector(seconds>=9?'.share-class-choice button':seconds>=6?'.share-class-option input':seconds>=4?'input[value="class"]':'.share-actions-trigger');
    if(shot.startsWith('class-')&&seconds>=3.5)clickTarget=null;
    const clicked=clickTarget?.getBoundingClientRect();
    ring.style.display=pulse&&clicked?'block':'none';ring.style.left=`${clicked?clicked.x+clicked.width*.65:x}px`;ring.style.top=`${clicked?clicked.y+clicked.height*.6:y}px`;
    ring.style.opacity=String(1-elapsed/.42);ring.style.transform=`translate(-50%,-50%) scale(${.5+elapsed*2.5})`;
    cursor.style.transform=`scale(${pulse?1-.16*Math.sin(elapsed/.42*Math.PI):1})`;
  }else ring.style.display='none';
  const focus=focuses[shot];
  const subject=focus&&document.querySelector(focus.selector);
  if(!focus||!subject)return;
  const amount=smooth((seconds-focus.start)/.55)*(1-smooth((seconds-focus.end)/.55));
  const scale=1+(focus.scale-1)*amount;
  const box=subject.getBoundingClientRect();
  // Fit the actual component; bottom-edge composers move into the reading area.
  const fitted=Math.min(scale,1740/Math.max(box.width,1),940/Math.max(box.height,1));
  const zoom=Math.max(1,fitted);
  const x=Math.max(1920*(1-zoom),Math.min(0,960-(box.x+box.width/2)*zoom));
  const naturalY=Math.max(1080*(1-zoom),Math.min(0,600-(box.y+box.height/2)*zoom));
  const y=['speech','upload'].includes(shot)?naturalY-240*amount:naturalY;
  document.body.style.transformOrigin='0 0';
  document.body.style.transform=`translate(${x}px,${y}px) scale(${zoom})`;
}
