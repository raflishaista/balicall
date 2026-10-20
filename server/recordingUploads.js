import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchJson, ServiceError, summarize } from './providers.js';
import { QWEN_STT_MODEL } from './config.js';
import * as uploads from './recordingStore.js';

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

async function looksLikeMp4(path) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return bytesRead >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp';
  } finally {
    await handle.close();
  }
}

async function workerError(response) {
  const body = await response.json().catch(() => null);
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  return new ServiceError(detail ? `Worker STT: ${detail}` : `Worker STT mengembalikan HTTP ${response.status}`, 502);
}

export function attachRecordingUploads(app, config, { fetchImpl = fetch } = {}) {
  const sttReady = Boolean(config.recordingSttUrl && config.recordingSttModel);

  // One job at a time: the STT worker serializes inference anyway.
  let tail = Promise.resolve();
  const enqueue = job => { tail = tail.then(job).catch(() => {}); };

  const describe = error => error instanceof ServiceError
    ? error.message
    : 'Pemrosesan gagal. Periksa log server.';
  const fail = (id, error) => {
    console.error('[RECORDING] Processing failed:', { id, message: error.message });
    return uploads.updateUpload(id, { status: 'failed', stage: null, error: describe(error) })
      .catch(dbError => console.error('[RECORDING] Could not record failure:', dbError.message));
  };

  // ---- Upload handling -----------------------------------------------------
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => mkdir(config.recordingUploadDir, { recursive: true })
        .then(() => cb(null, config.recordingUploadDir), cb),
      filename: (_req, _file, cb) => cb(null, `${randomUUID()}.mp4`),
    }),
    limits: { fileSize: config.recordingUploadMaxMb * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => /\.mp4$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new ServiceError('Hanya file .mp4 yang didukung.', 415)),
  });

  const receive = (req, res, next) => upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      error.status = tooLarge ? 413 : 400;
      error.message = tooLarge ? `Ukuran file melebihi batas ${config.recordingUploadMaxMb} MB.` : 'Upload tidak valid.';
    }
    next(error);
  });

  // Runs before multer so rejected requests never write a file to disk.
  function requireActor(req, res, next) {
    if (!config.authEnabled) { req.recordingActor = { id: null, name: null }; return next(); }
    const user = req.auth?.user;
    if (!user) return res.status(401).json({ error: 'Masuk terlebih dahulu.' });
    if (user.isGuest) return res.status(403).json({ error: 'Tamu tidak dapat menggunakan fitur rekaman.' });
    req.recordingActor = { id: user.employeeId, name: user.name };
    next();
  }

  function requireReady(_req, res, next) {
    if (!sttReady) return res.status(503).json({ error: 'Transkripsi rekaman belum dikonfigurasi (RECORDING_STT_URL dan RECORDING_STT_MODEL).' });
    next();
  }

  async function findOwned(req, res) {
    const row = await uploads.getUploadRow(req.params.id);
    if (!row || (req.recordingActor.id && row.owner_id !== req.recordingActor.id)) {
      res.status(404).json({ error: 'Rekaman tidak ditemukan.' });
      return null;
    }
    return row;
  }

  // ---- Processing ----------------------------------------------------------
  function normalizeResult(result) {
    if (!result || typeof result.text !== 'string') throw new ServiceError('Worker mengembalikan hasil yang tidak valid.');
    const segments = Array.isArray(result.segments)
      ? result.segments.map(segment => ({
          text: String(segment?.text ?? '').trim(),
          speaker: String(segment?.speaker ?? '').slice(0, 100),
          start: Number(segment?.start),
          end: Number(segment?.end),
        })).filter(segment => segment.text && segment.speaker && Number.isFinite(segment.start) && Number.isFinite(segment.end))
      : [];
    return { text: result.text.trim(), segments, durationSeconds: Number.isFinite(result.duration) ? result.duration : null };
  }

  async function transcribeFile(row) {
    const isQwen = row.stt_model === QWEN_STT_MODEL;
    const base = (isQwen ? config.qwenSttBaseUrl : config.recordingSttUrl).replace(/\/+$/, '');
    const sttKey = isQwen ? config.qwenSttKey : config.recordingSttKey;
    const headers = sttKey ? { Authorization: `Bearer ${sttKey}` } : {};
    const form = new FormData();
    // File-backed Blob: streams from disk instead of loading the whole recording into RAM.
    form.append('file', await openAsBlob(row.file_path, { type: 'video/mp4' }), 'recording.mp4');
    form.append('model', config.recordingSttModel);
    form.append('model', row.stt_model || config.recordingSttModel);
    form.append('language', row.language);
    const useDiarizer = !isQwen && row.diarizer && row.diarizer !== 'none';
    form.append('diarize', String(Boolean(useDiarizer)));
    if (useDiarizer) form.append('diarizer', row.diarizer);
    const submitResponse = await fetchImpl(`${base}/audio/transcriptions/jobs`,
      { method: 'POST', headers, body: form, signal: AbortSignal.timeout(10 * 60 * 1000) })
      .catch(() => { throw new ServiceError('Worker STT tidak dapat dijangkau. Pastikan worker berjalan.', 502); });
    if (!submitResponse.ok) throw await workerError(submitResponse);
    const submitted = await submitResponse.json().catch(() => null);
    if (typeof submitted?.job_id !== 'string') throw new ServiceError('Worker tidak mengembalikan job_id.');
    await uploads.updateUpload(row.id, { workerJobId: submitted.job_id });

    const deadline = Date.now() + config.recordingMaxProcessMin * 60_000;
    let failures = 0;
    for (;;) {
      if (Date.now() > deadline) throw new ServiceError('Pemrosesan rekaman melebihi batas waktu.', 504);
      await delay(config.recordingPollMs);
      let job;
      try {
        job = await fetchJson(`${base}/audio/transcriptions/jobs/${submitted.job_id}`, { headers }, 15000, fetchImpl);
        failures = 0;
      } catch (error) {
        if (/HTTP 404/.test(error.message)) throw new ServiceError('Worker kehilangan job ini (kemungkinan worker restart). Unggah ulang rekaman.');
        if (!error.retryable || ++failures >= 5) throw error;
        continue;
      }
      if (job.status === 'failed') throw new ServiceError(job.error || 'Transkripsi gagal di worker.');
      if (job.status === 'done') return normalizeResult(job.result);
    }
  }

  async function summarizeTranscript(id, title, transcript, llmModel) {
    if (!transcript?.text) throw new ServiceError('Tidak ada ucapan yang terdeteksi pada rekaman ini.', 422);
    await uploads.updateUpload(id, { stage: 'summarizing' });
    const entry = { speakerName: 'Rekaman', text: transcript.text };
    if (transcript.segments?.length) entry.segments = transcript.segments;
    const meeting = { roomName: title, transcripts: [entry], participants: new Map() };
    const summary = {
      ...await summarize(meeting, { ...config, llmModel: llmModel || config.llmModel }, fetchImpl),
      generatedAt: new Date().toISOString(),
    };
    await uploads.updateUpload(id, {
      summary, provider: summary.provider, status: 'done', stage: null, error: null,
      completedAt: new Date().toISOString(),
    });
  }

  async function processUpload(id) {
    try {
      const row = await uploads.getUploadRow(id);
      if (!row) return;
      await uploads.updateUpload(id, { status: 'processing', stage: 'transcribing', error: null });
      const transcript = await transcribeFile(row);
      await uploads.updateUpload(id, { transcript, durationSeconds: transcript.durationSeconds });
      await summarizeTranscript(id, row.title, transcript, row.llm_model);
    } catch (error) {
      await fail(id, error);
    } finally {
      // The recording is no longer needed once the transcript is saved (or processing failed).
      const row = await uploads.getUploadRow(id).catch(() => null);
      if (row?.file_path) {
        await rm(row.file_path, { force: true }).catch(() => {});
        await uploads.updateUpload(id, { filePath: null }).catch(() => {});
      }
    }
  }

  async function resummarize(id) {
    try {
      const row = await uploads.getUploadRow(id);
      if (!row) return;
      await summarizeTranscript(id, row.title, row.transcript, row.llm_model);
    } catch (error) {
      await fail(id, error);
    }
  }

  uploads.failInterrupted().catch(error => console.warn('[RECORDING] Startup cleanup skipped:', error.message));

  // ---- Routes --------------------------------------------------------------
  app.post('/api/recording-uploads', requireActor, requireReady, receive, asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File rekaman (field "file") wajib dikirim.' });
    const discard = () => rm(file.path, { force: true }).catch(() => {});
    try {
      if (!await looksLikeMp4(file.path)) {
        await discard();
        return res.status(415).json({ error: 'Isi file bukan MP4 yang valid.' });
      }
      const language = req.body?.language || 'id';
      if (!['id', 'en'].includes(language)) {
        await discard();
        return res.status(400).json({ error: 'Bahasa harus id atau en.' });
      }
      const llmModel = String(req.body?.llmModel || config.llmModel).trim();
      if (!config.recordingLlmModels.includes(llmModel)) {
        await discard();
        return res.status(400).json({ error: 'Model ringkasan tidak tersedia.' });
      }
      const sttModel = String(req.body?.sttModel || config.recordingSttModel).trim();
      if (!config.recordingSttModels.includes(sttModel)) {
        await discard();
        return res.status(400).json({ error: 'Model transkripsi tidak tersedia.' });
      }
      const diarizer = String(req.body?.diarizer || 'none').trim();
      if (!config.recordingDiarizers.includes(diarizer)) {
        await discard();
        return res.status(400).json({ error: 'Pemisah pembicara tidak tersedia.' });
      }
      if (sttModel === QWEN_STT_MODEL && diarizer !== 'none') {
        await discard();
        return res.status(400).json({ error: 'Qwen belum mendukung pemisah pembicara.' });
      }
      const title = String(req.body?.title || '').trim().slice(0, 255)
        || file.originalname.replace(/\.mp4$/i, '').slice(0, 255) || 'Rekaman';
      const created = await uploads.createUpload({
        id: randomUUID(), ownerId: req.recordingActor.id, ownerName: req.recordingActor.name,
        title, originalFilename: file.originalname.slice(0, 255), filePath: file.path,
        fileSize: file.size, llmModel, sttModel, language,diarizer,
      });
      enqueue(() => processUpload(created.id));
      res.status(202).json({ success: true, upload: created });
    } catch (error) {
      await discard();
      throw error;
    }
  }));

  app.get('/api/recording-uploads', requireActor, asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    res.json({ success: true, uploads: await uploads.listUploads(req.recordingActor.id, limit) });
  }));
  
  app.get('/api/recording-uploads/options', requireActor, (_req, res) => {
    res.json({
      success: true,
      llm: { default: config.llmModel, models: config.recordingLlmModels },
      stt: { default: config.recordingSttModel, models: config.recordingSttModels },
      diarizer: { default: 'none', options: config.recordingDiarizers },
    });
  });

  app.get('/api/recording-uploads/:id', requireActor, asyncRoute(async (req, res) => {
    const row = await findOwned(req, res);
    if (row) res.json({ success: true, upload: uploads.toApi(row, { detail: true }) });
  }));

  app.post('/api/recording-uploads/:id/summarize', requireActor, asyncRoute(async (req, res) => {
    const row = await findOwned(req, res);
    if (!row) return;
    if (row.status === 'processing' || row.status === 'queued') return res.status(409).json({ error: 'Rekaman sedang diproses.' });
    if (!row.transcript?.text) return res.status(409).json({ error: 'Belum ada transkrip untuk diringkas.' });
    const llmModel = String(req.body?.llmModel || row.llm_model || config.llmModel).trim();
    if (!config.recordingLlmModels.includes(llmModel)) return res.status(400).json({ error: 'Model ringkasan tidak tersedia.' });
    const sttModel = String(req.body?.sttModel || config.recordingSttModel).trim();
    if (!config.recordingSttModels.includes(sttModel)) {
      await discard();
      return res.status(400).json({ error: 'Model transkripsi tidak tersedia.' });
    }
    const updated = await uploads.updateUpload(row.id, { status: 'processing', stage: 'summarizing', error: null, llmModel });
    enqueue(() => resummarize(row.id));
    res.status(202).json({ success: true, upload: { ...updated, transcript: undefined, summary: undefined } });
  }));

  app.delete('/api/recording-uploads/:id', requireActor, asyncRoute(async (req, res) => {
    const row = await findOwned(req, res);
    if (!row) return;
    if (row.status === 'processing' || row.status === 'queued') return res.status(409).json({ error: 'Tunggu hingga pemrosesan selesai sebelum menghapus.' });
    if (row.file_path) await rm(row.file_path, { force: true }).catch(() => {});
    await uploads.deleteUpload(row.id);
    res.json({ success: true });
  }));
}
