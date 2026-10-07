import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient, WebhookReceiver, EgressClient } from 'livekit-server-sdk';
import { MeetingStore } from './meetingStore.js';
import { effectiveLlm, ServiceError, summarize, transcribeAudio } from './providers.js';
import {
  isDbConnected,
  saveMeeting,
  saveMeetingSummary,
  saveTranscripts,
  saveAttendees,
  getMeetingSummaries,
  getMeetingDetails,
  verifyEmployeeId,
  getAllEmployees,
  createSchedule,
  getUpcomingSchedules,
  cancelSchedule,
} from './db.js';

const nonEmpty = (value, max = 160) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const requestIdValid = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

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

export function createApp(config, { fetchImpl = fetch, livekitProbe } = {}) {
  const app = express();
  const store = new MeetingStore(config.dataFile);
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const webhookReceiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);
  const roomService = new RoomServiceClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret, { requestTimeout: 1.5 });
  const egressClient = new EgressClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret);
  const probe = livekitProbe || (() => roomService.listRooms());
  const inFlightAudio = new Map();
  const webhookLogs = [];

  app.use(cors({ origin(origin, callback) {
    callback(null, !origin || config.corsOrigins.includes(origin));
  } }));

  // Preserve rawBody buffer for LiveKit cryptographic webhook signature verification
  app.use(express.json({
    limit: '256kb',
    verify: (req, _res, buf) => {
      req.rawBody = buf ? buf.toString('utf8') : '';
    },
  }));

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
    res.json({
      status: 'ok',
      livekitUrl: config.livekitUrl,
      livekitStatus,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      llmEffectiveProvider,
      hasLlmKey: llmEffectiveProvider !== 'demo',
      sttProvider: config.sttProvider,
      sttConfigured: Boolean(config.sttBaseUrl && config.sttModel),
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
    let { roomName, employeeId, employeeName, department = 'General' } = req.body || {};
    if (![roomName, employeeId, employeeName, department].every(value => nonEmpty(value))) {
      return res.status(400).json({ error: 'Room, employee ID, name and department must be non-empty strings (max 160 characters)' });
    }

    const cleanId = employeeId.trim();

    // Verify employee ID format and database registration
    if (config.verifyEmployeeId) {
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
    }

    const active = [...store.meetings.values()].find(meeting => meeting.roomName === roomName.trim() && meeting.status === 'active');
    const duplicate = active?.participants.get(cleanId);
    if (duplicate && !duplicate.leftAt && Date.now() - Date.parse(duplicate.lastSeen) < 45000) {
      return res.status(409).json({ error: 'This employee is already joining or connected. Use a different identity for another test window.' });
    }
    const meeting = store.join(roomName.trim(), { employeeId: cleanId, employeeName: employeeName.trim(), department: department.trim() });
    
    // Asynchronously record meeting in PostgreSQL if configured
    saveMeeting({ id: meeting.id, roomName: meeting.roomName, status: 'active', createdAt: meeting.createdAt }).catch(() => {});

    const at = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: cleanId, name: employeeName.trim(), ttl: '12h',
      metadata: JSON.stringify({ meetingId: meeting.id, department: department.trim(), employeeId: cleanId }) });
    at.addGrant({ room: meeting.livekitRoom, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ token: await at.toJwt(), url: config.livekitUrl, roomName: meeting.roomName, meetingId: meeting.id, sttProvider: config.sttProvider });
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
    const ok = await cancelSchedule(id);
    if (!ok) {
      return res.status(404).json({ error: 'Jadwal rapat tidak ditemukan atau sudah dibatalkan.' });
    }
    res.json({ success: true, message: 'Jadwal rapat berhasil dibatalkan.' });
  }));

  // Meeting authorization middleware
  app.use('/api/meetings/:id', asyncRoute(async (req, res, next) => {
    const meeting = store.get(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting session not found' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'A meeting token is required' });
    let claims;
    try { claims = await verifier.verify(token); } catch { return res.status(401).json({ error: 'Meeting token is invalid or expired' }); }
    if (claims.video?.room !== meeting.livekitRoom || !claims.video?.roomJoin || !meeting.participants.has(claims.sub)) return res.status(403).json({ error: 'This token cannot access the meeting' });
    req.meetingId = meeting.id;
    req.speakerId = claims.sub;
    next();
  }));

  function writable(req, res) {
    const meeting = store.get(req.meetingId);
    if (meeting.status !== 'active' || meeting.participants.get(req.speakerId).leftAt) {
      res.status(409).json({ error: 'You have left this meeting. Start or join another session to add speech.' });
      return false;
    }
    return true;
  }

  app.get('/api/meetings/:id/transcript', (req, res) => {
    const meeting = store.get(req.meetingId);
    res.json({ meetingId: meeting.id, roomName: meeting.roomName, status: meeting.status,
      transcripts: meeting.transcripts, participants: [...meeting.participants.values()], summary: meeting.summary });
  });

  app.post('/api/meetings/:id/transcript', (req, res) => {
    const { text, requestId = randomUUID() } = req.body || {};
    if (!nonEmpty(text, 10000) || !requestIdValid(requestId)) return res.status(400).json({ error: 'Non-empty text and a valid requestId are required' });
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous });
    if (!writable(req, res)) return;
    res.json({ success: true, entry: store.append(req.meetingId, req.speakerId, text, requestId) });
  });

  app.post('/api/meetings/:id/presence', (req, res) => {
    if (typeof req.body?.connected !== 'boolean') return res.status(400).json({ error: 'connected must be boolean' });
    if (!writable(req, res)) return;
    res.json({ participant: store.presence(req.meetingId, req.speakerId, req.body.connected) });
  });

  app.post('/api/meetings/:id/recording/start', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);

    if (meeting.status !== 'active') {
      return res.status(409).json({ error: 'Meeting sudah selesai.' });
    }

    if (meeting.recording?.status === 'active') {
      return res.status(409).json({
        error: 'Recording sudah berjalan.',
        recording: meeting.recording,
      });
    }

    const filepath = `/out/${meeting.livekitRoom}.mp4`;

    const result = await egressClient.startRoomCompositeEgress(
      meeting.livekitRoom,
      {
        file: {
          filepath,
          fileType: 1,
        },
      },
    );

    const recording = {
      egressId: result.egressId,
      status: 'active',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      filepath,
    };

    store.transact(() => {
      store.get(req.meetingId).recording = recording;
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
    const meeting = store.get(req.meetingId);
    const recording = meeting.recording;

    if (!recording?.egressId || recording.status !== 'active') {
      return res.status(409).json({
        error: 'Tidak ada recording yang sedang berjalan.',
      });
    }

    await egressClient.stopEgress(recording.egressId);

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

  app.post('/api/meetings/:id/audio', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '5mb' }), asyncRoute(async (req, res) => {
    const requestId = req.get('X-Request-Id');
    const language = req.get('X-Speech-Language') || 'id';
    if (!requestIdValid(requestId) || !['id', 'en'].includes(language) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Audio, a request ID and language id/en are required' });
    const previous = store.findEntry(store.get(req.meetingId), req.speakerId, requestId);
    if (previous) return res.json({ success: true, entry: previous, text: previous.text });
    if (store.hasEmptyAudioRequest(req.meetingId, req.speakerId, requestId)) return res.json({ success: true, text: '', entry: null });
    if (!writable(req, res)) return;
    const key = `${req.meetingId}:${req.speakerId}:${requestId}`;
    if (!inFlightAudio.has(key)) {
      const work = (async () => {
        const text = await transcribeAudio(req.body, req.get('Content-Type') || '', language, config, fetchImpl);
        const meeting = store.get(req.meetingId);
        if (meeting.status !== 'active' || meeting.participants.get(req.speakerId).leftAt) throw new ServiceError('Meeting ended before audio could be saved', 409);
        if (!text) store.saveEmptyAudioRequest(req.meetingId, req.speakerId, requestId);
        return { success: true, text, entry: text ? store.append(req.meetingId, req.speakerId, text, requestId) : null };
      })();
      inFlightAudio.set(key, work);
    }
    const work = inFlightAudio.get(key);
    try { res.json(await work); } finally { if (inFlightAudio.get(key) === work) inFlightAudio.delete(key); }
  }));

  app.post('/api/meetings/:id/summarize', asyncRoute(async (req, res) => {
    const meeting = store.get(req.meetingId);
    if (!meeting.transcripts.length) return res.status(400).json({ error: 'No saved speech to summarize. Speak or add text first.' });
    const snapshot = structuredClone(meeting);
    const summary = { ...await summarize(snapshot, config, fetchImpl), transcriptCount: snapshot.transcripts.length, generatedAt: new Date().toISOString() };
    const current = store.get(req.meetingId);
    if (current.transcripts.length === snapshot.transcripts.length) store.transact(() => { store.get(req.meetingId).summary = summary; });

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
        attendees: [...snapshot.participants.values()],
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, summary, meetingStatus: current.status });
  }));

  // Persisted summaries and details from PostgreSQL
  app.get('/api/meetings/db-summaries', asyncRoute(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const summaries = await getMeetingSummaries(limit);
    res.json({
      success: true,
      count: summaries.length,
      databaseConnected: isDbConnected(),
      summaries,
    });
  }));

  app.get('/api/meetings/db-details/:meetingId', asyncRoute(async (req, res) => {
    const details = await getMeetingDetails(req.params.meetingId);
    if (!details) {
      return res.status(404).json({ error: 'Meeting not found in database', meetingId: req.params.meetingId });
    }
    res.json({ success: true, ...details });
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
          .text(`   Penanggung jawab: ${pdfText(assignee || 'Belum ditentukan')}`)
          .text(`   Prioritas: ${pdfText(priority || 'Belum ditentukan')}`)
          .text(`   Tenggat: ${pdfText(deadline || 'Belum ditentukan')}`)
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
    const isDev = process.env.NODE_ENV !== 'production';

    try {
      event = await webhookReceiver.receive(rawBody, authHeader);
    } catch (verifyErr) {
      if (isDev && req.body?.event) {
        event = req.body;
      } else {
        return res.status(401).json({ error: 'Unauthorized webhook signature', details: verifyErr.message });
      }
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

    res.json({ success: true, event: event.event });
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

  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('API request failed:', error.message);
    res.status(status).json({ error: status === 500 ? 'Server could not complete the request. Check service logs and data storage.' : error.message });
  });

  return { app, store };
}
