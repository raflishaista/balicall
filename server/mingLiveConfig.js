export const MING_LIVE_MODEL = 'ming3-asr-tiny-live';

export async function mingLiveCapabilities(config, fetchImpl=fetch) {
  if (!config.mingLiveSttUrl || !config.mingLiveSttSecret) return {ready:false};
  try {
    const response=await fetchImpl(config.mingLiveHealthUrl || 'http://127.0.0.1:8011/health', {signal:AbortSignal.timeout(1500)});
    if (!response.ok) return {ready:false};
    const data=await response.json();
    const ready=data.ready===true && data.streaming===true && data.model===MING_LIVE_MODEL && Array.isArray(data.languages) && data.languages.includes('en');
    const workerTime=Date.parse(response.headers.get('date'))/1000;
    return {ready, ...(Number.isFinite(workerTime) ? {workerTime:Math.floor(workerTime)} : {})};
  } catch { return {ready:false}; }
}
