import React from 'react';

type Caption = {text:string;start:number;end:number};
type Voice = {from:number;captions:Caption[]};

export function Subtitle({seconds,voices}:{seconds:number;voices:Voice[]}) {
  const cues=voices.flatMap(voice=>voice.captions.map(cue=>({
    ...cue,start:voice.from+cue.start,end:voice.from+cue.end,
  }))).sort((a,b)=>a.start-b.start);
  let index=-1;
  for(let i=0;i<cues.length&&cues[i].start<=seconds;i++)index=i;
  const cue=cues[index];
  if(!cue)return null;
  const next=cues[index+1];
  // Keep the current words through a breath; swap directly when speech resumes.
  const continuous=next&&next.start-cue.end<=1.5;
  const until=continuous?next.start:cue.end+.65;
  if(seconds>=until)return null;
  const opacity=continuous?1:Math.min(1,Math.max(0,(until-seconds)/.2));
  return <div style={{position:'absolute',bottom:58,left:0,right:0,zIndex:10,
    display:'flex',justifyContent:'center',pointerEvents:'none',opacity}}>
    <span style={{maxWidth:1540,padding:'4px 23px',borderRadius:8,
      background:'rgba(245,245,239,.88)',color:'#4d624f',fontSize:29,
      fontWeight:400,lineHeight:1.4,letterSpacing:.5,textAlign:'center'}}>
      {cue.text.replace(/[，。；：、]$/,'')}
    </span>
  </div>;
}
