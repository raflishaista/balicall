import {createHmac,timingSafeEqual} from 'node:crypto';
export const QWEN_GGUF_LIVE_MODEL='qwen3-asr-0.6b-gguf-q8-live';

export async function qwenGgufLiveCapabilities(config,fetchImpl=fetch) {
  if (!config.qwenGgufLiveUrl || !config.qwenGgufLiveSecret) return {ready:false,diarization:false};
  try {
    const response=await fetchImpl(config.qwenGgufLiveHealthUrl,{signal:AbortSignal.timeout(1500)});
    if (!response.ok) return {ready:false,diarization:false};
    const data=await response.json();
    const ready=data.ready===true && data.streaming===true && data.native===false && data.model===QWEN_GGUF_LIVE_MODEL;
    const workerTime=Date.parse(response.headers.get('date'))/1000;
    return {ready,diarization:ready && data.diarization===true,...(Number.isFinite(workerTime)?{workerTime:Math.floor(workerTime)}:{})};
  } catch { return {ready:false,diarization:false}; }
}

export function ggufSessionDiarized(value,config,meetingId,speakerId) {
  const raw=value.sessionProof;
  if(typeof raw!=='string'||raw.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)||!config.qwenGgufLiveSecret) throw Error('Invalid Q8 proof');
  const [payload,signature]=raw.split('.');
  const expected=createHmac('sha256',config.qwenGgufLiveSecret).update(payload).digest(),actual=Buffer.from(signature,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw Error('Invalid Q8 signature');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if(claims.model!==QWEN_GGUF_LIVE_MODEL || claims.meetingId!==meetingId || claims.speakerId!==speakerId || claims.nonce!==value.sessionId || !['id','en'].includes(claims.language) || typeof claims.diarize!=='boolean' || !Number.isFinite(claims.exp)) throw Error('Invalid Q8 binding');
  return claims.diarize;
}
