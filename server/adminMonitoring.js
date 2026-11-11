import { PYANNOTE_JSWOOK, QWEN_GGUF_MODEL, QWEN_STT_MODEL } from './config.js';
import { fetchJson } from './providers.js';
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
    const knownAttendees = Math.max(record?.attendeeCount ?? 0, attendees.length);
    const hostName = snapshot?.participants.get(snapshot.hostId)?.employeeName
      ?? (snapshot?.hostId === schedule?.hostId ? schedule?.hostName : null) ?? null;
    meetings.push({
      id,
      title: schedule?.title ?? snapshot?.roomName ?? record?.title ?? null,
      hostName,
      status: ended ? 'ended' : startedAt || liveCount ? 'active' : 'waiting',
      scheduledStart: schedule?.scheduledStart ?? snapshot?.scheduledStart ?? null,
      scheduledEnd: schedule?.scheduledEnd ?? snapshot?.scheduledEnd ?? null,
      createdAt: record?.createdAt ?? snapshot?.createdAt ?? null,
      startedAt, endedAt,
      participantCount: ended ? knownAttendees || null : liveCount,
      durationSeconds: durationBetween(startedAt, ended ? endedAt : now),
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

  const priority = { active: 0, waiting: 1, scheduled: 2, ended: 3, cancelled: 3, expired: 3 };
  const time = meeting => new Date(meeting.endedAt ?? meeting.startedAt ?? meeting.scheduledStart ?? meeting.createdAt ?? 0).getTime();
  meetings.sort((a, b) => priority[a.status] - priority[b.status]
    || (a.status === 'scheduled' ? time(a) - time(b) : time(b) - time(a)));
  return { meetings: meetings.slice(0, 100), livekitStatus: rooms ? 'reachable' : 'unavailable', checkedAt: now.toISOString() };
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

export async function readAdminSystem({ config, fetchImpl, probe, databaseReady, recordingCapabilities, postMeetingBatch }) {
  const qwenConfigured = Boolean(config.qwenLiveSttUrl && config.qwenLiveSttSecret);
  const seaConfigured = Boolean(config.seaLivePilotEnabled && config.seaLiveSttUrl && config.seaLiveSttSecret);
  const q8LiveConfigured = Boolean(config.qwenGgufLiveUrl && config.qwenGgufLiveSecret);
  const mingConfigured = Boolean(config.mingLiveSttUrl && config.mingLiveSttSecret);
  const whisperLiveConfigured = Boolean(config.liveSttUrl && config.liveSttSecret);
  const whisperHealthUrl = whisperLiveHealthUrl(config);
  const selectedQwen = config.sttModel === QWEN_STT_MODEL;
  const selectedQ8 = config.sttModel === QWEN_GGUF_MODEL;
  const sttUrl = !selectedQ8 && config.sttModel && (selectedQwen ? config.qwenSttBaseUrl : config.sttBaseUrl);
  const [
    rooms, databaseConnected, recordingModels, qwen, sea, q8Live, ming, whisper, stt, q8Chunk, qwenBatch,
  ] = await Promise.all([
    readLiveKitRooms(probe), databaseReady(), recordingCapabilities(),
    qwenLiveCapabilities(config, fetchImpl),
    seaConfigured ? seaLiveCapabilities(config, fetchImpl) : null,
    qwenGgufLiveCapabilities(config, fetchImpl), mingLiveCapabilities(config, fetchImpl),
    workerHealth(whisperHealthUrl, '', fetchImpl),
    workerHealth(sttUrl && new URL('/health', sttUrl).href, selectedQwen ? config.qwenSttKey : config.sttKey, fetchImpl),
    qwenGgufReady(config, fetchImpl), postMeetingBatch.configured && postMeetingBatch.workerReady(),
  ]);
  const row = (id, label, group, configured, ready) => ({
    id, label, group,
    status: !configured ? 'not_configured' : ready === null ? 'unverified' : ready ? 'ready' : 'unavailable',
  });
  const recordingDiarizers = [...recordingModels.values()].flat();
  const normalUploadModels = config.recordingSttModels.filter(model => !['sea', QWEN_STT_MODEL, QWEN_GGUF_MODEL].includes(model));
  const sttReady = stt?.ready !== false && (stt?.model === config.sttModel || (Array.isArray(stt?.models) && stt.models.includes(config.sttModel)));
  const services = [
    row('api', 'API BaliCall', 'core', true, true),
    row('livekit', 'LiveKit', 'core', true, Boolean(rooms)),
    row('database', 'PostgreSQL', 'core', true, databaseConnected),
    row('meeting-stt', 'Transkripsi potongan rapat', 'transcription', Boolean(sttUrl), sttReady),
    row('whisper-live', 'WhisperLiveKit', 'transcription', whisperLiveConfigured,
      whisperHealthUrl ? whisper?.status === 'ok' && whisper?.streaming === true && whisper?.model === 'whisperlivekit-small' : null),
    row('qwen-live', 'Qwen Live', 'transcription', qwenConfigured, qwen.ready),
    row('sea-live', 'SEA-ASR-ID Live', 'transcription', seaConfigured, sea?.ready),
    row('qwen-q8-chunk', 'Qwen Q8 untuk potongan rapat', 'transcription', Boolean(config.qwenGgufSttBaseUrl), q8Chunk),
    row('qwen-q8-live', 'Qwen Q8 Live', 'transcription', q8LiveConfigured, q8Live.ready),
    row('ming-live', 'Ming Live', 'transcription', mingConfigured, ming.ready),
    row('recording-stt', 'Whisper untuk unggahan', 'transcription', Boolean(config.recordingSttUrl && normalUploadModels.length),
      normalUploadModels.some(model => recordingModels.has(model))),
    row('recording-sea', 'SEA-ASR-ID untuk unggahan', 'transcription', Boolean(config.recordingSttUrl && config.recordingSttModels.includes('sea')),
      recordingModels.has('sea')),
    row('recording-qwen', 'Qwen untuk unggahan', 'transcription', Boolean(config.qwenSttBaseUrl), recordingModels.has(QWEN_STT_MODEL)),
    row('recording-q8', 'Qwen Q8 untuk unggahan', 'transcription', Boolean(config.qwenQ8BatchUrl), recordingModels.has(QWEN_GGUF_MODEL)),
    row('post-meeting-qwen', 'Qwen + Nemotron pasca-rapat', 'transcription', postMeetingBatch.configured, qwenBatch),
    row('live-diarization', 'Pemisah pembicara live', 'diarization', qwenConfigured || seaConfigured || q8LiveConfigured,
      qwen.diarization || sea?.diarization || q8Live.diarization),
    row('recording-nemotron', 'Nemotron-3 untuk unggahan', 'diarization',
      Boolean(config.qwenQ8BatchUrl || config.recordingDiarizers.includes('nemotron') && (config.recordingSttUrl || config.qwenSttBaseUrl)),
      recordingDiarizers.includes('nemotron')),
    row('recording-pyannote', 'Pyannote JSWOOK untuk unggahan', 'diarization', Boolean(config.recordingPyannoteUrl),
      recordingDiarizers.includes(PYANNOTE_JSWOOK)),
    row('recording-pyannote-community', 'Pyannote untuk unggahan', 'diarization',
      Boolean(config.recordingSttUrl && config.recordingDiarizers.includes('pyannote')), recordingDiarizers.includes('pyannote')),
  ];
  return { api: 'reachable', livekit: rooms ? 'reachable' : 'unavailable', databaseConnected, checkedAt: new Date().toISOString(), services };
}
