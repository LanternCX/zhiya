import evidence from './speech-evidence.json';
import {studentMode,studentSpeech} from './student-data';
import dialogue from '../src/student/dialogue-timing.json';
export type VoiceInputStatus='idle'|'connecting'|'listening'|'finishing'|'paused';
const controllers=new Set<VoiceInputController>();
export function replayTranscript(seconds:number){for(const controller of controllers)controller.at(seconds)}
export function replayDialogue(seconds:number){for(const controller of controllers)controller.dialogueAt(seconds)}
export class VoiceInputController{
  private status:VoiceInputStatus='idle';
  private committed=new Set<string>();
  constructor(private utterance:(text:string)=>void,private update:(status:VoiceInputStatus,text:string)=>void,_error:Function,_options:unknown={}){}
  getStatus(){return this.status}
  async start(){controllers.add(this);this.status='listening';this.update(this.status,'')}
  dialogueAt(seconds:number){
    const current=dialogue.find(turn=>turn.role==='user'&&seconds>=turn.from&&seconds<turn.from+turn.duration+1.2);
    if(current){
      const progress=Math.min(1,(seconds-current.from)/current.duration);
      this.status=progress<1?'listening':'finishing';
      this.update(this.status,current.text.slice(0,Math.ceil(progress*current.text.length)));
    }else this.update('listening','');
    for(const turn of dialogue.filter(t=>t.role==='user')){
      if(seconds>=turn.from+turn.duration+1.2&&!this.committed.has(turn.id)){
        this.committed.add(turn.id);this.utterance(turn.text);
      }
    }
  }
  at(seconds:number){
    const transcripts=evidence.events.filter(e=>e.type==='transcript');
    const index=Math.max(0,Math.min(transcripts.length-1,Math.floor((seconds-1)/9*transcripts.length)));
    if(seconds>=10){this.stop();return}
    this.update('listening',studentMode?studentSpeech.slice(0,Math.floor((seconds-1)/9*studentSpeech.length)):transcripts[index]?.text??'');
  }
  stop(){const text=studentMode?studentSpeech:evidence.events.filter(e=>e.type==='transcript').at(-1)?.text??'';this.status='idle';controllers.delete(this);this.utterance(text)}
  pause(){this.status='paused';controllers.delete(this);this.update('paused','')}
  end(){controllers.delete(this);this.status='idle'}
}
