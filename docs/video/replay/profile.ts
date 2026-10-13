import {subscribe,profileState} from './state';
import {conversationView} from '../../../apps/client/src/features/profile/view';
export class ProfileConnection{
  get running(){return false}
  subscribe(fn:Function){return subscribe(()=>fn(conversationView(profileState().conversation as never)))}
  async open(){return conversationView(profileState().conversation as never)}
  async answer(){return this.open()}
  async endCorrection(){return this.open()}
  createSession(){return{isStopped:false,run:async()=>{},stop(){},detach(){}}}
  close(){}
}
