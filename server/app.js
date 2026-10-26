import { SEA_LIVE_MODEL, seaLiveCapabilities, seaSessionDiarized } from './seaLiveConfig.js';
import express from 'express';
import { attachAuth } from './auth.js';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { join, basename, relative, isAbsolute } from 'node:path';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient, WebhookReceiver, EgressClient } from 'livekit-server-sdk';
import { MeetingStore } from './meetingStore.js';
import { createAttendanceFinalizer } from './attendanceFinalizer.js';
import { createGuestAccess } from './guestAccess.js';
import { WorkspaceStore } from './workspaceStore.js';
import { attachWorkspaceApi } from './workspaceApi.js';
import { createNotifications } from './notifications.js';
import { effectiveLlm, ServiceError, summarize, transcribeAudio, batchDiarizeAudio, normalizeTranscriptText } from './providers.js';
import { attachRecordingUploads } from './recordingUploads.js';
import { createPostMeetingBatch, publicBatch } from './postMeetingBatch.js';
import { availableSttModels, QWEN_STT_MODEL } from './config.js';
import { qwenDiarizationReady } from './qwenCapabilities.js';
import { QWEN_LIVE_MODEL, qwenLiveCapabilities, validateLiveFinal, speakerAliasKey, applySpeakerAliases } from './qwenLiveConfig.js';
import {
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  savePostMeetingBatch,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  verifyEmployeeId,
  getAllEmployees,
  createSchedule,
  getUpcomingSchedules,
  cancelSchedule,
  updateSchedule,
} from './db.js';

const nonEmpty = (value, max = 160) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const requestIdValid = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const publicParticipant = ({ guestSessionHash, guestSessionExpiresAt, ...person }) => person;

const asArray = value => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.trim() ? [value] : [];
    }
  }
  return [];
};

const pdfText = value => {
  if (value === null || value === undefined) return '';
  return String(value);
};

