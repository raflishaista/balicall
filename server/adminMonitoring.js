import { PYANNOTE_JSWOOK, QWEN_GGUF_MODEL, QWEN_STT_MODEL } from './config.js';
import { effectiveLlm, fetchJson } from './providers.js';
import { mingLiveCapabilities } from './mingLiveConfig.js';
import { qwenGgufLiveCapabilities } from './qwenGgufLiveConfig.js';
import { qwenGgufReady } from './qwenCapabilities.js';
import { qwenLiveCapabilities } from './qwenLiveConfig.js';
import { seaLiveCapabilities } from './seaLiveConfig.js';

export async function readLiveKitRooms(probe) {
  try {
    const rooms = await probe();
    return Array.isArray(rooms) ? rooms : null;
  } catch {
    return null;
  }
}

function durationBetween(start, end) {
  const seconds = start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 1000 : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
}

export function compileAdminMeetings({ history, schedules, snapshots, rooms, now = new Date() }) {
  const scheduled = new Map(schedules.map(schedule => [schedule.id, schedule]));
  const stored = new Map(history.map(meeting => [meeting.id, meeting]));
  const connectedRooms = new Map((rooms ?? []).map(room => [room.name, room.numParticipants]));
  const startedSchedules = new Set();
  const meetings = [];

  function addMeeting(record, snapshot) {
    const id = record?.id ?? snapshot.id;
    const schedule = scheduled.get(snapshot?.scheduleId);
    const attendees = snapshot ? [...snapshot.participants.values()].filter(person => person.joinedAt) : [];
    const liveCount = rooms ? connectedRooms.get(snapshot?.livekitRoom ?? `meeting-${id}`) ?? 0 : null;
    if (!record && !attendees.length && !liveCount) return;
    if (snapshot?.scheduleId) startedSchedules.add(snapshot.scheduleId);
    const startedAt = [record?.startedAt, ...attendees.map(person => person.joinedAt)]
      .filter(Boolean).reduce((first, value) => first && new Date(first) < new Date(value) ? first : value, null);
    const endedAt = snapshot?.endedAt ?? record?.endedAt ?? null;
    const ended = Boolean(endedAt || (snapshot?.status ?? record?.status) === 'ended');
    let status = 'waiting';
    if (ended) status = 'ended';
    else if (liveCount === null) status = 'unverified';
    else if (liveCount > 0) status = 'active';
    else if (startedAt) status = 'empty';
    const knownAttendees = Math.max(record?.attendeeCount ?? 0, attendees.length);
    const hostName = snapshot?.participants.get(snapshot.hostId)?.employeeName
      ?? (snapshot?.hostId === schedule?.hostId ? schedule?.hostName : null) ?? null;
    meetings.push({
      id,
      title: schedule?.title ?? snapshot?.roomName ?? record?.title ?? null,
      hostName,
      status,
      scheduledStart: schedule?.scheduledStart ?? snapshot?.scheduledStart ?? null,
      scheduledEnd: schedule?.scheduledEnd ?? snapshot?.scheduledEnd ?? null,
      createdAt: record?.createdAt ?? snapshot?.createdAt ?? null,
      startedAt, endedAt,
      participantCount: ended ? knownAttendees || null : liveCount,
      durationSeconds: durationBetween(startedAt, status === 'active' ? now : endedAt),
    });
  }

  for (const snapshot of snapshots) {
    addMeeting(stored.get(snapshot.id), snapshot);
    stored.delete(snapshot.id);
  }
  for (const record of stored.values()) addMeeting(record);
  for (const schedule of schedules) {
    if (startedSchedules.has(schedule.id)) continue;
    meetings.push({
      id: schedule.id, title: schedule.title, hostName: schedule.hostName ?? null,
      status: schedule.status === 'cancelled' ? 'cancelled'
        : new Date(schedule.scheduledEnd) < now ? 'expired' : 'scheduled',
      scheduledStart: schedule.scheduledStart, scheduledEnd: schedule.scheduledEnd,
      createdAt: null, startedAt: null, endedAt: null, participantCount: null,
      durationSeconds: durationBetween(schedule.scheduledStart, schedule.scheduledEnd),
    });
  }

  const priority = { active: 0, unverified: 1, waiting: 2, scheduled: 3, empty: 4, ended: 5, cancelled: 5, expired: 5 };
  const time = meeting => new Date(meeting.endedAt ?? meeting.startedAt ?? meeting.scheduledStart ?? meeting.createdAt ?? 0).getTime();
  meetings.sort((a, b) => priority[a.status] - priority[b.status]
    || (a.status === 'scheduled' ? time(a) - time(b) : time(b) - time(a)));
  return { meetings: meetings.slice(0, 100), livekitStatus: rooms ? 'reachable' : 'unavailable', checkedAt: now.toISOString() };
}

