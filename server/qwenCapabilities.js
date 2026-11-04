// Configuration alone is not readiness. Opt-in stays fail-closed on probe errors.
export async function qwenGgufReady(config, fetchImpl = fetch) {
  if (!config.qwenGgufSttBaseUrl) return false;
  try {
    const base = config.qwenGgufSttBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const response = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const health = await response.json();
    if (health.status !== 'ok' || health.backend !== 'qwen3') return false;
    const modelsResponse = await fetchImpl(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) });
    if (!modelsResponse.ok) return false;
    const models = await modelsResponse.json();
    return Array.isArray(models.data) && models.data.some(model => model.backend === 'qwen3' && typeof model.id === 'string' && /(?:^|[\\/])qwen3-asr-0\.6b-q8_0\.gguf$/i.test(model.id));
  } catch { return false; }
}
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
