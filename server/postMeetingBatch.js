import { openAsBlob } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ServiceError, fetchJson } from './providers.js';

const MODEL = 'qwen3-asr-0.6b';
const pending = new Set(['queued', 'transcribing', 'summarizing']);

// The source is always a server-owned, completed room-composite Egress file.
// Never accept client paths/URLs or concatenate independent microphone clips.
export function createPostMeetingBatch({ config, store, egress, fetchImpl = fetch, summarize, persist = async () => {} }) {
  const running = new Map();
  const admitting = new Map();
  const scheduled = new Map();
  const abort = new AbortController();
  const batchFetch = (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.any([options.signal, abort.signal].filter(Boolean)) });
  const configured = Boolean(config.qwenBatchEnabled && config.qwenBatchRecordingsDir && config.qwenSttBaseUrl);
  async function workerReady() {
    if (!config.qwenBatchEnabled || !config.qwenSttBaseUrl) return false;
    try {
      const url = new URL(config.qwenSttBaseUrl); url.pathname = '/health'; url.search = '';
      const data = await fetchJson(url.href, { headers: config.qwenSttKey ? { Authorization: `Bearer ${config.qwenSttKey}` } : {} }, 1500, batchFetch);
      return data.ready === true && data.model === MODEL && data.batchDiarization === true;
    } catch { return false; }
  }
  function update(id, patch) {
    store.transact(() => Object.assign(store.get(id).postMeetingBatch, patch, { updatedAt: new Date().toISOString() }));
  }
  async function recordingFile(meeting) {
    const base = await realpath(resolve(config.qwenBatchRecordingsDir));
    const file = await realpath(resolve(base, `${meeting.livekitRoom}.${meeting.recording?.audioOnly ? 'ogg' : 'mp4'}`));
    const rel = relative(base, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ServiceError('Lokasi rekaman tidak diizinkan.', 400);
    const info = await stat(file);
    if (!info.isFile() || !info.size || info.size > config.recordingUploadMaxMb * 1024 * 1024) throw new ServiceError('Ukuran rekaman tidak valid untuk batch.', 413);
    return file;
  }
  async function process(id) {
    try {
      const meeting = store.get(id), job = meeting.postMeetingBatch;
      const headers = config.qwenSttKey ? { Authorization: `Bearer ${config.qwenSttKey}` } : {};
      const base = config.qwenSttBaseUrl.replace(/\/+$/, '');
      if (!job.workerJobId && !job.transcripts) {
        const form = new FormData();
        const audioOnly = meeting.recording?.audioOnly === true;
        form.append('file', await openAsBlob(await recordingFile(meeting), { type: audioOnly ? 'audio/ogg' : 'video/mp4' }), audioOnly ? 'meeting.ogg' : 'meeting.mp4');
        form.append('model', MODEL); form.append('language', job.language);
        form.append('diarize', 'true'); form.append('diarizer', 'nemotron');
        const result = await fetchJson(`${base}/audio/transcriptions/jobs`, {
          method: 'POST', headers, body: form,
          signal: abort.signal,
        }, 600000, batchFetch);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(result?.job_id || '')) throw new ServiceError('Worker tidak mengembalikan ID batch yang valid.');
        update(id, { workerJobId: result.job_id, status: 'transcribing' });
      }
      while (!job.transcripts) {
        if (abort.signal.aborted) return;
        if (Date.now() > Date.parse(job.deadline)) throw new ServiceError('Batch melewati batas waktu. Rekaman dan transkrip live tetap tersedia.', 504);
        await delay(config.recordingPollMs, undefined, { signal: abort.signal });
        const result = await fetchJson(`${base}/audio/transcriptions/jobs/${job.workerJobId}`, { headers, signal: abort.signal }, 15000, batchFetch);
        if (result.status === 'failed') throw new ServiceError('Worker gagal memproses batch. Periksa log worker; transkrip live tetap tersedia.');
        if (result.status !== 'done') continue;
        const data = result.result;
        if (data?.model !== MODEL || data?.diarizer !== 'nemotron' || data?.speaker_scope !== 'recording' || !Number.isFinite(data.duration) || data.duration <= 0 || !Array.isArray(data.segments) || !data.segments.length || data.segments.length > 100000) throw new ServiceError('Worker tidak membuktikan hasil Qwen + Nemotron untuk satu rekaman lengkap.');
        let previous = 0;
        const transcripts = data.segments.map((s, index) => {
          if (!s || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 20000 || typeof s.speaker !== 'string' || !s.speaker.trim() || s.speaker.length > 100 || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < previous || s.end <= s.start || s.end > data.duration + 0.01) throw new ServiceError('Segmen batch tidak valid.');
          previous = s.end;
          const overlap = s.overlap === true;
          const segment = { text: s.text.trim(), speaker: overlap ? 'Bertumpuk' : s.speaker, start: s.start, end: s.end, sessionId: job.id, attribution: overlap ? 'overlap' : s.speaker === 'Belum diketahui' ? 'unknown' : 'assigned' };
          return { id: `${job.id}-${index}`, speakerId: 'recording', speakerName: 'Rekaman rapat', text: segment.text,
            timestamp: new Date(Date.parse(meeting.recording.startedAt) + s.start * 1000).toISOString(),
            sttModel: 'qwen3-asr-0.6b-batch', segments: [segment] };
        });
        update(id, { transcripts, duration: data.duration, status: 'summarizing' });
      }
      if (abort.signal.aborted) return;
      const summary = job.summary || { ...await summarize({ ...meeting, transcripts: job.transcripts }), generatedAt: new Date().toISOString(), transcriptCount: job.transcripts.length, transcriptSource: 'qwen-post-meeting' };
      update(id, { summary, status: 'summarizing' });
      await persist(meeting, { ...job, status: 'done' });
      update(id, { status: 'done', error: null });
    } catch (error) {
      if (!abort.signal.aborted) update(id, { status: 'failed', error: error instanceof ServiceError ? error.message : 'Batch belum berhasil. Transkrip live dan rekaman tetap tersedia untuk dicoba ulang.' });
    } finally { running.delete(id); }
  }
  function enqueue(id) {
    if (running.has(id)) return;
    const task = process(id); running.set(id, task);
  }
  async function startInternal(id, language) {
    if (!configured) throw new ServiceError('Batch Qwen belum dikonfigurasi. Pengelola perlu menyiapkan worker Qwen + Nemotron dan folder rekaman Egress.', 503);
    const meeting = store.get(id);
    if (!['id', 'en'].includes(language)) throw new ServiceError('Bahasa batch harus id atau en.', 400);
    if (meeting.status !== 'ended') throw new ServiceError('Tunggu seluruh peserta meninggalkan rapat sebelum memproses batch.', 409);
    if (meeting.postMeetingBatch?.status === 'done' || pending.has(meeting.postMeetingBatch?.status)) return meeting.postMeetingBatch;
    if (running.size) throw new ServiceError('Worker batch sedang digunakan rapat lain. Coba kembali setelah selesai.', 429);
    if (!meeting.recording?.egressId) throw new ServiceError('Tidak ada rekaman lengkap. Mulai Rekam sejak awal rapat; potongan STT live tidak dapat dipakai sebagai rekaman seluruh peserta.', 409);
    if ((meeting.recordingRuns || 1) > 1) throw new ServiceError('Rekaman rapat terpecah menjadi beberapa sesi. Batch memerlukan satu rekaman utuh dari awal hingga akhir.', 409);
    if (meeting.recording.stoppedAt && Date.parse(meeting.endedAt) - Date.parse(meeting.recording.stoppedAt) > 3000) throw new ServiceError('Rekaman dihentikan sebelum rapat berakhir. Batch seluruh peserta memerlukan rekaman hingga akhir rapat.', 409);
    const infos = await egress.listEgress({ egressId: meeting.recording.egressId });
    const info = infos.find(item => item.egressId === meeting.recording.egressId && item.roomName === meeting.livekitRoom);
    // LiveKit EGRESS_COMPLETE = 3; stopEgress acknowledgement alone is insufficient.
    if (info && [4, 5, 6].includes(info.status)) throw new ServiceError('Rekaman Egress gagal, dibatalkan, atau mencapai batas. Periksa layanan Egress sebelum merekam rapat baru.', 422);
    if (!info || info.status !== 3) throw new ServiceError('Rekaman Egress belum selesai. Tunggu file selesai ditulis lalu coba lagi.', 409);
    await recordingFile(meeting);
    if (!await workerReady()) throw new ServiceError('Worker Qwen + Nemotron batch belum siap.', 503);
    store.transact(() => { meeting.postMeetingBatch = { id: randomUUID(), status: 'queued', language,
      source: 'livekit-room-composite', egressId: meeting.recording.egressId,
      recordedFrom: meeting.recording.startedAt, recordedUntil: meeting.recording.stoppedAt,
      startedAt: new Date().toISOString(), deadline: new Date(Date.now() + config.recordingMaxProcessMin * 60000).toISOString(), error: null }; });
    enqueue(id);
    return meeting.postMeetingBatch;
  }
  async function start(id, language = 'id') {
    if (admitting.has(id)) return admitting.get(id);
    if (admitting.size) throw new ServiceError('Batch sedang disiapkan untuk rapat lain.', 429);
    const task = startInternal(id, language); admitting.set(id, task);
    try { return await task; } finally { admitting.delete(id); }
  }
  function schedule(id) {
    const meeting = store.get(id);
    if (!configured || abort.signal.aborted || scheduled.has(id) || !meeting?.postMeetingBatchRequested || meeting.status !== 'ended' || meeting.postMeetingBatch) return;
    const deadline = Date.now() + 10 * 60000;
    const retry = async () => {
      try {
        await start(id, meeting.postMeetingBatchRequested.language);
        scheduled.delete(id);
      } catch (error) {
        if (abort.signal.aborted) return;
        if (Date.now() < deadline && [409, 429, 502, 503].includes(error.status)) {
          const timer = setTimeout(retry, config.recordingPollMs); timer.unref?.(); scheduled.set(id, timer);
        } else {
          store.transact(() => { meeting.postMeetingBatch = { id: randomUUID(), status: 'failed', error: error instanceof ServiceError ? error.message : 'Batch otomatis belum dapat dimulai. Periksa rekaman dan kesiapan worker, lalu coba Batch Qwen kembali.' }; });
          scheduled.delete(id);
        }
      }
    };
    const timer = setTimeout(retry, config.recordingPollMs); timer.unref?.(); scheduled.set(id, timer);
  }
  // Resume known worker jobs; never silently resubmit an interrupted upload.
  if (configured) for (const meeting of store.meetings.values()) {
    const job = meeting.postMeetingBatch;
    if (!pending.has(job?.status)) { schedule(meeting.id); continue; }
    if (job.workerJobId || job.transcripts) enqueue(meeting.id);
    else update(meeting.id, { status: 'failed', error: 'Backend berhenti saat unggahan batch. Coba kembali menggunakan rekaman yang tersimpan.' });
  }
  return { configured, workerReady, start, schedule, close() { abort.abort(); for (const timer of scheduled.values()) clearTimeout(timer); scheduled.clear(); } };
}

export function publicBatch(job) {
  if (!job) return null;
  const { id, status, language, source, recordedFrom, recordedUntil, startedAt, updatedAt, error, duration, transcripts, summary } = job;
  return { id, status, language, source, recordedFrom, recordedUntil, startedAt, updatedAt, error, duration,
    ...(status === 'done' ? { transcripts, summary } : {}) };
}