export function compileLiveMeetingMonitor({ snapshots = [], rooms, activeSessions = [], schedules = [], now = new Date() }) {
  const connectedRooms = new Map((rooms ?? []).map(room => [room.name, room.numParticipants]));
  const scheduled = new Map(schedules.map(schedule => [schedule.id, schedule]));
  const sessionsByMeeting = new Map();
  for (const session of activeSessions) {
    if (!sessionsByMeeting.has(session.meetingId)) {
      sessionsByMeeting.set(session.meetingId, []);
    }
    sessionsByMeeting.get(session.meetingId).push(session);
  }

  const liveMeetings = [];
  const activeHosts = new Set();
  let totalParticipants = 0;
  let totalDuration = 0;

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'active') continue;
    const liveCount = connectedRooms.get(snapshot.livekitRoom ?? `meeting-${snapshot.id}`) ?? 0;
    if (liveCount <= 0) continue;
    const attendees = [...snapshot.participants.values()].filter(p => !p.leftAt);
    
    const startedAt = snapshot.createdAt || (attendees.length ? attendees[0].joinedAt : null) || now.toISOString();
    const durationSeconds = durationBetween(startedAt, now) ?? 0;
    
    const schedule = scheduled.get(snapshot.scheduleId);
    const hostName = snapshot.participants.get(snapshot.hostId)?.employeeName
      ?? (snapshot.hostId === schedule?.hostId ? schedule?.hostName : null)
      ?? snapshot.hostId
      ?? '—';

    if (snapshot.hostId) {
      activeHosts.add(snapshot.hostId);
    }
    totalParticipants += liveCount;
    totalDuration += durationSeconds;

    const observerSessions = sessionsByMeeting.get(snapshot.id) || [];

    liveMeetings.push({
      id: snapshot.id,
      title: snapshot.roomName || schedule?.title || `Meeting ${snapshot.roomCode || snapshot.id}`,
      roomCode: snapshot.roomCode || null,
      hostId: snapshot.hostId || null,
      hostName,
      participantCount: liveCount,
      startedAt,
      durationSeconds,
      status: 'active',
      connectionHealth: rooms ? 'healthy' : 'unverified',
      isMonitored: Boolean(snapshot.isMonitored || observerSessions.length > 0),
      activeObserverCount: observerSessions.length,
      observerSessions,
    });
  }

  return {
    summary: {
      activeMeetings: liveMeetings.length,
      totalParticipants,
      activeHosts: activeHosts.size,
      averageDurationSeconds: liveMeetings.length ? Math.floor(totalDuration / liveMeetings.length) : 0,
      totalDurationSeconds: totalDuration,
      meetingStatus: liveMeetings.length > 0 ? 'Aktif' : 'Standby',
      connectionHealth: rooms ? 'healthy' : 'unavailable',
    },
    meetings: liveMeetings,
    checkedAt: now.toISOString(),
  };
}

async function workerHealth(url, key, fetchImpl) {
  if (!url) return null;
  try {
    return await fetchJson(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }, 1500, fetchImpl);
  } catch {
    return null;
  }
}

