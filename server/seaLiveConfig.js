import {createHmac,timingSafeEqual} from 'node:crypto';
export const SEA_LIVE_MODEL = 'sea-asr-id-live';

export async function seaLiveCapabilities(config, fetchImpl=fetch) {
  if (!config.seaLiveSttUrl || !config.seaLiveSttSecret) return {ready:false,diarization:false};
  try {
    const response=await fetchImpl(config.seaLiveHealthUrl || 'http://127.0.0.1:8010/health', {signal:AbortSignal.timeout(1500)});
    if (!response.ok) return {ready:false,diarization:false};
    const data=await response.json();
    const ready=data.ready===true && data.streaming===true && data.model===SEA_LIVE_MODEL && Array.isArray(data.languages) && data.languages.includes('id');
    const workerTime=Date.parse(response.headers.get('date'))/1000;
    return {ready,diarization:ready && data.diarization===true,...(Number.isFinite(workerTime)?{workerTime:Math.floor(workerTime)}:{})};
  } catch { return {ready:false,diarization:false}; }
}

// The original connect ticket proves session mode, not current upload authorization.
// Long-running/resumed sessions keep their nonce after the 60-second connect TTL.
export function seaSessionDiarized(value,config,meetingId,speakerId) {
  if (value.sessionProof === undefined) return false;
  const raw=value.sessionProof;
  if (typeof raw!=='string' || raw.length>8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw) || !config.seaLiveSttSecret) throw Error('Invalid SEA proof');
  const [payload,signature]=raw.split('.');
  const expected=createHmac('sha256',config.seaLiveSttSecret).update(payload).digest();
  const actual=Buffer.from(signature,'base64url');
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw Error('Invalid SEA signature');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if (claims.meetingId!==meetingId || claims.speakerId!==speakerId || claims.nonce!==value.sessionId
    || claims.model!==SEA_LIVE_MODEL || claims.language!=='id' || typeof claims.diarize!=='boolean'
    || !Number.isFinite(claims.exp)) throw Error('Invalid SEA binding');
  return claims.diarize;
}
