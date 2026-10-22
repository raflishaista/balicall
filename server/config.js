import { SEA_LIVE_MODEL } from './seaLiveConfig.js';
import { fileURLToPath } from 'node:url';

export const QWEN_STT_MODEL = 'qwen3-asr-0.6b';
export function availableSttModels(config) {
  const models = config.sttModels?.length ? config.sttModels : (config.sttModel ? [config.sttModel] : []);
  return [...new Set([...models.filter(model => model !== SEA_LIVE_MODEL && (model !== QWEN_STT_MODEL || config.qwenSttBaseUrl)),
    ...(config.qwenSttBaseUrl ? [QWEN_STT_MODEL] : [])])];
}

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3001),
    // Explicit opt-in keeps existing deployments compatible until account activation is ready.
    authEnabled: env.AUTH_ENABLED === 'true',
    vapidPublicKey:env.VAPID_PUBLIC_KEY||'',vapidPrivateKey:env.VAPID_PRIVATE_KEY||'',vapidSubject:env.VAPID_SUBJECT||'',
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
    qwenLiveSttUrl: env.QWEN_LIVE_STT_URL || '',
    qwenLiveSttSecret: env.QWEN_LIVE_STT_SECRET || '',
    qwenLiveHealthUrl: env.QWEN_LIVE_HEALTH_URL || 'http://127.0.0.1:8008/health',
    seaLiveSttUrl: env.SEA_LIVE_STT_URL || '',
    seaLiveSttSecret: env.SEA_LIVE_STT_SECRET || '',
    seaLiveHealthUrl: env.SEA_LIVE_HEALTH_URL || 'http://127.0.0.1:8010/health',
    seaLiveUpstreamUrl: env.SEA_LIVE_UPSTREAM_URL || 'ws://127.0.0.1:8010/asr',
    seaLivePilotEnabled: env.SEA_LIVE_PILOT_ENABLED === 'true',
    sttDiarization: env.STT_DIARIZATION === 'true',
    sttTimeoutMs: Number(env.STT_TIMEOUT_MS || 20000),

    // fitur upload file meeting recording
    recordingUploadDir: env.RECORDING_UPLOAD_DIR || fileURLToPath(new URL('./data/recording-uploads', import.meta.url)),
    recordingUploadMaxMb: Number(env.RECORDING_UPLOAD_MAX_MB || 500),
    recordingSttUrl: env.RECORDING_STT_URL || '',
    recordingSttModel: env.RECORDING_STT_MODEL || env.STT_MODEL || '',
    recordingSttKey: env.RECORDING_STT_API_KEY || env.STT_API_KEY || '',
    recordingDiarization: env.RECORDING_DIARIZATION === 'true',
    recordingPollMs: Number(env.RECORDING_POLL_MS || 5000),
    recordingMaxProcessMin: Number(env.RECORDING_MAX_PROCESS_MIN || 240),
    recordingLlmModels: (env.RECORDING_LLM_MODELS || '').split(',').map(value => value.trim()).filter(Boolean),
    recordingSttModels: (env.RECORDING_STT_MODELS || '').split(',').map(value => value.trim()).filter(Boolean),
    recordingDiarizers: (env.RECORDING_DIARIZERS || '').split(',').map(value => value.trim()).filter(Boolean),
   
    qwenSttBaseUrl: env.QWEN_STT_BASE_URL || '',
    // Operator opt-in only. Keep UI locked until real diarization QC passes.
    qwenDiarizationEnabled: env.QWEN_DIARIZATION_ENABLED === 'true',
    qwenSttKey: env.QWEN_STT_API_KEY || '',
    qwenSttTimeoutMs: Number(env.QWEN_STT_TIMEOUT_MS || 60000),
    databaseUrl: env.DATABASE_URL || '',
    outboundWebhookUrl: env.OUTBOUND_WEBHOOK_URL || '',
    attendanceGraceMs: Number(env.ATTENDANCE_FINALIZE_GRACE_MS ?? 10000),
    // DISABLED EMPLOYEE ID CHECK (saved for future re-enabling):
    // To re-enable strict verification, set VERIFY_EMPLOYEE_ID=true in .env
    /*
    verifyEmployeeId: env.VERIFY_EMPLOYEE_ID !== undefined
      ? env.VERIFY_EMPLOYEE_ID !== 'false'
      : Boolean(env.DATABASE_URL),
    */
    verifyEmployeeId: env.VERIFY_EMPLOYEE_ID === 'true',
  };
  if (env.NODE_ENV === 'production' && config.authEnabled && !config.authCookieSecure) throw new Error('Production login requires secure cookies over HTTPS.');
  if([config.vapidPublicKey,config.vapidPrivateKey,config.vapidSubject].some(Boolean)&&
    (!/^[\w-]{87}$/.test(config.vapidPublicKey)||!/^[\w-]{43}$/.test(config.vapidPrivateKey)||!(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.vapidSubject))))throw new Error('Configure all VAPID keys and a valid mailto/HTTPS subject, or leave all empty.');
  if (!Number.isInteger(config.attendanceGraceMs) || config.attendanceGraceMs < 0 || config.attendanceGraceMs > 30000) throw new Error('ATTENDANCE_FINALIZE_GRACE_MS must be 0–30000 milliseconds');
  if (Boolean(config.liveSttUrl) !== Boolean(config.liveSttSecret) || (config.liveSttSecret && config.liveSttSecret.length < 32)) throw new Error('WhisperLiveKit requires LIVE_STT_URL and LIVE_STT_SECRET of at least 32 characters');
  if (Boolean(config.qwenLiveSttUrl) !== Boolean(config.qwenLiveSttSecret) || (config.qwenLiveSttSecret && config.qwenLiveSttSecret.length < 32)) throw new Error('Qwen streaming requires QWEN_LIVE_STT_URL and a secret of at least 32 characters');
  if(config.qwenLiveSttUrl&&!/^\/[\w/-]+$/.test(config.qwenLiveSttUrl))throw new Error('Qwen streaming URL must be a same-origin path');
  if (Boolean(config.seaLiveSttUrl) !== Boolean(config.seaLiveSttSecret) || (config.seaLiveSttSecret && config.seaLiveSttSecret.length < 32)) throw new Error('SEA streaming requires paired URL and secret of at least 32 characters');
  if (config.seaLiveSttUrl && !/^\/[\w/-]+$/.test(config.seaLiveSttUrl)) throw new Error('SEA streaming URL must be a same-origin path');
  if (config.seaLiveSttUrl && config.seaLiveSttUrl !== '/sea-live-stt/asr') throw new Error('SEA streaming must use the production WebSocket proxy route');
  const seaUpstream = new URL(config.seaLiveUpstreamUrl);
  if (!['ws:', 'wss:'].includes(seaUpstream.protocol) || seaUpstream.username || seaUpstream.password || seaUpstream.search || seaUpstream.hash || seaUpstream.pathname !== '/asr') throw new Error('SEA upstream must be a ws/wss /asr URL without credentials or query');
  if (config.sttModel === SEA_LIVE_MODEL) throw new Error('SEA is an optional live model; retain a batch STT_MODEL default');
  for (const field of ['llmTimeoutMs', 'sttTimeoutMs', 'qwenSttTimeoutMs']) {
    if (!Number.isFinite(config[field]) || config[field] < 100 || config[field] > 120000) throw new Error(`${field} must be 100–120000 milliseconds`);
  }
  if (!Number.isInteger(config.llmRetryCount) || config.llmRetryCount < 0 || config.llmRetryCount > 3) throw new Error('LLM_RETRY_COUNT must be an integer from 0 to 3');
  if (!Number.isInteger(config.llmRetryDelayMs) || config.llmRetryDelayMs < 0 || config.llmRetryDelayMs > 5000) throw new Error('LLM_RETRY_DELAY_MS must be 0–5000 milliseconds');
  if (!Number.isInteger(config.llmRetryBudgetMs) || config.llmRetryBudgetMs < 100 || config.llmRetryBudgetMs > 120000) throw new Error('LLM_RETRY_BUDGET_MS must be 100–120000 milliseconds');
  if (!['office', 'gemini', 'demo'].includes(config.llmProvider)) throw new Error('Unknown LLM_PROVIDER');
  if (!['browser', 'server'].includes(config.sttProvider)) throw new Error('STT_PROVIDER must be browser or server');
  if (config.sttModel === QWEN_STT_MODEL && !config.qwenSttBaseUrl) throw new Error('Qwen requires QWEN_STT_BASE_URL');
  if (config.sttProvider === 'server' && (!config.sttModel || !(config.sttModel === QWEN_STT_MODEL ? config.qwenSttBaseUrl : config.sttBaseUrl))) throw new Error('Server STT requires its endpoint and STT_MODEL');
  if (config.sttModel && !config.sttModels.includes(config.sttModel)) throw new Error('STT_MODELS must include STT_MODEL');
  for (const [field, protocols] of [['livekitUrl', ['ws:', 'wss:']], ['llmBaseUrl', ['http:', 'https:']], ['sttBaseUrl', ['http:', 'https:']], ['qwenSttBaseUrl', ['http:', 'https:']]]) {
    if (config[field] && !protocols.includes(new URL(config[field]).protocol)) throw new Error(`Invalid ${field} protocol`);
  }
  if (env.NODE_ENV === 'production' && (config.livekitKey === 'devkey' || config.livekitSecret === 'secret')) {
    throw new Error('Production requires non-development LiveKit credentials');
  }
  if (!Number.isInteger(config.recordingUploadMaxMb) || config.recordingUploadMaxMb < 1 || config.recordingUploadMaxMb > 5000) throw new Error('RECORDING_UPLOAD_MAX_MB must be an integer from 1 to 5000');
  if (!Number.isInteger(config.recordingPollMs) || config.recordingPollMs < 1000 || config.recordingPollMs > 60000) throw new Error('RECORDING_POLL_MS must be 1000–60000 milliseconds');
  if (!Number.isInteger(config.recordingMaxProcessMin) || config.recordingMaxProcessMin < 1 || config.recordingMaxProcessMin > 1440) throw new Error('RECORDING_MAX_PROCESS_MIN must be an integer from 1 to 1440');
  if (config.recordingSttUrl && !['http:', 'https:'].includes(new URL(config.recordingSttUrl).protocol)) throw new Error('Invalid recordingSttUrl protocol');
  config.recordingLlmModels = [...new Set([config.llmModel, ...config.recordingLlmModels])];
  config.recordingSttModels = [...new Set([config.recordingSttModel, ...config.recordingSttModels].filter(Boolean))];
  for (const name of [...config.recordingLlmModels, ...config.recordingSttModels]) {
    if (!/^[\w.\-:/]{1,64}$/.test(name)) throw new Error(`Invalid model name in recording model list: ${name}`);
  }
  config.recordingLlmModels = [...new Set([config.llmModel, ...config.recordingLlmModels])];
  config.recordingSttModels = [...new Set([config.recordingSttModel, ...config.recordingSttModels].filter(Boolean))]
    .filter(name => name !== QWEN_STT_MODEL || config.qwenSttBaseUrl);
  if (config.qwenSttBaseUrl && !config.recordingSttModels.includes(QWEN_STT_MODEL)) config.recordingSttModels.push(QWEN_STT_MODEL);
  for (const name of [...config.recordingLlmModels, ...config.recordingSttModels]) {
    if (!/^[\w.\-:/]{1,64}$/.test(name)) throw new Error(`Invalid model name in recording model list: ${name}`);
  }
  config.recordingDiarizers = ['none', ...new Set(config.recordingDiarizers.filter(name => ['pyannote', 'nemotron'].includes(name)))];
  return config;
}
