import { fileURLToPath } from 'node:url';

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3001),
    // Explicit opt-in keeps existing deployments compatible until account activation is ready.
    authEnabled: env.AUTH_ENABLED === 'true',
    authCookieSecure: env.AUTH_COOKIE_SECURE !== undefined ? env.AUTH_COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    dataFile: env.MEETING_DATA_FILE || fileURLToPath(new URL('./data/meetings.json', import.meta.url)),
    clientDist: fileURLToPath(new URL('../client/dist', import.meta.url)),
    livekitKey: env.LIVEKIT_API_KEY || 'devkey',
    livekitSecret: env.LIVEKIT_API_SECRET || 'secret',
    livekitUrl: env.LIVEKIT_URL || 'ws://127.0.0.1:7880',
    livekitInternalUrl: env.LIVEKIT_INTERNAL_URL || env.LIVEKIT_URL || 'ws://127.0.0.1:7880',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5187,http://127.0.0.1:5187').split(',').map(value => value.trim()).filter(Boolean),
    llmProvider: (env.LLM_PROVIDER || 'office').toLowerCase(),
    llmKey: env.LLM_KEY || env.LLM_API_KEY || '',
    llmBaseUrl: env.LLM_BASE_URL || 'http://10.7.1.21/v1',
    llmModel: env.LLM_MODEL || env.TEXT_MODEL || 'qwen-35b',
    geminiKey: env.GEMINI_API_KEY || '',
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS || 60000),
    llmRetryCount: Number(env.LLM_RETRY_COUNT ?? 2),
    llmRetryDelayMs: Number(env.LLM_RETRY_DELAY_MS ?? 500),
    llmRetryBudgetMs: Number(env.LLM_RETRY_BUDGET_MS || Math.min(Number(env.LLM_TIMEOUT_MS || 60000) * 2, 120000)),
    sttProvider: env.STT_PROVIDER || 'browser',
    sttBaseUrl: env.STT_BASE_URL || '',
    sttModel: env.STT_MODEL || '',
    sttModels: (env.STT_MODELS || env.STT_MODEL || '').split(',').map(value => value.trim()).filter(Boolean),
    sttKey: env.STT_API_KEY || '',
    liveSttSecret: env.LIVE_STT_SECRET || '',
    liveSttUrl: env.LIVE_STT_URL || '',
    sttDiarization: env.STT_DIARIZATION === 'true',
    sttTimeoutMs: Number(env.STT_TIMEOUT_MS || 20000),
    databaseUrl: env.DATABASE_URL || '',
    outboundWebhookUrl: env.OUTBOUND_WEBHOOK_URL || '',
    attendanceGraceMs: Number(env.ATTENDANCE_FINALIZE_GRACE_MS ?? 10000),
    verifyEmployeeId: env.VERIFY_EMPLOYEE_ID !== undefined
      ? env.VERIFY_EMPLOYEE_ID !== 'false'
      : Boolean(env.DATABASE_URL),
  };
  if (env.NODE_ENV === 'production' && config.authEnabled && !config.authCookieSecure) throw new Error('Production login requires secure cookies over HTTPS.');
  if (!Number.isInteger(config.attendanceGraceMs) || config.attendanceGraceMs < 0 || config.attendanceGraceMs > 30000) throw new Error('ATTENDANCE_FINALIZE_GRACE_MS must be 0–30000 milliseconds');
  if (Boolean(config.liveSttUrl) !== Boolean(config.liveSttSecret) || (config.liveSttSecret && config.liveSttSecret.length < 32)) throw new Error('WhisperLiveKit requires LIVE_STT_URL and LIVE_STT_SECRET of at least 32 characters');
  for (const field of ['llmTimeoutMs', 'sttTimeoutMs']) {
    if (!Number.isFinite(config[field]) || config[field] < 100 || config[field] > 120000) throw new Error(`${field} must be 100–120000 milliseconds`);
  }
  if (!Number.isInteger(config.llmRetryCount) || config.llmRetryCount < 0 || config.llmRetryCount > 3) throw new Error('LLM_RETRY_COUNT must be an integer from 0 to 3');
  if (!Number.isInteger(config.llmRetryDelayMs) || config.llmRetryDelayMs < 0 || config.llmRetryDelayMs > 5000) throw new Error('LLM_RETRY_DELAY_MS must be 0–5000 milliseconds');
  if (!Number.isInteger(config.llmRetryBudgetMs) || config.llmRetryBudgetMs < 100 || config.llmRetryBudgetMs > 120000) throw new Error('LLM_RETRY_BUDGET_MS must be 100–120000 milliseconds');
  if (!['office', 'gemini', 'demo'].includes(config.llmProvider)) throw new Error('Unknown LLM_PROVIDER');
  if (!['browser', 'server'].includes(config.sttProvider)) throw new Error('STT_PROVIDER must be browser or server');
  if (config.sttProvider === 'server' && (!config.sttBaseUrl || !config.sttModel)) throw new Error('Server STT requires STT_BASE_URL and STT_MODEL');
  if (config.sttModel && !config.sttModels.includes(config.sttModel)) throw new Error('STT_MODELS must include STT_MODEL');
  for (const [field, protocols] of [['livekitUrl', ['ws:', 'wss:']], ['llmBaseUrl', ['http:', 'https:']], ['sttBaseUrl', ['http:', 'https:']]]) {
    if (config[field] && !protocols.includes(new URL(config[field]).protocol)) throw new Error(`Invalid ${field} protocol`);
  }
  if (env.NODE_ENV === 'production' && (config.livekitKey === 'devkey' || config.livekitSecret === 'secret')) {
    throw new Error('Production requires non-development LiveKit credentials');
  }
  return config;
}
