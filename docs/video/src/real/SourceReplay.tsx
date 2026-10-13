import React,{useEffect,useRef,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile,useCurrentFrame,getRemotionEnvironment} from 'remotion';

export function SourceReplay({shot,rate=1,seconds,audience='teacher'}:{shot:string;rate?:number;seconds?:number;audience?:'teacher'|'student'}){
  const currentFrame=useCurrentFrame();
  const frame=seconds===undefined?currentFrame*rate:seconds*30;
  const iframe=useRef<HTMLIFrameElement>(null);
  const [loaded,setLoaded]=useState(false);
  const [source]=useState(()=>`${staticFile('replay/index.html')}?shot=${shot}&time=${frame/30}&audience=${audience}`);
  const [initial]=useState(()=>delayRender('Loading original Zhiya frontend'));
  const latest=useRef({frame,shot});latest.current={frame,shot};
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==iframe.current?.contentWindow)return;
      if(event.data?.type==='zhiya-loaded'){setLoaded(true);continueRender(initial)}
    };
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);continueRender(initial)};
  },[initial]);
  useEffect(()=>{
    if(!loaded)return;
    if(!getRemotionEnvironment().isRendering){
      const send=(exact:boolean)=>iframe.current?.contentWindow?.postMessage({type:'zhiya-seek',id:performance.now(),seconds:frame/30,nextShot:shot,preview:!exact},'*');
      send(false);
      // Once playback or scrubbing stops, settle the exact requested frame.
      const settle=setTimeout(()=>send(true),150);
      return()=>clearTimeout(settle);
    }
    const id=delayRender(`Seeking ${shot} at frame ${frame}`);
    const receive=(event:MessageEvent)=>{
      if(event.source===iframe.current?.contentWindow&&event.data?.type==='zhiya-ready'&&event.data.id===id){continueRender(id)}
      if(event.source===iframe.current?.contentWindow&&event.data?.type==='zhiya-error'&&event.data.id===id)cancelRender(new Error(event.data.message));
    };
    window.addEventListener('message',receive);
    iframe.current?.contentWindow?.postMessage({type:'zhiya-seek',id,seconds:frame/30,nextShot:shot},'*');
    return()=>{window.removeEventListener('message',receive);continueRender(id)};
  },[frame,shot,loaded]);
  return <iframe ref={iframe} title="知芽原生页面回放" src={source} style={{border:0,width:1920,height:1080,background:'#fff',pointerEvents:'none'}}/>;
}
