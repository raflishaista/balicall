export const QWEN_LIVE_MODEL='qwen3-asr-0.6b-live';

export function attributedSpeakerName(accountName,segment){
 const label=segment.sessionId?`${segment.speaker} · sesi ${segment.sessionId.slice(0,8)}`:segment.speaker;
 return `${accountName||'Anonymous'} (${label})`;
}

export async function qwenLiveCapabilities(config,fetchImpl=fetch){
 if(!config.qwenLiveSttUrl||!config.qwenLiveSttSecret)return {ready:false,diarization:false};
 try{
  const response=await fetchImpl(config.qwenLiveHealthUrl||'http://127.0.0.1:8008/health',{signal:AbortSignal.timeout(1500)});
  if(!response.ok)return {ready:false,diarization:false};
  const data=await response.json();
  const ready=data.ready===true&&data.streaming===true&&data.native===true&&data.model===QWEN_LIVE_MODEL;
  return {ready,diarization:ready&&data.diarization===true};
 }catch{return {ready:false,diarization:false};}
}

export function validateLiveFinal(value,speakerId){
 const validString=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
 if(!value||value.sourceId!==speakerId||!validString(value.sessionId,100)||!/^[\w-]+$/.test(value.sessionId)
  ||!validString(value.segmentId,150)||!value.segmentId.startsWith(value.sessionId+'-')
  ||!validString(value.text,9000)||!validString(value.speakerLabel,100)
  ||!Number.isFinite(value.start)||!Number.isFinite(value.end)||value.start<0||value.end<=value.start||value.end-value.start>60
  ||!['assigned','unknown','overlap'].includes(value.attribution))throw new Error('Invalid streaming final segment');
 return {text:value.text.trim(),requestId:value.segmentId,segments:[{text:value.text.trim(),speaker:value.speakerLabel,
  start:value.start,end:value.end,sourceId:speakerId,sessionId:value.sessionId,attribution:value.attribution}]};
}
