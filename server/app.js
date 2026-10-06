import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
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
} from './db.js';

const nonEmpty = (value, max = 160) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const requestIdValid = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createApp(config, { fetchImpl = fetch, livekitProbe } = {}) {
  const app = express();
  const store = new MeetingStore(config.dataFile);
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const webhookReceiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);
  const roomService = new RoomServiceClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret, { requestTimeout: 1.5 });
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

  app.post('/api/meetings/:id/leave', (req, res) => {
    res.json({ success: true, status: store.leave(req.meetingId, req.speakerId).status });
  });

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
