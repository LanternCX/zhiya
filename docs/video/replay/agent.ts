import {subscribe,courseState,profileState,replayCourse} from './state';
export function subscribeAgentStatuses(receive:Function){receive([],replayCourse.sections.flatMap(s=>s.conversations.map(c=>({...c,courseId:replayCourse.id,sectionId:s.id}))));return()=>{}}
export class AgentConnection<T>{
  private closeListener:()=>void;
  constructor(private input:any,private receive:Function,_failure:Function,sync?:Function){
    this.closeListener=subscribe(()=>this.publish());queueMicrotask(()=>{this.publish();sync?.('live')});
  }
  private publish(){this.receive(this.input.kind==='profile'?profileState():courseState())}
  get ready(){return Promise.resolve({id:'replay',state:this.input.kind==='profile'?profileState():courseState()})}
  async command(){this.publish()}
  close(){this.closeListener()}
}
