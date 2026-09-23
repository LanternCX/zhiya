import { MicIcon, MicOffIcon, PhoneOffIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import type { VoiceState } from "./types";
import "./voice-mode.css";

export function VoiceModePanel({ state, muted, speakerOn, onMute, onSpeaker, onExit }: {
  state: VoiceState;
  muted: boolean;
  speakerOn: boolean;
  onMute: () => void;
  onSpeaker: () => void;
  onExit: () => void;
}) {
  const label = state.status === "speaking" ? "知芽正在回答" : state.status === "thinking" ? "正在思考" : state.status === "connecting" ? "正在连接" : "正在聆听";
  return <div className="voice-mode-panel" role="region" aria-label="语音对话">
    <div className="voice-mode-status"><span className="voice-mode-orb" aria-hidden="true" /><span>{label}</span>{state.error && <small role="alert">{state.error}</small>}</div>
    <div className="voice-mode-actions">
      <button type="button" aria-label={muted ? "打开麦克风" : "静音麦克风"} onClick={onMute} style={{ backgroundColor: muted ? undefined : `rgba(0, 0, 0, ${Math.min(0.18, state.inputLevel * 0.18)})` }}>{muted ? <MicOffIcon /> : <MicIcon />}</button>
      <button type="button" aria-label={speakerOn ? "关闭扬声器" : "打开扬声器"} onClick={onSpeaker}>{speakerOn ? <Volume2Icon /> : <VolumeXIcon />}</button>
      <button type="button" aria-label="结束语音对话" className="voice-mode-exit" onClick={onExit}><PhoneOffIcon /></button>
    </div>
  </div>;
}
