import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier, RoomServiceClient } from 'livekit-server-sdk';
import { MeetingStore } from './meetingStore.js';
import { effectiveLlm, ServiceError, summarize, transcribeAudio } from './providers.js';

const nonEmpty = (value, max = 160) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const requestIdValid = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createApp(config, { fetchImpl = fetch, livekitProbe } = {}) {
  const app = express();
  const store = new MeetingStore(config.dataFile);
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const roomService = new RoomServiceClient(config.livekitInternalUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret, { requestTimeout: 1.5 });
  const probe = livekitProbe || (() => roomService.listRooms());
  const inFlightAudio = new Map();
  app.use(cors({ origin(origin, callback) {
    callback(null, !origin || config.corsOrigins.includes(origin));
  } }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', asyncRoute(async (_req, res) => {
    let livekitStatus = 'unavailable';
    try { await probe(); livekitStatus = 'reachable'; } catch { /* API health is independent of SFU. */ }
    const llmEffectiveProvider = effectiveLlm(config);
    res.json({ status: 'ok', livekitUrl: config.livekitUrl, livekitStatus,
      llmProvider: config.llmProvider, llmModel: config.llmModel,
      llmEffectiveProvider, hasLlmKey: llmEffectiveProvider !== 'demo',
      sttProvider: config.sttProvider, sttConfigured: Boolean(config.sttBaseUrl && config.sttModel) });
  }));

  app.post('/api/token', asyncRoute(async (req, res) => {
    const { roomName, employeeId, employeeName, department = 'General' } = req.body || {};
    if (![roomName, employeeId, employeeName, department].every(value => nonEmpty(value))) return res.status(400).json({ error: 'Room, employee ID, name and department must be non-empty strings (max 160 characters)' });
    const active = [...store.meetings.values()].find(meeting => meeting.roomName === roomName.trim() && meeting.status === 'active');
    const duplicate = active?.participants.get(employeeId.trim());
    if (duplicate && !duplicate.leftAt && Date.now() - Date.parse(duplicate.lastSeen) < 45000) return res.status(409).json({ error: 'This employee is already joining or connected. Use a different identity for another test window.' });
    const meeting = store.join(roomName.trim(), { employeeId: employeeId.trim(), employeeName: employeeName.trim(), department: department.trim() });
    const at = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: employeeId.trim(), name: employeeName.trim(), ttl: '12h',
      metadata: JSON.stringify({ meetingId: meeting.id, department: department.trim() }) });
    at.addGrant({ room: meeting.livekitRoom, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ token: await at.toJwt(), url: config.livekitUrl, roomName: meeting.roomName, meetingId: meeting.id, sttProvider: config.sttProvider });
  }));

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
    res.json({ success: true, summary, meetingStatus: current.status });
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