function whisperLiveHealthUrl(config) {
  if (!config.liveSttUrl || !config.liveSttSecret) return '';
  if (config.liveSttHealthUrl) return config.liveSttHealthUrl;
  if (config.liveSttUrl.startsWith('/') && !config.liveSttUrl.startsWith('//')) {
    return 'http://127.0.0.1:8003/health';
  }
  try {
    const url = new URL('/health', config.liveSttUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    else return '';
    return url.href;
  } catch {
    return '';
  }
}

export async function readAdminSystem({ config, fetchImpl, probe, databaseReady, databaseVersion, recordingCapabilities, postMeetingBatch }) {
  const qwenConfigured = Boolean(config.qwenLiveSttUrl && config.qwenLiveSttSecret);
  const seaConfigured = Boolean(config.seaLivePilotEnabled && config.seaLiveSttUrl && config.seaLiveSttSecret);
  const q8LiveConfigured = Boolean(config.qwenGgufLiveUrl && config.qwenGgufLiveSecret);
  const mingConfigured = Boolean(config.mingLiveSttUrl && config.mingLiveSttSecret);
  const llmProvider = effectiveLlm(config);
  const llmModel = llmProvider === 'office' ? config.llmModel : llmProvider === 'gemini' ? 'gemini-2.5-flash' : null;
  const llmConfigured = llmProvider !== 'demo';
  const whisperLiveConfigured = Boolean(config.liveSttUrl && config.liveSttSecret);
  const whisperHealthUrl = whisperLiveHealthUrl(config);
  const selectedQwen = config.sttModel === QWEN_STT_MODEL;
  const selectedQ8 = config.sttModel === QWEN_GGUF_MODEL;
  const sttUrl = !selectedQ8 && config.sttModel && (selectedQwen ? config.qwenSttBaseUrl : config.sttBaseUrl);

  const dbStart = Date.now();
  const databasePromise = Promise.resolve(databaseReady()).then(
    connected => ({ connected, latencyMs: Math.max(1, Date.now() - dbStart) }),
    () => ({ connected: false, latencyMs: Math.max(1, Date.now() - dbStart) }),
  );

  const dbVersionPromise = Promise.resolve(typeof databaseVersion === 'function' ? databaseVersion() : null).catch(() => null);

  const lkStart = Date.now();
  const roomsPromise = readLiveKitRooms(probe).then(
    rooms => ({ rooms, latencyMs: Math.max(1, Date.now() - lkStart) }),
    () => ({ rooms: null, latencyMs: Math.max(1, Date.now() - lkStart) }),
  );

  const [
    { rooms, latencyMs: livekitLatencyMs },
    { connected: databaseConnected, latencyMs: dbLatencyMs },
    dbVersion,
    recordingModels, qwen, sea, q8Live, ming, whisper, stt, q8Chunk, qwenBatch,
  ] = await Promise.all([
    roomsPromise, databasePromise, dbVersionPromise, recordingCapabilities(),
    qwenLiveCapabilities(config, fetchImpl),
    seaConfigured ? seaLiveCapabilities(config, fetchImpl) : null,
    qwenGgufLiveCapabilities(config, fetchImpl), mingLiveCapabilities(config, fetchImpl),
    workerHealth(whisperHealthUrl, '', fetchImpl),
    workerHealth(sttUrl && new URL('/health', sttUrl).href, selectedQwen ? config.qwenSttKey : config.sttKey, fetchImpl),
    qwenGgufReady(config, fetchImpl), postMeetingBatch.configured && postMeetingBatch.workerReady(),
  ]);

  const checkedAtIso = new Date().toISOString();
  const row = (id, label, group, configured, ready, extra = {}) => ({
    id, label, group,
    status: !configured ? 'not_configured' : ready === null ? 'unverified' : ready ? 'ready' : 'unavailable',
    configured: Boolean(configured),
    lastChecked: checkedAtIso,
    ...extra,
  });
  const recordingDiarizers = [...recordingModels.values()].flat();
  const normalUploadModels = config.recordingSttModels.filter(model => !['sea', QWEN_STT_MODEL, QWEN_GGUF_MODEL].includes(model));
  const sttReady = stt?.ready !== false && (stt?.model === config.sttModel || (Array.isArray(stt?.models) && stt.models.includes(config.sttModel)));
  const services = [
    row('api', 'API BaliCall', 'core', true, true, {
      subgroup: 'infrastructure', processingMode: 'daemon', latencyMs: null,
      version: process.env.APP_VERSION || process.env.npm_package_version || null,
      connectionState: 'Terjangkau dari permintaan monitor',
      healthStatus: 'Endpoint admin berhasil merespons',
      diagnostic: 'Status berasal dari respons endpoint monitor ini.',
    }),
    row('livekit', 'LiveKit', 'core', true, Boolean(rooms), {
      subgroup: 'infrastructure', processingMode: 'streaming', latencyMs: livekitLatencyMs,
      version: 'LiveKit SFU',
      connectionState: rooms ? 'Terhubung' : 'Terputus',
      healthStatus: rooms ? 'Probe SFU Berhasil' : 'Probe Gagal',
      diagnostic: rooms ? `SFU terhubung (${rooms.length} room aktif)` : 'LiveKit SFU tidak dapat dijangkau.',
    }),
    row('database', 'PostgreSQL', 'core', true, databaseConnected, {
      subgroup: 'infrastructure', processingMode: 'daemon', latencyMs: dbLatencyMs,
      version: dbVersion || 'PostgreSQL',
      connectionState: databaseConnected ? 'Koneksi Pool Stabil' : 'Koneksi Terputus',
      healthStatus: databaseConnected ? 'Query SELECT 1 OK' : 'Koneksi Basis Data Gagal',
      diagnostic: databaseConnected ? 'Koneksi basis data stabil.' : 'Basis data PostgreSQL tidak terhubung.',
    }),
    row('summary-llm', 'Model ringkasan rapat', 'llm', llmConfigured, null, {
      subgroup: 'post_meeting', processingMode: 'batch', provider: llmProvider, model: llmModel,
      diagnostic: llmConfigured
        ? 'Penyedia dan model terkonfigurasi; konektivitas belum diuji oleh monitor.'
        : 'Mode demo aktif; ringkasan bukan hasil model LLM.',
    }),
    row('meeting-stt', 'Transkripsi potongan rapat', 'transcription', Boolean(sttUrl), sttReady, {
      subgroup: 'post_meeting', processingMode: 'chunk',
      diagnostic: sttReady ? 'Worker potongan rapat siap.' : !sttUrl ? 'URL endpoint belum diatur.' : 'Worker potongan rapat offline.',
    }),
    row('whisper-live', 'WhisperLiveKit', 'transcription', whisperLiveConfigured,
      whisperHealthUrl ? whisper?.status === 'ok' && whisper?.streaming === true && whisper?.model === 'whisperlivekit-small' : null, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: whisper?.status === 'ok' ? 'Streaming transkripsi live aktif.' : !whisperLiveConfigured ? 'Kredensial WhisperLiveKit belum diatur.' : 'Worker WhisperLiveKit offline.',
    }),
    row('qwen-live', 'Qwen Live', 'transcription', qwenConfigured, qwen.ready, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: qwen.ready ? 'Qwen Live ASR siap.' : !qwenConfigured ? 'URL/kunci Qwen Live belum diatur.' : 'Worker Qwen Live offline.',
    }),
    row('sea-live', 'SEA-ASR-ID Live', 'transcription', seaConfigured, sea?.ready, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: sea?.ready ? 'SEA-ASR-ID Live siap.' : !seaConfigured ? 'Pilot SEA-ASR-ID belum diaktifkan.' : 'Worker SEA-ASR-ID offline.',
    }),
    row('qwen-q8-chunk', 'Qwen Q8 untuk potongan rapat', 'transcription', Boolean(config.qwenGgufSttBaseUrl), q8Chunk, {
      subgroup: 'post_meeting', processingMode: 'chunk',
      diagnostic: q8Chunk ? 'Qwen GGUF Chunk siap.' : !config.qwenGgufSttBaseUrl ? 'Endpoint Qwen GGUF belum diatur.' : 'Worker Qwen GGUF offline.',
    }),
    row('qwen-q8-live', 'Qwen Q8 Live', 'transcription', q8LiveConfigured, q8Live.ready, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: q8Live.ready ? 'Qwen Q8 Live siap.' : !q8LiveConfigured ? 'Konfigurasi Qwen Q8 Live belum diatur.' : 'Worker Qwen Q8 Live offline.',
    }),
    row('ming-live', 'Ming Live', 'transcription', mingConfigured, ming.ready, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: ming.ready ? 'Ming Live STT siap.' : !mingConfigured ? 'Konfigurasi Ming Live belum diatur.' : 'Worker Ming Live offline.',
    }),
    row('recording-stt', 'Whisper untuk unggahan', 'transcription', Boolean(config.recordingSttUrl && normalUploadModels.length),
      normalUploadModels.some(model => recordingModels.has(model)), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: normalUploadModels.some(model => recordingModels.has(model)) ? 'Mesin Whisper unggahan siap.' : 'Worker STT unggahan belum siap.',
    }),
    row('recording-sea', 'SEA-ASR-ID untuk unggahan', 'transcription', Boolean(config.recordingSttUrl && config.recordingSttModels.includes('sea')),
      recordingModels.has('sea'), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingModels.has('sea') ? 'Model SEA unggahan tersedia.' : 'Model SEA tidak ditemukan di worker.',
    }),
    row('recording-qwen', 'Qwen untuk unggahan', 'transcription', Boolean(config.qwenSttBaseUrl), recordingModels.has(QWEN_STT_MODEL), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingModels.has(QWEN_STT_MODEL) ? 'Model Qwen unggahan tersedia.' : 'Model Qwen tidak ditemukan di worker.',
    }),
    row('recording-q8', 'Qwen Q8 untuk unggahan', 'transcription', Boolean(config.qwenQ8BatchUrl), recordingModels.has(QWEN_GGUF_MODEL), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingModels.has(QWEN_GGUF_MODEL) ? 'Model Qwen Q8 batch tersedia.' : 'Worker batch Q8 belum siap.',
    }),
    row('post-meeting-qwen', 'Qwen + Nemotron pasca-rapat', 'transcription', postMeetingBatch.configured, qwenBatch, {
      subgroup: 'post_meeting', processingMode: 'batch',
      diagnostic: qwenBatch ? 'Batch pipeline pasca-rapat siap.' : !postMeetingBatch.configured ? 'Pipeline pasca-rapat belum dikonfigurasi.' : 'Worker batch pasca-rapat offline.',
    }),
    row('live-diarization', 'Pemisah pembicara live', 'diarization', qwenConfigured || seaConfigured || q8LiveConfigured,
      qwen.diarization || sea?.diarization || q8Live.diarization, {
      subgroup: 'live', processingMode: 'streaming',
      diagnostic: (qwen.diarization || sea?.diarization || q8Live.diarization) ? 'Diarisasi live aktif pada streaming.' : 'Diarisasi live belum siap pada model aktif.',
    }),
    row('recording-nemotron', 'Nemotron-3 untuk unggahan', 'diarization',
      Boolean(config.qwenQ8BatchUrl || config.recordingDiarizers.includes('nemotron') && (config.recordingSttUrl || config.qwenSttBaseUrl)),
      recordingDiarizers.includes('nemotron'), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingDiarizers.includes('nemotron') ? 'Nemotron-3 diarizer tersedia.' : 'Diarizer Nemotron-3 belum terhubung.',
    }),
    row('recording-pyannote', 'Pyannote JSWOOK untuk unggahan', 'diarization', Boolean(config.recordingPyannoteUrl),
      recordingDiarizers.includes(PYANNOTE_JSWOOK), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingDiarizers.includes(PYANNOTE_JSWOOK) ? 'Pyannote JSWOOK siap.' : !config.recordingPyannoteUrl ? 'URL Pyannote belum diatur.' : 'Worker Pyannote offline.',
    }),
    row('recording-pyannote-community', 'Pyannote untuk unggahan', 'diarization',
      Boolean(config.recordingSttUrl && config.recordingDiarizers.includes('pyannote')), recordingDiarizers.includes('pyannote'), {
      subgroup: 'upload', processingMode: 'batch',
      diagnostic: recordingDiarizers.includes('pyannote') ? 'Pyannote Community siap.' : 'Pyannote belum tersedia di worker STT.',
    }),
    row('post-meeting-diarization', 'Nemotron-3 pasca-rapat', 'diarization', postMeetingBatch.configured, qwenBatch, {
      subgroup: 'post_meeting', processingMode: 'batch',
      diagnostic: qwenBatch ? 'Diarisasi Nemotron pasca-rapat siap.' : !postMeetingBatch.configured ? 'Pipeline pasca-rapat belum dikonfigurasi.' : 'Worker batch pasca-rapat offline.',
    }),
  ];
  return {
    api: 'reachable',
    livekit: rooms ? 'reachable' : 'unavailable',
    databaseConnected,
    checkedAt: checkedAtIso,
    services,
    summary: {
      total: services.length,
      ready: services.filter(s => s.status === 'ready').length,
      unavailable: services.filter(s => s.status === 'unavailable').length,
      notConfigured: services.filter(s => s.status === 'not_configured').length,
      unverified: services.filter(s => s.status === 'unverified').length,
    },
    latency: {
      databaseMs: dbLatencyMs,
      livekitMs: livekitLatencyMs,
    },
  };
}
