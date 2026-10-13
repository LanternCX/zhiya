/** Replay clocks preserve completed operations when narration-led scenes shorten. */
export function studentReplaySeconds(id:string, seconds:number):number {
  if(id==='followup') return 12+seconds*.5;
  // Keep attachment selection and the streamed answer intact. Compress only
  // the parser's waiting interval (original replay seconds 4–10).
  if(id==='references') return seconds<=4?seconds:seconds<=7?4+(seconds-4)*2:seconds+3;
  // The generation clock includes a long build interval before the response.
  if(id==='generate') return seconds<=3?seconds:seconds<=10?3+(seconds-3)*2:seconds+7;
  if(id==='revision') return seconds*1.5;
  if(id==='animation') return seconds*1.08;
  return seconds;
}
