// Configuration alone is not readiness. Opt-in stays fail-closed on probe errors.
export async function qwenDiarizationReady(config, fetchImpl = fetch) {
  if (!config.qwenDiarizationEnabled || !config.qwenSttBaseUrl) return false;
  try {
    const base = config.qwenSttBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const response = await fetchImpl(`${base}/health`, {
      headers: config.qwenSttKey ? { Authorization: `Bearer ${config.qwenSttKey}` } : {},
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ready === true && health.diarization === true;
  } catch { return false; }
}
