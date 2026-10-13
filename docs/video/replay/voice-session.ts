// Audio is scheduled by Remotion, never by a live socket or a browser timer.
export class VoiceSessionController {
  private listeners=new Set<(state:any)=>void>();
  private state={status:'idle',sessionId:'replay-voice',turnId:0,error:null,errorKind:null};
  constructor(private onInterrupt=()=>{}){}
  subscribe(fn:(state:any)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  getState(){return this.state}
  private update(status:string){this.state={...this.state,status};this.listeners.forEach(fn=>fn(this.state))}
  async start(){this.update('ready')}
  setSpeaker(_enabled:boolean){}
  speakText(text:string,done=()=>{},progress=(_text:string)=>{}){progress(text);done()}
  reportAgentError(_message:string){}
  interrupt(){this.onInterrupt();this.update('ready')}
  end(){this.update('ended')}
  handleVisibilityChange(hidden:boolean){if(hidden)this.end()}
}