export function createApp(config, { fetchImpl = fetch, livekitProbe, authStore, workspaceStore, sendPush } = {}) {
  const app = express();
  const store = new MeetingStore(config.dataFile);
  const workspace=workspaceStore||new WorkspaceStore();
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const webhookReceiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);
  const roomService = new RoomServiceClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret, { requestTimeout: 1.5 });
  const egressClient = new EgressClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret);
  const probe = livekitProbe || (() => roomService.listRooms());
  const inFlightAudio = new Map();
  const inFlightSummarize = new Map();
  const meetingAudios = new Map();
  const postMeetingBatch = createPostMeetingBatch({ config, store, egress: egressClient, fetchImpl,
    summarize: meeting => summarize(meeting, config, fetchImpl),
    persist: async (meeting, result) => {
      if (config.databaseUrl) {
        await savePostMeetingBatch(meeting, publicBatch(result));
        await saveMeetingSummary(meeting.id, meeting.roomName, result.summary);
      }
    },
  });
  const webhookLogs = [];

  app.use('/api', (req,res,next)=>{
    req.requestId=randomUUID();
    res.setHeader('X-Request-ID',req.requestId);
    next();
  });
  app.use(cors({ credentials: true, exposedHeaders:['X-Request-ID'], origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      if (url.port === '5187' && (/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(url.hostname))) {
        return callback(null, true);
      }
    } catch {}
    callback(null, false);
  } }));

  // Preserve rawBody buffer for LiveKit cryptographic webhook signature verification
  app.use('/api/profile',express.json({limit:'2mb'}));
  app.use(express.json({
    limit: '256kb',
    type: ['application/json', 'application/webhook+json'],
    verify: (req, _res, buf) => {
      req.rawBody = buf ? buf.toString('utf8') : '';
    },
  }));

  attachAuth(app, config, authStore, createGuestAccess(store));
  attachWorkspaceApi(app,config,workspace);
  attachRecordingUploads(app, config, { fetchImpl });
  const notifications=config.authEnabled?createNotifications({workspace,meetings:()=>store.meetings,schedules:getUpcomingSchedules,config,sendPush}):null;

  async function dispatchOutboundWebhook(url, payload) {
    if (!url) return;
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('[OUTBOUND WEBHOOK] Dispatch note:', err.message);
    }
  }

  // 1. Health check & provider/database info
  app.get('/api/health', asyncRoute(async (_req, res) => {
    let livekitStatus = 'unavailable';
    try { await probe(); livekitStatus = 'reachable'; } catch { /* API health is independent of SFU. */ }
    const llmEffectiveProvider = effectiveLlm(config);
    const [qwenLive, seaLive] = await Promise.all([qwenLiveCapabilities(config, fetchImpl), seaLiveCapabilities(config, fetchImpl)]);
    const seaLivePilotReady = config.seaLivePilotEnabled && seaLive.ready;
    res.json({
      status: 'ok',
      livekitUrl: config.livekitUrl,
      livekitStatus,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      llmEffectiveProvider,
      hasLlmKey: llmEffectiveProvider !== 'demo',
      sttProvider: config.sttProvider,
      sttConfigured: Boolean(config.sttModel && (config.sttModel === QWEN_STT_MODEL ? config.qwenSttBaseUrl : config.sttBaseUrl)),
      sttDiarization: Boolean(config.sttDiarization),
      qwenDiarizationReady: await qwenDiarizationReady(config, fetchImpl),
      qwenLiveReady: qwenLive.ready,
      qwenBatchConfigured: postMeetingBatch.configured,
      qwenBatchWorkerReady: await postMeetingBatch.workerReady(),
      qwenLiveDiarizationReady: qwenLive.diarization,
      seaLivePilotReady,
      seaLiveDiarizationReady: seaLivePilotReady && seaLive.diarization,
      sttModel: config.sttModel,
      sttModels: [...availableSttModels(config),
        ...(config.liveSttUrl && config.liveSttSecret ? ['whisperlivekit-small'] : []),
        ...(qwenLive.ready ? [QWEN_LIVE_MODEL] : []),
        ...(seaLivePilotReady ? [SEA_LIVE_MODEL] : [])],
      database: {
        connected: isDbConnected(),
        configured: Boolean(config.databaseUrl),
      },
      outboundWebhookConfigured: Boolean(config.outboundWebhookUrl),
      totalWebhookEvents: webhookLogs.length,
    });
  }));

  // 2. Authorized employee directory
  app.get('/api/employees', asyncRoute(async (_req, res) => {
    const list = await getAllEmployees();
    res.json({
      success: true,
      count: list.length,
      databaseConnected: isDbConnected(),
      employees: list,
    });
  }));

  // 3. Generate LiveKit token with database employee verification
  app.post('/api/token', asyncRoute(async (req, res) => {
    if (req.auth) req.body = { ...req.body, employeeId: req.auth.user.employeeId, employeeName: req.auth.user.name, department: req.auth.user.department };
    let { roomName, employeeId, employeeName, department = 'General' } = req.body || {};
    if (!nonEmpty(department)) department = 'General';

    if (![roomName, employeeId, employeeName].every(value => nonEmpty(value))) {
      return res.status(400).json({ error: 'Room, employee ID, and name must be non-empty strings (max 160 characters)' });
    }

    const cleanId = employeeId.trim();
    const guestMeeting = req.auth?.user.isGuest ? store.get(req.auth.user.guestMeetingId) : null;
    if (req.auth?.user.isGuest && (!guestMeeting || guestMeeting.status !== 'active' || guestMeeting.attendanceFinalization || guestMeeting.closingForUploads || roomName.trim() !== guestMeeting.roomName)) return res.status(403).json({ error: 'Undangan tamu tidak berlaku untuk ruang ini.' });

    // Verify employee ID format and database registration
    if (config.verifyEmployeeId && !req.auth?.user.isGuest) {
      const empCheck = await verifyEmployeeId(cleanId);
      if (!empCheck.valid) {
        if (empCheck.formatError) {
          console.warn(`[AUTH] ⚠️ Format ID Salah: "${cleanId}"`);
          return res.status(400).json({
            error: 'Format ID Salah.',
            code: 'INVALID_ID_FORMAT',
            employeeId: cleanId,
            hint: 'Format resmi ID karyawan harus berupa "BT-XXXXX" (contoh: BT-10492).',
          });
        }

        const errorMsg = empCheck.inactive
          ? `Akses ditolak: Status karyawan dengan ID "${cleanId}" sedang non-aktif.`
          : `Akses ditolak: Employee ID "${cleanId}" tidak terdaftar di database resmi perusahaan. Harap periksa kembali ID Anda atau hubungi admin.`;

        console.warn(`[AUTH] ⛔ Access denied for Employee ID "${cleanId}": ${empCheck.reason}`);
        return res.status(403).json({
          error: errorMsg,
          code: 'EMPLOYEE_NOT_FOUND',
          employeeId: cleanId,
          verifiedAgainstDb: empCheck.checked,
        });
      }

      // Use authoritative name and department from company DB if registered
      if (empCheck.employee?.name) employeeName = empCheck.employee.name;
      if (empCheck.employee?.department) department = empCheck.employee.department;
      if(req.auth)employeeName=req.auth.user.name;
    }

    const active = [...store.meetings.values()].find(meeting => meeting.roomName === roomName.trim() && meeting.status === 'active');
    const duplicate = active?.participants.get(cleanId);
    if (duplicate && !duplicate.leftAt && (!req.auth?.user.isGuest || duplicate.guestTokenIssued) && Date.now() - Date.parse(duplicate.lastSeen) < 45000) {
      return res.status(409).json({ error: 'This employee is already joining or connected. Use a different identity for another test window.' });
    }
    // const meeting = guestMeeting || store.join(roomName.trim(), { employeeId: cleanId, employeeName: employeeName.trim(), department: department.trim() });
    let scheduledHostId = '';

    if (!guestMeeting) {
      const schedules = await getUpcomingSchedules().catch(() => []);
      const now = Date.now();

      const scheduled = schedules.find(item =>
        item.roomName === roomName.trim() &&
        item.hostId &&
        Date.parse(item.scheduledStart) <= now + 60_000 &&
        Date.parse(item.scheduledEnd) > now
      );

      scheduledHostId = scheduled?.hostId || '';
    }

    const meeting = guestMeeting || store.join(roomName.trim(), {
      employeeId: cleanId,
      employeeName: employeeName.trim(),
      department: department.trim(),
      hostId: scheduledHostId || cleanId,
    });
    if (guestMeeting) store.transact(() => { const person = meeting.participants.get(cleanId); person.guestTokenIssued = true; person.leftAt = null; person.lastSeen = new Date().toISOString(); });
    
    // Asynchronously record meeting in PostgreSQL if configured
    saveMeeting({ id: meeting.id, roomName: meeting.roomName, status: 'active', createdAt: meeting.createdAt }).catch(() => {});
    const participant = meeting.participants.get(cleanId);
    const microphoneIsRestricted = Boolean(participant?.moderatorMuted);

    const at = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: cleanId,
      name: employeeName.trim(),
      ttl: '12h',
      metadata: JSON.stringify({
        meetingId: meeting.id,
        department: department.trim(),
        employeeId: cleanId,
        isGuest: Boolean(req.auth?.user.isGuest),
      }),
    });

    const grant = {
      room: meeting.livekitRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };

    if (microphoneIsRestricted) {
      // TrackSource: camera=1, microphone=2,
      // screen_share=3, screen_share_audio=4.
      grant.canPublishSources = [1, 3, 4];
    }

    at.addGrant(grant);

    res.json({
      token: await at.toJwt(),
      url: config.livekitUrl,
      roomName: meeting.roomName,
      meetingId: meeting.id,
      sttProvider: config.sttProvider,
    });
  }));

  // 4. Meeting scheduling & calendar endpoints
  app.get('/api/schedules', asyncRoute(async (_req, res) => {
    const schedules = await getUpcomingSchedules();
    res.json({
      success: true,
      count: schedules.length,
      schedules,
    });
  }));

  app.post('/api/schedules', asyncRoute(async (req, res) => {
    if (req.auth) req.body = { ...req.body, hostId: req.auth.user.employeeId, hostName: req.auth.user.name, department: req.auth.user.department };
    const {
      roomName,
      title,
      description = '',
      hostId = '',
      hostName = '',
      department = 'General',
      scheduledStart,
      scheduledEnd,
    } = req.body || {};

    if (!nonEmpty(title) || !nonEmpty(roomName)) {
      return res.status(400).json({ error: 'Judul rapat dan nama ruang wajib diisi (maksimal 160 karakter).' });
    }

    if (!scheduledStart || !scheduledEnd) {
      return res.status(400).json({ error: 'Waktu mulai dan waktu selesai rapat wajib ditentukan.' });
    }

    const startTime = Date.parse(scheduledStart);
    const endTime = Date.parse(scheduledEnd);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Format tanggal atau waktu rapat tidak valid.' });
    }

    // Validation: Start time cannot be in the past (allow 60s tolerance for network latency)
    if (startTime < Date.now() - 60000) {
      return res.status(400).json({
        error: 'Waktu mulai rapat tidak boleh di masa lalu. Harap pilih tanggal dan jam yang akan datang.',
        code: 'PAST_TIME_NOT_ALLOWED',
      });
    }

    // Validation: End time must be after start time
    if (endTime <= startTime) {
      return res.status(400).json({
        error: 'Waktu selesai rapat harus setelah waktu mulai.',
        code: 'INVALID_TIME_RANGE',
      });
    }

    // Host Employee verification if provided and enabled
    let finalHostName = hostName || 'Penyelenggara BaliCall';
    let finalDepartment = department || 'General';
    if (hostId && config.verifyEmployeeId) {
      const cleanHostId = hostId.trim();
      const empCheck = await verifyEmployeeId(cleanHostId);
      if (!empCheck.valid) {
        if (empCheck.formatError) {
          return res.status(400).json({
            error: 'Format ID Salah.',
            code: 'INVALID_ID_FORMAT',
            hostId: cleanHostId,
          });
        }
        return res.status(403).json({
          error: `Host ID "${cleanHostId}" tidak terdaftar di database karyawan.`,
          code: 'EMPLOYEE_NOT_FOUND',
        });
      }
      if (empCheck.employee) {
        finalHostName = empCheck.employee.name;
        finalDepartment = empCheck.employee.department;
      }
    }

    const schedule = await createSchedule({
      roomName: roomName.trim(),
      title: title.trim(),
      description: (description || '').trim(),
      hostId: (hostId || '').trim(),
      hostName: finalHostName,
      department: finalDepartment,
      scheduledStart,
      scheduledEnd,
    });

    res.status(201).json({
      success: true,
      schedule,
    });
  }));

  app.delete('/api/schedules/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (req.auth) {
      const schedule = (await getUpcomingSchedules()).find(item => item.id === id);
      if (!schedule) return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan.' });
      if (schedule.hostId !== req.auth.user.employeeId) return res.status(403).json({ error: 'Hanya penyelenggara yang dapat mengubah jadwal ini.' });
    }
    const ok = await cancelSchedule(id);
    if (!ok) {
      return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan atau sudah dibatalkan.' });
    }
    res.json({ success: true, message: 'Jadwal rapat berhasil dibatalkan.' });
  }));

  app.put('/api/schedules/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (req.auth) {
      const schedule = (await getUpcomingSchedules()).find(item => item.id === id);
      if (!schedule) return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan.' });
      if (schedule.hostId !== req.auth.user.employeeId) return res.status(403).json({ error: 'Hanya penyelenggara yang dapat mengubah jadwal ini.' });
    }
    const {
      scheduledStart,
      scheduledEnd,
      title,
      description,
      roomName,
    } = req.body || {};

    if (!scheduledStart || !scheduledEnd) {
      return res.status(400).json({ error: 'Waktu mulai dan waktu selesai rapat baru wajib ditentukan.' });
    }

    const startTime = Date.parse(scheduledStart);
    const endTime = Date.parse(scheduledEnd);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Format tanggal atau waktu rapat tidak valid.' });
    }

    // Validation: Start time cannot be in the past (allow 60s tolerance for network latency)
    if (startTime < Date.now() - 60000) {
      return res.status(400).json({
        error: 'Waktu mulai rapat tidak boleh di masa lalu. Harap pilih tanggal dan jam yang akan datang.',
        code: 'PAST_TIME_NOT_ALLOWED',
      });
    }

    // Validation: End time must be after start time
    if (endTime <= startTime) {
      return res.status(400).json({
        error: 'Waktu selesai rapat harus setelah waktu mulai.',
        code: 'INVALID_TIME_RANGE',
      });
    }

    const updated = await updateSchedule(id, {
      scheduledStart,
      scheduledEnd,
      title: title ? title.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
      roomName: roomName ? roomName.trim() : undefined,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan atau sudah dibatalkan.' });
    }

    res.json({
      success: true,
      message: 'Jadwal rapat berhasil diperbarui.',
      schedule: updated,
    });
  }));

  // Meeting authorization middleware
  app.use('/api/meetings/:id', asyncRoute(async (req, res, next) => {
    if (['db-summaries', 'db-details'].includes(req.params.id) || req.path === '/recording' || req.path === '/recording/download' || req.path.startsWith('/export')) return next();
    const meeting = store.get(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting session not found' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'A meeting token is required' });
    let claims;
    try { claims = await verifier.verify(token); } catch { return res.status(401).json({ error: 'Meeting token is invalid or expired' }); }
    if (claims.video?.room !== meeting.livekitRoom || !claims.video?.roomJoin || !meeting.participants.has(claims.sub)) return res.status(403).json({ error: 'This token cannot access the meeting' });
    req.meetingId = meeting.id;
    if (req.auth && claims.sub !== req.auth.user.employeeId) return res.status(403).json({ error: 'Token rapat bukan milik akun ini.' });
    req.speakerId = claims.sub;
    next();
  }));

  function getMeetingRecordingInfo(meetingId, storeMeeting = null) {
    const cleanId = String(meetingId || '').replace(/^meeting-/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(cleanId)) return {hasRecording:false};
    const names = [...new Set(['mp4','ogg'].flatMap(ext => [`meeting-${cleanId}.${ext}`, `${cleanId}.${ext}`]))];
    const recordedName = storeMeeting?.recording?.filepath && basename(storeMeeting.recording.filepath);
    if (names.includes(recordedName)) names.unshift(recordedName);
    const roots = [...new Set([config.livekitRecordingsDir, config.qwenBatchRecordingsDir].filter(Boolean))];
    for (const root of roots) {
      let base;
      try { base = realpathSync(root); } catch { continue; }
      for (const name of names) {
        try {
          const filePath = realpathSync(join(base,name));
          const rel = relative(base,filePath);
          if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
          const stats = statSync(filePath);
          if (stats.isFile() && stats.size > 0) return {hasRecording:true,filePath,
            fileName:basename(filePath),fileSize:stats.size};
        } catch { /* Missing files are normal while Egress finishes writing. */ }
      }
    }
    return {hasRecording:false};
  }

  function writable(req, res) {
    const meeting = store.get(req.meetingId);
    if (meeting.status !== 'active' || meeting.closingForUploads || meeting.participants.get(req.speakerId).leftAt) {
      res.status(409).json({ error: 'You have left this meeting. Start or join another session to add speech.' });
      return false;
    }
    return true;
  }

  function requireMeetingManager(req, res, allowedRoles = ['host', 'co-host']) {
    const meeting = store.get(req.meetingId);

    if (!meeting || meeting.status !== 'active') {
      res.status(409).json({ error: 'Meeting tidak aktif atau tidak ditemukan.' });
      return null;
    }

    const actor = meeting.participants.get(req.speakerId);

    if (!actor || actor.leftAt) {
      res.status(403).json({ error: 'Peserta tidak lagi aktif dalam meeting.' });
      return null;
    }

    if (req.auth?.user?.isGuest) {
      res.status(403).json({ error: 'Tamu tidak memiliki izin mengelola peserta.' });
      return null;
    }

    const role = actor.employeeId === meeting.hostId
      ? 'host'
      : (meeting.coHostIds || []).includes(actor.employeeId)
        ? 'co-host'
        : 'participant';

    if (!allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
      return null;
    }

    return { meeting, actor, role };
  }

  app.patch(
    '/api/meetings/:id/participants/:participantId/role',
    (req, res) => {
      const access = requireMeetingManager(req, res, ['host']);
      if (!access) return;

      const { role } = req.body || {};

      if (!['co-host', 'participant'].includes(role)) {
        return res.status(400).json({
          error: 'Role harus co-host atau participant.',
        });
      }

      const result = store.setCoHost(
        req.meetingId,
        req.speakerId,
        req.params.participantId,
        role === 'co-host'
      );

      res.json({ success: true, participant: result });
    }
  );

  app.post(
    '/api/meetings/:id/participants/:participantId/mute',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (targetId === req.speakerId) {
        return res.status(400).json({
          error: 'Gunakan kontrol mikrofon sendiri untuk mute diri Anda.',
        });
      }

      if (
        access.role === 'co-host' &&
        (
          targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId)
        )
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat mute peserta biasa.',
        });
      }

      // Simpan pembatasan terlebih dahulu agar status tetap ada saat reconnect.
      store.setModeratorMute(access.meeting.id, targetId, true);

      try {
        const participants = await roomService.listParticipants(
          access.meeting.livekitRoom
        );

        const liveParticipant = participants.find(
          person => person.identity === targetId
        );

        if (liveParticipant) {
          const currentPermission = liveParticipant.permission || {};

          // Pertahankan izin yang ada, tetapi cabut izin publish mikrofon.
          const currentSources = currentPermission.canPublishSources;
          const allowedSources = Array.isArray(currentSources)
            ? currentSources.filter(source => Number(source) !== 2)
            : [1, 3, 4];

          await roomService.updateParticipant(
            access.meeting.livekitRoom,
            targetId,
            {
              permission: {
                canSubscribe: currentPermission.canSubscribe ?? true,
                canPublish: currentPermission.canPublish ?? true,
                canPublishData: currentPermission.canPublishData ?? true,
                canPublishSources: allowedSources,
              },
            }
          );
          
          const audioTracks = (liveParticipant.tracks || []).filter(
            track => Number(track.type) === 0 && !track.muted
          );

          for (const track of audioTracks) {
            await roomService.mutePublishedTrack(
              access.meeting.livekitRoom,
              targetId,
              track.sid,
              true
            );
          }
        }

        return res.json({ success: true, muted: true });
      } catch (error) {
        console.error('Gagal menerapkan pembatasan mikrofon:', error);

        return res.status(502).json({
          error:
            'Status mute sudah tersimpan, tetapi izin LiveKit gagal diperbarui. Periksa koneksi LiveKit.',
        });
      }
    })
  );

  // Peserta meminta izin untuk berbicara.
  app.post(
    '/api/meetings/:id/request-to-speak',
    asyncRoute(async (req, res) => {
      const meeting = store.get(req.meetingId);

      if (!meeting || meeting.status !== 'active') {
        return res.status(409).json({ error: 'Meeting tidak aktif.' });
      }

      const participant = meeting.participants.get(req.speakerId);

      if (!participant || participant.leftAt) {
        return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
      }

      const result = store.requestToSpeak(meeting.id, req.speakerId);

      return res.json({
        success: true,
        speakRequestAt: result.speakRequestAt,
      });
    })
  );

  // Host/co-host menyetujui permintaan bicara.
  app.post(
    '/api/meetings/:id/participants/:participantId/approve-speak',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (
        access.role === 'co-host' &&
        (
          targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId)
        )
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat menyetujui peserta biasa.',
        });
      }

      if (!target.moderatorMuted || !target.speakRequestAt) {
        return res.status(409).json({
          error: 'Tidak ada permintaan izin bicara yang menunggu.',
        });
      }

      // Hapus pembatasan yang tersimpan.
      store.setModeratorMute(access.meeting.id, targetId, false);

      try {
        const participants = await roomService.listParticipants(
          access.meeting.livekitRoom
        );

        const liveParticipant = participants.find(
          person => person.identity === targetId
        );

        if (liveParticipant) {
          const permission = liveParticipant.permission || {};
          const sources = Array.isArray(permission.canPublishSources)
            ? permission.canPublishSources.map(Number)
            : [1, 2, 3, 4];

          if (!sources.includes(2)) sources.push(2);

          await roomService.updateParticipant(
            access.meeting.livekitRoom,
            targetId,
            {
              permission: {
                canSubscribe: permission.canSubscribe ?? true,
                canPublish: permission.canPublish ?? true,
                canPublishData: permission.canPublishData ?? true,
                canPublishSources: sources,
              },
            }
          );
        }

        return res.json({
          success: true,
          microphoneRestricted: false,
          // Persetujuan tidak menyalakan mikrofon secara otomatis.
        });
      } catch (error) {
        console.error('Gagal memperbarui izin bicara:', error);

        return res.status(502).json({
          error: 'Izin bicara tersimpan, tetapi izin LiveKit gagal diperbarui.',
        });
      }
    })
  );

  app.delete(
    '/api/meetings/:id/participants/:participantId',
    asyncRoute(async (req, res) => {
      const access = requireMeetingManager(req, res);
      if (!access) return;

      const targetId = req.params.participantId;
      const target = access.meeting.participants.get(targetId);

      if (!target || target.leftAt) {
        return res.status(404).json({
          error: 'Peserta tidak ditemukan atau sudah meninggalkan meeting.',
        });
      }

      if (targetId === req.speakerId) {
        return res.status(400).json({
          error: 'Anda tidak dapat mengeluarkan diri sendiri melalui fitur ini.',
        });
      }

      if (
        access.role === 'co-host' &&
        (targetId === access.meeting.hostId ||
          (access.meeting.coHostIds || []).includes(targetId))
      ) {
        return res.status(403).json({
          error: 'Co-host hanya dapat mengeluarkan peserta biasa.',
        });
      }

      await roomService.removeParticipant(
        access.meeting.livekitRoom,
        targetId
      );

      res.json({ success: true, removed: targetId });
    })
  );

  app.post('/api/meetings/:id/guest-invite', (req, res) => {
    if (!config.authEnabled) return res.status(409).json({ error: 'Aktifkan login sebelum mengundang tamu.' });
    if (!writable(req, res)) return;
    const meeting = store.get(req.meetingId);
    // This endpoint is excluded from guest authorization above.
    store.transact(() => { meeting.guestInviteCode ||= randomBytes(16).toString('base64url'); });
    res.json({ inviteCode: meeting.guestInviteCode });
  });
  app.post('/api/meetings/:id/employee-invites',asyncRoute(async(req,res)=>{
    if(!req.auth?.user||req.auth.user.isGuest)return res.status(403).json({error:'Masuk dengan akun karyawan untuk mengundang.'});
    if(!writable(req,res))return;
    const ids=req.body?.employeeIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>20||ids.some(id=>typeof id!=='string'||!/^BT-\d{4,6}$/.test(id)))return res.status(400).json({error:'Pilih 1–20 NIK karyawan.'});
    const meeting=store.get(req.meetingId);
    for(const id of new Set(ids))await workspace.notify(id,{key:`invitation:${meeting.id}:${id}`,kind:'invitation',roomName:meeting.roomName,meetingId:meeting.id});
    res.json({success:true});
  }));

  app.post('/api/meetings/:id/live-session', asyncRoute(async (req, res) => {
    if (!writable(req, res)) return;
    const { language, model, diarize = false, streamId } = req.body || {};
    if (model === SEA_LIVE_MODEL) {
      if (!config.seaLivePilotEnabled) return res.status(503).json({error:'SEA Live pilot belum diaktifkan. Pilih model lain.'});
      const capabilities = await seaLiveCapabilities(config, fetchImpl);
      if (!capabilities.ready) return res.status(503).json({error:'SEA Live worker belum siap. Pilih model lain.'});
      if (language !== 'id' || typeof diarize !== 'boolean') return res.status(400).json({error:'Mode SEA Live tidak valid; gunakan Bahasa Indonesia.'});
      if (diarize && !capabilities.diarization) return res.status(503).json({error:'Nemotron untuk SEA belum siap. Gunakan mikrofon pribadi atau coba lagi.'});
      if (streamId !== undefined && (typeof streamId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(streamId))) return res.status(400).json({error:'Sesi mikrofon tidak valid.'});
      const payload=Buffer.from(JSON.stringify({meetingId:req.meetingId,speakerId:req.speakerId,language,model,
        diarize,...(streamId?{streamId}:{}),exp:(capabilities.workerTime ?? Math.floor(Date.now()/1000))+60,nonce:randomUUID()})).toString('base64url');
      const signature=createHmac('sha256',config.seaLiveSttSecret).update(payload).digest('base64url');
      return res.set('Cache-Control','no-store').json({url:`${config.seaLiveSttUrl}?ticket=${payload}.${signature}`});
    }
    if (model === QWEN_LIVE_MODEL) {
      const capabilities = await qwenLiveCapabilities(config, fetchImpl);
      if (!capabilities.ready || (diarize && !capabilities.diarization)) return res.status(503).json({ error: 'Qwen streaming atau diarization belum siap.' });
      if (!['id','en'].includes(language) || typeof diarize !== 'boolean') return res.status(400).json({ error: 'Bahasa atau mode streaming tidak valid.' });
      if (streamId !== undefined && (typeof streamId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(streamId))) return res.status(400).json({error:'Sesi mikrofon tidak valid.'});
      const payload = Buffer.from(JSON.stringify({ meetingId:req.meetingId,speakerId:req.speakerId,
        language,model,diarize,...(streamId?{streamId}:{}),exp:(capabilities.workerTime ?? Math.floor(Date.now()/1000))+60,nonce:randomUUID() })).toString('base64url');
      const signature = createHmac('sha256',config.qwenLiveSttSecret).update(payload).digest('base64url');
      return res.set('Cache-Control','no-store').json({url:`${config.qwenLiveSttUrl}?ticket=${payload}.${signature}`});
    }
    if (!config.liveSttSecret || !config.liveSttUrl) return res.status(503).json({ error: 'WhisperLiveKit belum dikonfigurasi.' });
    if (!['id', 'en'].includes(language) || model !== 'whisperlivekit-small') return res.status(400).json({ error: 'Bahasa atau model streaming tidak valid.' });
    const payload = Buffer.from(JSON.stringify({ meetingId: req.meetingId, speakerId: req.speakerId,
      language, model, exp: Math.floor(Date.now() / 1000) + 60, nonce: randomUUID() })).toString('base64url');
    const signature = createHmac('sha256', config.liveSttSecret).update(payload).digest('base64url');
    res.set('Cache-Control', 'no-store').json({ url: `${config.liveSttUrl}?ticket=${payload}.${signature}` });
  }));

  app.get('/api/meetings/:id/transcript', (req, res) => {
    const meeting = store.get(req.meetingId);
    const currentParticipant = meeting.participants.get(req.speakerId);

    const currentRole = currentParticipant
      ? currentParticipant.employeeId === meeting.hostId
        ? 'host'
        : (meeting.coHostIds || []).includes(currentParticipant.employeeId)
          ? 'co-host'
          : 'participant'
      : 'participant';
    res.json({
      meetingId: meeting.id,
      roomName: meeting.roomName,
      status: meeting.status,
      isSummarizing: inFlightSummarize.has(meeting.id),
      hostId: meeting.hostId,
      coHostIds: meeting.coHostIds || [],
      currentRole,
      recording: meeting.recording || null,
      transcripts: meeting.postMeetingBatch?.status === 'done' ? meeting.postMeetingBatch.transcripts : meeting.transcripts,
      postMeetingBatch: publicBatch(meeting.postMeetingBatch),
      participants: [...meeting.participants.values()].map(publicParticipant),
      summary: meeting.postMeetingBatch?.status === 'done' ? meeting.postMeetingBatch.summary : meeting.summary,
      attendanceFinalization: meeting.attendanceFinalization || null,
      microphoneRestricted: Boolean(
        meeting.participants.get(req.speakerId)?.moderatorMuted
      ),
      speakRequestAt:
        meeting.participants.get(req.speakerId)?.speakRequestAt || null,
      pendingSpeakRequests: [...meeting.participants.values()]
        .filter(
          person =>
            !person.leftAt &&
            person.moderatorMuted &&
            person.speakRequestAt
        )
        .map(person => ({
          identity: person.employeeId,
          name: person.name,
          speakRequestAt: person.speakRequestAt,
        })),
    });
  });

  app.post('/api/meetings/:id/speaker-name', asyncRoute(async (req,res)=>{
    if (!writable(req,res)) return;
    const meeting=store.get(req.meetingId);
    if (inFlightSummarize.has(meeting.id)) return res.status(409).json({error:'Tunggu proses notulen selesai sebelum mengganti nama.'});
    const {sourceId,sessionId,speaker,name}=req.body || {};
    if (![sourceId,sessionId,speaker].every(value=>typeof value==='string' && value.length>0 && value.length<=100)
      || typeof name!=='string' || name.length>80 || /[\u0000-\u001f\u007f]/.test(name)) return res.status(400).json({error:'Nama pembicara tidak valid (maksimal 80 karakter).'});
    const manager=req.speakerId===meeting.hostId || (meeting.coHostIds || []).includes(req.speakerId);
    if (req.speakerId!==sourceId && !manager) return res.status(403).json({error:'Hanya pemilik mikrofon atau host yang dapat mengubah nama pembicara.'});
    const key=speakerAliasKey({sourceId,sessionId,speaker});
    const matches=entry=>[QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel) && entry.segments?.some(segment=>speakerAliasKey(segment)===key && segment.attribution==='assigned');
    if (!meeting.transcripts.some(matches)) return res.status(404).json({error:'Pembicara yang dapat diberi nama tidak ditemukan.'});
    const updatedEntries=store.transact(()=>{
      meeting.speakerAliases ||= {};
      if (name.trim()) meeting.speakerAliases[key]=name.trim();else delete meeting.speakerAliases[key];
      meeting.summary=null;
      return meeting.transcripts.filter(matches).map(entry=>{
        entry.segments=entry.segments.map(segment=>{
          if (speakerAliasKey(segment)!==key) return segment;
          const next={...segment};delete next.speakerName;
          return name.trim()?{...next,speakerName:name.trim()}:next;
        });
        entry.revision=(entry.revision || 0)+1;
        return entry;
      });
    });
    await saveTranscripts(meeting.id,meeting.roomName,meeting.transcripts);
    res.json({success:true,transcripts:meeting.transcripts,updatedEntries});
  }));

  app.post('/api/meetings/:id/transcript', (req, res) => {
    if ([QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(req.body?.sttModel)) {
      if (!writable(req,res)) return;
      let final;
      try {
        final = validateLiveFinal(req.body.final,req.speakerId);
        if (req.body.sttModel === SEA_LIVE_MODEL && !seaSessionDiarized(req.body.final,config,req.meetingId,req.speakerId)) {
          if (req.body.final.attribution !== 'unknown') throw Error('SEA personal mode cannot assign acoustic speakers');
          final.segments = final.segments.map(segment => ({ ...segment, speaker:'Peserta', attribution:'participant' }));
        }
      }
      catch { return res.status(400).json({error:'Segmen streaming tidak valid.'}); }
      if ([QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(req.body.sttModel)) final.segments=applySpeakerAliases(store.get(req.meetingId),final.segments);
      const existing = store.findEntry(store.get(req.meetingId),req.speakerId,final.requestId);
      const entry = existing || store.append(req.meetingId,req.speakerId,final.text,final.requestId,final.segments,req.body.sttModel);
      return res.json({success:true,entry});
    }
    const { text, requestId = randomUUID() } = req.body || {};
    if (!nonEmpty(text, 10000) || !requestIdValid(requestId)) return res.status(400).json({ error: 'Non-empty text and a valid requestId are required' });
    const cleanText = normalizeTranscriptText(text);
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous });
    if (!writable(req, res)) return;
    res.json({ success: true, entry: store.append(req.meetingId, req.speakerId, cleanText, requestId) });
  });

  app.post('/api/meetings/:id/presence', (req, res) => {
    if (typeof req.body?.connected !== 'boolean') return res.status(400).json({ error: 'connected must be boolean' });
    if (!writable(req, res)) return;
    res.json({ participant: publicParticipant(store.presence(req.meetingId, req.speakerId, req.body.connected)) });
  });

  app.post('/api/meetings/:id/recording/start', asyncRoute(async (req, res) => {
    if (!requireMeetingManager(req, res)) return;
    const meeting = store.get(req.meetingId);
    const batchRequested = req.body?.postMeetingBatch === true;
    if (batchRequested && (req.speakerId !== meeting.hostId || !postMeetingBatch.configured)) return res.status(503).json({ error: 'Batch Qwen hanya dapat diaktifkan host setelah worker dan folder rekaman dikonfigurasi.' });
    if (batchRequested && ((meeting.recordingRuns || 0) > 0 || !['id', 'en'].includes(req.body?.language || 'id'))) return res.status(400).json({ error: 'Batch memerlukan satu rekaman utuh dan bahasa id/en. Mulai dari rapat baru.' });

    if (meeting.status !== 'active') {
      return res.status(409).json({ error: 'Meeting sudah selesai.' });
    }

    if (meeting.recording?.status === 'active') {
      return res.status(409).json({
        error: 'Recording sudah berjalan.',
        recording: meeting.recording,
      });
    }

    const audioOnly = batchRequested;
    const filepath = `/out/${meeting.livekitRoom}.${audioOnly ? 'ogg' : 'mp4'}`;

    const result = await egressClient.startRoomCompositeEgress(
      meeting.livekitRoom,
      {
        file: {
          filepath,
          fileType: audioOnly ? 2 : 1,
        },
      },
      // Empty layout skips the default template's screen-share focus switch.
      // Explicit grid keeps camera tiles equal and promotes screen sharing.
      audioOnly ? { audioOnly: true, ...(config.qwenBatchEgressMode === 'sdk' ? {} : { layout: 'grid' }) } : { layout: 'grid' },
    );

    const recording = {
      egressId: result.egressId,
      audioOnly,
      status: 'active',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      filepath,
    };

    store.transact(() => {
      store.get(req.meetingId).recording = recording;
      store.get(req.meetingId).recordingRuns = (store.get(req.meetingId).recordingRuns || 0) + 1;
      if (batchRequested) store.get(req.meetingId).postMeetingBatchRequested = { language: req.body?.language || 'id' };
    });

    res.json({
      success: true,
      recording,
    });
  }));

  app.post('/api/meetings/:id/leave', asyncRoute(async (req, res) => {
    const updated = store.leave(req.meetingId, req.speakerId);

    if (
      updated.status === 'ended' &&
      updated.recording?.egressId &&
      updated.recording.status === 'active'
    ) {
      try {
        await egressClient.stopEgress(updated.recording.egressId);

        store.transact(() => {
          const meeting = store.get(req.meetingId);

          if (meeting.recording?.status === 'active') {
            meeting.recording = {
              ...meeting.recording,
              status: 'stopped',
              stoppedAt: new Date().toISOString(),
            };
          }
        });
      } catch (recordingError) {
        console.warn(
          '[RECORDING] Could not stop Egress:',
          recordingError.message,
        );
      }
    }

    postMeetingBatch.schedule(updated.id);
    try {
      await saveMeeting(updated);
      await saveAttendees(updated.id, [...updated.participants.values()]);

      if (updated.transcripts?.length) {
        await saveTranscripts(updated.id, updated.roomName, updated.transcripts);
      }
    } catch (dbErr) {
      console.warn('[DB] Could not update leave status in database:', dbErr.message);
    }

    res.json({
      success: true,
      status: updated.status,
      recording: store.get(req.meetingId).recording,
    });
  }));

  app.post('/api/meetings/:id/recording/stop', asyncRoute(async (req, res) => {
    if (!requireMeetingManager(req, res)) return;
    const meeting = store.get(req.meetingId);
    const recording = meeting.recording;

    if (!recording?.egressId || recording.status !== 'active') {
      return res.json({
        success: true,
        alreadyStopped: true,
        recording: recording || { status: 'stopped' },
      });
    }

    try {
      await egressClient.stopEgress(recording.egressId);
    } catch (egressErr) {
      console.warn('[RECORDING] stopEgress note:', egressErr.message);
      return res.status(502).json({
        error: 'Belum dapat menghentikan rekaman. Coba lagi; rekaman mungkin masih berjalan.',
        recording,
      });
    }

    const stoppedAt = new Date().toISOString();

    store.transact(() => {
      store.get(req.meetingId).recording = {
        ...recording,
        status: 'stopped',
        stoppedAt,
      };
    });

    res.json({
      success: true,
      recording: store.get(req.meetingId).recording,
    });
  }));

  app.get('/api/meetings/:id/recording', asyncRoute(async (req, res) => {
    if (req.auth?.user?.isGuest) {
      return res.status(403).json({ error: 'Tamu tidak diizinkan mengakses rekaman rapat.' });
    }
    const storeMeeting = store.get(req.params.id);
    const rec = getMeetingRecordingInfo(req.params.id, storeMeeting);
    res.json({
      success: true,
      meetingId: req.params.id,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
      fileName: rec.fileName || null,
    });
  }));

  app.get('/api/meetings/:id/recording/download', asyncRoute(async (req, res) => {
    if (req.auth?.user?.isGuest) {
      return res.status(403).json({ error: 'Tamu tidak diizinkan mengunduh rekaman rapat.' });
    }
    const storeMeeting = store.get(req.params.id);
    const rec = getMeetingRecordingInfo(req.params.id, storeMeeting);
    if (!rec.hasRecording || !rec.filePath) {
      return res.status(404).json({ error: 'Berkas rekaman tidak ditemukan untuk rapat ini.' });
    }

    const downloadFileName = rec.fileName || `meeting-${req.params.id}.mp4`;
    res.download(rec.filePath, downloadFileName, (err) => {
      if (err && !res.headersSent) {
        console.warn('[RECORDING] Download error:', err.message);
        res.status(500).json({ error: 'Gagal mengunduh berkas rekaman.' });
      }
    });
  }));

  app.post('/api/meetings/:id/audio', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '5mb' }), asyncRoute(async (req, res) => {
    const requestId = req.get('X-Request-Id');
    const language = req.get('X-Speech-Language') || 'id';
    const model = req.get('X-Speech-Model') || config.sttModel;
    const diarizeHeader = req.get('X-Speech-Diarize');
    const diarize = diarizeHeader !== undefined ? diarizeHeader === 'true' : (model !== QWEN_STT_MODEL && config.sttDiarization);
    if (!requestIdValid(requestId) || !['id', 'en'].includes(language) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Audio, a request ID and language id/en are required' });
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous, text: previous.text });
    if (store.hasEmptyAudioRequest(req.meetingId, req.speakerId, requestId)) return res.json({ success: true, text: '', entry: null });
    const allowedModels = availableSttModels(config);
    if (model && !allowedModels.includes(model)) return res.status(400).json({ error: 'Model transkripsi tidak tersedia di server' });
    if (!writable(req, res)) return;
    const key = `${req.meetingId}:${req.speakerId}:${requestId}`;
    if (!inFlightAudio.has(key)) {
      const work = (async () => {
        // Buffer meeting audio chunk immediately for post-meeting batch diarization
        if (!meetingAudios.has(req.meetingId)) meetingAudios.set(req.meetingId, []);
        const meetingChunks = meetingAudios.get(req.meetingId);
        if (meetingChunks.length < 200) {
          meetingChunks.push({ buffer: req.body, mimeType: req.get('Content-Type') || 'audio/webm', speakerId: req.speakerId });
        }

        const { text, segments } = await transcribeAudio(req.body, req.get('Content-Type') || '', language, { ...config, sttModel: model, sttDiarization: diarize }, fetchImpl);
        const meeting = store.get(req.meetingId);
        if (meeting.status !== 'active' || meeting.participants.get(req.speakerId).leftAt) throw new ServiceError('Meeting ended before audio could be saved', 409);
        if (!text) store.saveEmptyAudioRequest(req.meetingId, req.speakerId, requestId);
        return { success: true, text, entry: text ? store.append(req.meetingId, req.speakerId, text, requestId, segments, model) : null };
      })();
      inFlightAudio.set(key, work);
    }
    const work = inFlightAudio.get(key);
    try { res.json(await work); } finally { if (inFlightAudio.get(key) === work) inFlightAudio.delete(key); }
  }));

  async function summarizeMeeting(id) {
    const meeting = store.get(id);
    if (meeting.summary && meeting.summary.transcriptCount === meeting.transcripts.length) return meeting.summary;
    if (!inFlightSummarize.has(id)) {
      const task = (async () => {
        const snapshot = structuredClone(meeting);
        for (const entry of snapshot.transcripts) {
          entry.text = normalizeTranscriptText(entry.text);
          if (entry.segments) {
            for (const seg of entry.segments) {
              seg.text = normalizeTranscriptText(seg.text);
            }
          }
        }
        const summary = { ...await summarize(snapshot, config, fetchImpl), transcriptCount: snapshot.transcripts.length, generatedAt: new Date().toISOString() };
        const current = store.get(id);
        if (current && current.transcripts.length === snapshot.transcripts.length) {
          store.transact(() => {
            store.get(id).summary = summary;
            store.get(id).transcripts = snapshot.transcripts;
          });
        }

        // Persist to PostgreSQL database
        try {
          await saveMeeting(snapshot);
          await saveTranscripts(snapshot.id, snapshot.roomName, snapshot.transcripts);
          await saveAttendees(snapshot.id, [...snapshot.participants.values()]);
          const dbSummary = await saveMeetingSummary(snapshot.id, snapshot.roomName, summary);
          if (dbSummary) summary.dbSummaryId = dbSummary.id;
        } catch (dbErr) {
          console.warn('[DB] Could not persist meeting to database:', dbErr.message);
        }

        // Trigger outbound webhook if configured
        if (config.outboundWebhookUrl) {
          dispatchOutboundWebhook(config.outboundWebhookUrl, {
            event: 'meeting.summary.created',
            meetingId: snapshot.id,
            roomName: snapshot.roomName,
            summary,
            transcriptsCount: snapshot.transcripts.length,
            attendees: [...snapshot.participants.values()].map(publicParticipant),
            timestamp: new Date().toISOString(),
          });
        }

        return summary;
      })();
      inFlightSummarize.set(id, task);
    }

    const task = inFlightSummarize.get(id);
    try { return await task; }
    finally { if (inFlightSummarize.get(id) === task) inFlightSummarize.delete(id); }
  }

  const attendanceFinalizer = createAttendanceFinalizer({
    store,
    pendingAudio: id => [...inFlightAudio].filter(([key]) => key.startsWith(`${id}:`)).map(([, work]) => work),
    persist: async meeting => {
      postMeetingBatch.schedule(meeting.id);
      await saveMeeting(meeting);
      await saveAttendees(meeting.id, [...meeting.participants.values()]);
      if (meeting.transcripts.length) await saveTranscripts(meeting.id, meeting.roomName, meeting.transcripts);
    },
    summarize: summarizeMeeting,
  });

  app.get('/api/meetings/:id/post-meeting-batch', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ configured: postMeetingBatch.configured, requested: Boolean(store.get(req.meetingId).postMeetingBatchRequested), job: publicBatch(store.get(req.meetingId).postMeetingBatch) });
  });
  app.post('/api/meetings/:id/post-meeting-batch', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (req.speakerId !== meeting.hostId || req.auth?.user?.isGuest) return res.status(403).json({ error: 'Hanya host rapat yang dapat memulai batch Qwen.' });
    if (inFlightSummarize.has(meeting.id)) return res.status(409).json({ error: 'Tunggu pembuatan notulen live selesai sebelum memulai batch.' });
    const job = await postMeetingBatch.start(meeting.id, req.body?.language || 'id');
    res.status(job.status === 'done' ? 200 : 202).json({ job: publicBatch(job) });
  }));

  app.post('/api/meetings/:id/batch-diarize', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (!meeting) return res.status(404).json({ error: 'Rapat tidak ditemukan.' });
    const hasLive = () => meeting.transcripts.some(entry => [QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel));
    if (hasLive()) return res.status(409).json({ error: 'Transkrip live tidak dapat diganti dengan batch audio yang hanya memuat sebagian rapat.' });

    let audioBuffers = [];
    let mimeType = 'audio/webm';

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      audioBuffers = req.body;
      mimeType = req.get('Content-Type') || 'audio/wav';
    } else {
      const stored = meetingAudios.get(req.meetingId) || [];
      if (!stored.length) {
        return res.status(400).json({ error: 'Tidak ada rekaman audio pertemuan yang tersimpan untuk diarisasi.' });
      }
      audioBuffers = stored.map(s => s.buffer);
      mimeType = stored[0]?.mimeType || 'audio/webm';
    }

    const language = req.get('X-Speech-Language') || 'id';

    const result = await batchDiarizeAudio(audioBuffers, mimeType, language, config, fetchImpl);
    if (hasLive()) return res.status(409).json({ error: 'Transkrip Qwen Live masuk saat batch berjalan; transkrip rapat dipertahankan.' });
    if (!result.segments?.length) {
      return res.status(422).json({ error: 'Diarisasi pasca-rapat tidak menghasilkan segmen ucapan.' });
    }

    const host = meeting.participants.get(meeting.hostId) || { employeeName: 'Ruang Rapat' };
    const newTranscripts = result.segments.map(seg => ({
      id: randomUUID(),
      speakerId: req.speakerId || meeting.hostId,
      speakerName: host.employeeName,
      text: seg.text,
      timestamp: new Date(Date.now() - Math.max(0, (result.duration - seg.start) * 1000)).toISOString(),
      segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
      sttModel: 'nemotron-batch-diarization',
    }));

    store.transact(() => {
      meeting.transcripts = newTranscripts;
      meeting.summary = null;
    });

    try {
      await saveTranscripts(meeting.id, meeting.roomName, newTranscripts);
    } catch (dbErr) {
      console.warn('[DB] Could not update transcripts after batch diarization:', dbErr.message);
    }

    res.json({
      success: true,
      transcripts: newTranscripts,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      duration: result.duration,
    });
  }));

  app.post('/api/audio/batch-diarize', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'File audio diperlukan untuk batch diarization.' });
    }
    const mimeType = req.get('Content-Type') || 'audio/wav';
    const language = req.get('X-Speech-Language') || 'id';
    const roomName = req.get('X-Room-Name') || `batch-${Date.now().toString(36)}`;

    const result = await batchDiarizeAudio(req.body, mimeType, language, config, fetchImpl);

    const participant = {
      employeeId: 'BT-BATCH',
      employeeName: 'Audio Ingestion',
      department: 'Engineering',
      joinedAt: new Date().toISOString(),
      connected: false,
    };
    const joinResult = store.join(roomName, participant);
    const meeting = store.get(joinResult.meeting.id);

    const transcripts = result.segments.map(seg => ({
      id: randomUUID(),
      speakerId: 'BT-BATCH',
      speakerName: 'Audio Ingestion',
      text: seg.text,
      timestamp: new Date(Date.now() - Math.max(0, (result.duration - seg.start) * 1000)).toISOString(),
      segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
      sttModel: 'nemotron-batch-diarization',
    }));

    store.transact(() => {
      meeting.transcripts = transcripts;
    });

    const summary = await summarizeMeeting(meeting.id);

    res.json({
      success: true,
      meetingId: meeting.id,
      roomName: meeting.roomName,
      transcripts,
      summary,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      duration: result.duration,
    });
  }));

  app.post('/api/meetings/:id/summarize', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (meeting.postMeetingBatch?.status === 'done') return res.json({ success: true,
      summary: meeting.postMeetingBatch.summary, transcripts: meeting.postMeetingBatch.transcripts, meetingStatus: meeting.status });
    const shouldBatch = req.query.batchDiarize === 'true' || req.body?.batchDiarize === true;
    const hasLive = () => meeting.transcripts.some(entry => [QWEN_LIVE_MODEL,SEA_LIVE_MODEL].includes(entry.sttModel));

    if (shouldBatch && !hasLive() && meetingAudios.get(req.meetingId)?.length) {
      try {
        const stored = meetingAudios.get(req.meetingId);
        const language = req.get('X-Speech-Language') || 'id';
        const batchResult = await batchDiarizeAudio(stored.map(s => s.buffer), stored[0]?.mimeType || 'audio/webm', language, config, fetchImpl);
        if (batchResult.segments?.length && !hasLive()) {
          const host = meeting.participants.get(meeting.hostId) || { employeeName: 'Ruang Rapat' };
          const newTranscripts = batchResult.segments.map(seg => ({
            id: randomUUID(),
            speakerId: req.speakerId || meeting.hostId,
            speakerName: host.employeeName,
            text: seg.text,
            timestamp: new Date(Date.now() - Math.max(0, (batchResult.duration - seg.start) * 1000)).toISOString(),
            segments: [{ speaker: seg.speaker, text: seg.text, start: seg.start, end: seg.end }],
            sttModel: 'nemotron-batch-diarization',
          }));
          store.transact(() => {
            meeting.transcripts = newTranscripts;
            meeting.summary = null;
          });
          try { await saveTranscripts(meeting.id, meeting.roomName, newTranscripts); } catch (e) {}
        }
      } catch (batchErr) {
        console.warn('[Batch Diarize in Summarize Warning]', batchErr.message);
      }
    }

    if (!meeting.transcripts.length) return res.status(400).json({ error: 'No saved speech to summarize. Speak or add text first.' });
    const summary = await summarizeMeeting(req.meetingId);
    if (store.get(req.meetingId).attendanceFinalization?.status === 'failed') store.transact(() => {
      const final = store.get(req.meetingId).attendanceFinalization;
      final.status = 'complete'; final.error = null;
    });
    const rec = getMeetingRecordingInfo(req.meetingId, store.get(req.meetingId));
    res.json({
      success: true,
      summary,
      meetingStatus: store.get(req.meetingId).status,
      transcripts: store.get(req.meetingId).transcripts,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
    });
  }));

  // Persisted summaries and details from PostgreSQL + in-memory store
  app.get('/api/meetings/db-summaries', asyncRoute(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const summaries = await getMeetingSummaries(limit);

    const enrichedSummaries = summaries.map(s => {
      const rec = getMeetingRecordingInfo(s.meeting_id, store.get(s.meeting_id));
      return {
        ...s,
        hasRecording: rec.hasRecording,
        recordingSize: rec.fileSize || null,
      };
    });

    const inProgress = [];
    if (store && store.meetings) {
      for (const [id, meeting] of store.meetings.entries()) {
        if (inFlightSummarize.has(id)) {
          const rec = getMeetingRecordingInfo(id, meeting);
          inProgress.push({
            meetingId: id,
            roomName: meeting.roomName,
            status: 'summarizing',
            transcriptCount: meeting.transcripts.length,
            participants: [...meeting.participants.values()].map(publicParticipant),
            createdAt: meeting.createdAt,
            hasRecording: rec.hasRecording,
            recordingSize: rec.fileSize || null,
          });
        }
      }
    }

    res.json({
      success: true,
      count: enrichedSummaries.length,
      databaseConnected: isDbConnected(),
      inProgress,
      summaries: enrichedSummaries,
    });
  }));

  app.get('/api/meetings/db-details/:meetingId', asyncRoute(async (req, res) => {
    const details = await getMeetingDetails(req.params.meetingId);
    const storeMeeting = store.get(req.params.meetingId);
    const rec = getMeetingRecordingInfo(req.params.meetingId, storeMeeting);

    if (!details) {
      if (storeMeeting) {
        return res.json({
          success: true,
          meeting: {
            id: storeMeeting.id,
            room_name: storeMeeting.roomName,
            status: storeMeeting.status,
            created_at: storeMeeting.createdAt,
            ended_at: storeMeeting.endedAt,
          },
          summary: storeMeeting.postMeetingBatch?.status === 'done' ? storeMeeting.postMeetingBatch.summary : storeMeeting.summary,
          transcripts: storeMeeting.postMeetingBatch?.status === 'done' ? storeMeeting.postMeetingBatch.transcripts : storeMeeting.transcripts,
          postMeetingBatch: publicBatch(storeMeeting.postMeetingBatch),
          attendees: [...storeMeeting.participants.values()].map(publicParticipant),
          hasRecording: rec.hasRecording,
          recordingSize: rec.fileSize || null,
        });
      }
      return res.status(404).json({ error: 'Meeting not found in database', meetingId: req.params.meetingId });
    }
    res.json({
      success: true,
      ...details,
      hasRecording: rec.hasRecording,
      recordingSize: rec.fileSize || null,
    });
  }));

    // Meeting report export authorization.
  // Export routes are outside the single-segment /api/meetings/:id middleware,
  // so they verify the meeting token explicitly.
  async function authorizeExport(req, res, meetingId) {
    const meeting = store.get(meetingId);

    if (!meeting) {
      res.status(404).json({ error: 'Meeting session not found' });
      return null;
    }

    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    if (!token) {
      res.status(401).json({ error: 'A meeting token is required' });
      return null;
    }

    let claims;

    try {
      claims = await verifier.verify(token);
    } catch {
      res.status(401).json({ error: 'Meeting token is invalid or expired' });
      return null;
    }

    if (
      claims.video?.room !== meeting.livekitRoom ||
      !claims.video?.roomJoin ||
      !meeting.participants.has(claims.sub)
    ) {
      res.status(403).json({ error: 'This token cannot access the meeting' });
      return null;
    }

    return meeting;
  }

  // Structured meeting report export.
  app.get('/api/meetings/:meetingId/export/json', asyncRoute(async (req, res) => {
    const meeting = await authorizeExport(req, res, req.params.meetingId);
    if (!meeting) return;

    const details = await getMeetingDetails(req.params.meetingId);

    if (!details) {
      return res.status(404).json({
        error: 'Meeting report is not available in database',
        meetingId: req.params.meetingId,
      });
    }

    const filename = `balicall-meeting-${req.params.meetingId}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json({
      exportType: 'meeting-report',
      exportedAt: new Date().toISOString(),
      meeting: details.meeting,
      summary: details.summary,
      attendees: details.attendees,
      transcripts: details.transcripts,
    });
  }));

  // Formal meeting minutes PDF export.
  app.get('/api/meetings/:meetingId/export/pdf', asyncRoute(async (req, res) => {
    const meeting = await authorizeExport(req, res, req.params.meetingId);
    if (!meeting) return;

    const details = await getMeetingDetails(req.params.meetingId);

    if (!details) {
      return res.status(404).json({
        error: 'Meeting report is not available in database',
        meetingId: req.params.meetingId,
      });
    }

    const summary = details.summary || {};
    const attendees = Array.isArray(details.attendees) ? details.attendees : [];
    const transcripts = Array.isArray(details.transcripts) ? details.transcripts : [];

    const discussionPoints = asArray(summary.key_discussion_points);
    const decisions = asArray(summary.decisions);
    const actionItems = asArray(summary.action_items);
    const attendanceSummary = asArray(summary.attendance_summary);

    const filename = `balicall-meeting-${req.params.meetingId}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: 50,
        bottom: 50,
        left: 55,
        right: 55,
      },
      info: {
        Title: pdfText(summary.title || `Notulen ${details.meeting?.room_name || 'Meeting'}`),
        Author: 'BaliCall',
        Subject: 'Formal Meeting Minutes',
      },
    });

    doc.pipe(res);

    const pageWidth = 485;

    const heading = (title, level = 1) => {
      if (level === 1) {
        doc
          .moveDown(0.8)
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(title)
          .moveDown(0.35);
      } else {
        doc
          .moveDown(0.45)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(title)
          .moveDown(0.2);
      }
    };

    const bulletList = items => {
      if (!items.length) {
        doc.font('Helvetica').fontSize(10).text('Tidak ada data yang tercatat.');
        return;
      }

      items.forEach(item => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`• ${pdfText(item)}`, {
            width: pageWidth,
            lineGap: 3,
          });
      });
    };

    const numberedList = items => {
      if (!items.length) {
        doc.font('Helvetica').fontSize(10).text('Tidak ada data yang tercatat.');
        return;
      }

      items.forEach((item, index) => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`${index + 1}. ${pdfText(item)}`, {
            width: pageWidth,
            lineGap: 3,
          });
      });
    };

    // Header
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('BaliCall', { align: 'center' });

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Bali Tower Sentra — Internal Meeting & AI Minutes', { align: 'center' })
      .moveDown(0.8);

    doc
      .moveTo(55, doc.y)
      .lineTo(540, doc.y)
      .stroke()
      .moveDown(0.8);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pdfText(summary.title || 'Notulen Rapat'), {
        align: 'center',
      })
      .moveDown(0.7);

    // Meeting metadata
    const meetingDate = details.meeting?.created_at
      ? new Date(details.meeting.created_at).toLocaleString('id-ID')
      : '-';

    const endedDate = details.meeting?.ended_at
      ? new Date(details.meeting.ended_at).toLocaleString('id-ID')
      : '-';

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`Ruang Rapat: ${pdfText(details.meeting?.room_name || meeting.roomName || '-')}`)
      .text(`Meeting ID: ${req.params.meetingId}`)
      .text(`Dimulai: ${meetingDate}`)
      .text(`Selesai: ${endedDate}`)
      .text(`Layanan AI: ${pdfText(summary.provider || 'Tidak diketahui')}`)
      .text(`Jumlah Ucapan: ${transcripts.length}`)
      .moveDown(0.5);

    heading('1. Ringkasan Rapat');
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(pdfText(summary.executive_summary || 'Belum tersedia.'), {
        width: pageWidth,
        align: 'justify',
        lineGap: 3,
      });

    heading('2. Pokok Pembahasan');
    bulletList(discussionPoints);

    heading('3. Keputusan Rapat');
    numberedList(decisions);

    heading('4. Tindak Lanjut');

    if (!actionItems.length) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Tidak ada tindak lanjut yang tercatat.');
    } else {
      actionItems.forEach((item, index) => {
        const task = typeof item === 'object' ? item.task : item;
        const assignee = typeof item === 'object' ? item.assignee : '';
        const priority = typeof item === 'object' ? item.priority : '';
        const deadline = typeof item === 'object' ? item.deadline : '';

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${index + 1}. ${pdfText(task || 'Tugas tidak ditentukan')}`);

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`   PIC / Penanggung jawab: ${pdfText(assignee || 'Belum ditentukan')}`)
          .text(`   Prioritas: ${pdfText(priority || 'Belum ditentukan')}`)
          .text(`   Tenggat / Syarat: ${pdfText(deadline || 'Belum ditentukan')}`)
          .moveDown(0.25);
      });
    }

    heading('5. Kehadiran');

    if (attendanceSummary.length) {
      bulletList(attendanceSummary);
    } else if (attendees.length) {
      attendees.forEach(attendee => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(
            `• ${pdfText(attendee.employee_name || attendee.employee_id || 'Peserta')} — ${pdfText(attendee.department || 'Departemen tidak tersedia')}`,
            { lineGap: 3 },
          );
      });
    } else {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Data peserta tidak tersedia.');
    }

    heading('6. Pengesahan');

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        'Dokumen ini merupakan hasil pencatatan rapat dan peringkasan berbantuan AI. ' +
        'Dokumen dapat digunakan sebagai draft notulen untuk ditinjau dan disahkan oleh pihak yang berwenang.'
      )
      .moveDown(1.2);

    // Signature area
    const signatureY = doc.y;

    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Disusun oleh,', 75, signatureY)
      .text('Disetujui oleh,', 355, signatureY);

    doc
      .moveTo(75, signatureY + 65)
      .lineTo(225, signatureY + 65)
      .stroke();

    doc
      .moveTo(355, signatureY + 65)
      .lineTo(505, signatureY + 65)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('BaliCall / AI Meeting Assistant', 75, signatureY + 72)
      .text('Pihak yang berwenang', 355, signatureY + 72);

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#666666')
      .text(
        `Diekspor pada ${new Date().toLocaleString('id-ID')}`,
        55,
        780,
        { width: pageWidth, align: 'center' },
      );

    doc.end();
  }));

  // Inbound LiveKit Webhook Receiver
  app.post('/api/livekit/webhook', asyncRoute(async (req, res) => {
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const authHeader = req.headers['authorization'] || req.headers['authorize'];
    let event;

    try {
      event = await webhookReceiver.receive(rawBody, authHeader);
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Unauthorized webhook signature' });
    }

    const logItem = {
      id: `wh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      time: new Date().toISOString(),
      event: event.event,
      roomName: event.room?.name || 'N/A',
      participant: event.participant?.name || event.participant?.identity || 'N/A',
      details: { roomSid: event.room?.sid, participantIdentity: event.participant?.identity },
    };
    webhookLogs.unshift(logItem);
    if (webhookLogs.length > 50) webhookLogs.pop();

    const applied = store.applyLivekitEvent(event, config.attendanceGraceMs ?? 10000);
    if (applied.meetingId) postMeetingBatch.schedule(applied.meetingId);
    if (applied.meetingId && !applied.duplicate) {
      const meeting = store.get(applied.meetingId);
      await saveMeeting(meeting);
      await saveAttendees(meeting.id, [...meeting.participants.values()]);
    }
    if (applied.finalize || applied.duplicate) attendanceFinalizer.enqueue(applied.meetingId);
    res.json({ success: true, event: event.event, ...applied });
  }));

  app.get('/api/livekit/webhooks', (_req, res) => {
    res.json({ success: true, count: webhookLogs.length, logs: webhookLogs });
  });

  // Outbound Webhook Manual Dispatcher
  app.post('/api/meetings/:id/dispatch-webhook', asyncRoute(async (req, res) => {
    const meeting = store.get(req.params.id);
    const targetUrl = req.body?.targetUrl || config.outboundWebhookUrl;
    if (!targetUrl) return res.status(400).json({ error: 'No targetUrl provided in request body or OUTBOUND_WEBHOOK_URL config' });

    const payload = {
      event: 'meeting.summary.dispatched',
      meetingId: req.params.id,
      roomName: meeting?.roomName || null,
      summary: meeting?.summary || req.body?.summary || null,
      dispatchedAt: new Date().toISOString(),
    };

    const response = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.json({ success: true, targetUrl, status: response.status });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));

  if (existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }

  app.use((error, req, res, _next) => {
    if (res.headersSent) return _next(error);
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('API request failed:', {requestId:req.requestId,method:req.method,path:req.route?.path||req.path,status,message:error.message});
    res.status(status).json({ error: status === 500 ? 'Server could not complete the request. Check service logs and data storage.' : error.message,requestId:req.requestId });
  });

  return { app, store, notificationTick:()=>notifications?.tick(), close(){postMeetingBatch.close();attendanceFinalizer.close();notifications?.close();} };
}
