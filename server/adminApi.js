import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { AdminPermission, PgAdminStore, validAdminEmployeeId } from './adminStore.js';
import { compileAdminMeetings, compileLiveMeetingMonitor, readAdminSystem, readLiveKitRooms } from './adminMonitoring.js';

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!permissions.every(permission => req.admin.permissions.includes(permission))) {
      return res.status(403).json({ error: 'Izin admin untuk tindakan ini diperlukan.' });
    }
    next();
  };
}

function sendOutcome(res, outcome, status = 200) {
  if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.reason });
  res.status(status).json({ success: true, changed: outcome.changed, ...(outcome.invite && { invite: outcome.invite }) });
}

function isAdminDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function attachAdminApi(app, config, { meetingStore, probe, fetchImpl, recordingCapabilities, postMeetingBatch, retryUpload, deleteRecording, roomService }) {
  const router = Router();
  const store = new PgAdminStore();
  const hostNameForMeeting = id => {
    const meeting = meetingStore.meetings.get(id);
    return meeting?.participants.get(meeting.hostId)?.employeeName?.trim() || null;
  };
  router.use(asyncRoute(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!config.authEnabled) return res.status(503).json({ error: 'Admin memerlukan autentikasi akun karyawan.' });
    const user = req.auth?.user;
    if (!user) return res.status(401).json({ error: 'Silakan masuk untuk melanjutkan.' });
    if (user.isGuest) return res.status(403).json({ error: 'Akses Super Admin diperlukan.' });
    const permissions = await store.permissions(user.employeeId);
    if (!permissions.length) return res.status(403).json({ error: 'Akses Super Admin diperlukan.' });
    req.admin = { employeeId: user.employeeId, permissions };
    next();
  }));

  router.get('/access', (req, res) => res.json({
    role: 'super_admin', employeeId: req.admin.employeeId, permissions: req.admin.permissions,
  }));
  const parseAuditQuery = query => {
    const { from = '', to = '', action = '', q = '', result = '', actorId = '', order = 'desc', page = '1', pageSize = '50', format = '' } = query;
    if ((from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))) {
      return { error: 'Tanggal audit tidak valid.' };
    }
    if (from && to && from > to) {
      return { error: 'Tanggal akhir tidak boleh sebelum tanggal awal.' };
    }
    if (typeof action !== 'string' || (action !== '' && !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(action))
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
      return { error: 'Jenis tindakan atau nomor halaman tidak valid.' };
    }
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')) {
      return { error: 'Kata kunci pencarian tidak valid.' };
    }
    if (typeof result !== 'string' || (result !== '' && !['succeeded', 'denied', 'no_change', 'failed'].includes(result))) {
      return { error: 'Status hasil tidak valid.' };
    }
    if (typeof actorId !== 'string' || (actorId !== '' && actorId !== 'system' && !validAdminEmployeeId(actorId))) {
      return { error: 'ID pelaku tidak valid.' };
    }
    if (typeof order !== 'string' || !['asc', 'desc'].includes(order)) {
      return { error: 'Urutan data tidak valid.' };
    }
    if (typeof pageSize !== 'string' || !['10', '25', '50', '100'].includes(pageSize)) {
      return { error: 'Ukuran halaman tidak valid.' };
    }
    return {
      params: {
        from: from || null,
        to: to || null,
        action,
        search: q.trim(),
        result,
        actorId,
        order,
        page: Number(page),
        pageSize: Number(pageSize),
        format,
      },
    };
  };

  router.get('/audit/export', requirePermission(AdminPermission.READ_AUDIT), asyncRoute(async (req, res) => {
    const parsed = parseAuditQuery({ ...req.query, pageSize: '100' });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const csv = await store.exportAuditCsv(parsed.params);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-admin.csv"');
    res.send(csv);
  }));

  router.get('/audit', requirePermission(AdminPermission.READ_AUDIT), asyncRoute(async (req, res) => {
    const parsed = parseAuditQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.params.format === 'csv') {
      const csv = await store.exportAuditCsv(parsed.params);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-admin.csv"');
      return res.send(csv);
    }
    res.json(await store.listAudit(parsed.params));
  }));
  router.get('/meetings', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (_req, res) => {
    const [history, schedules, rooms] = await Promise.all([
      store.listMeetingMetadata(), store.listScheduleMetadata(), readLiveKitRooms(probe),
    ]);
    res.json(compileAdminMeetings({ history, schedules, rooms, snapshots: meetingStore.meetings.values() }));
  }));

  const handleLiveMonitor = asyncRoute(async (_req, res) => {
    const [rooms, schedules, activeSessions] = await Promise.all([
      readLiveKitRooms(probe),
      store.listScheduleMetadata().catch(() => []),
      store.getActiveObserverSessions().catch(() => []),
    ]);
    const data = compileLiveMeetingMonitor({
      snapshots: [...meetingStore.meetings.values()],
      rooms,
      activeSessions,
      schedules,
    });
    res.json(data);
  });

  router.get('/live-monitor', requirePermission(AdminPermission.READ_MEETINGS), handleLiveMonitor);
  router.get('/live-monitor/meetings', requirePermission(AdminPermission.READ_MEETINGS), handleLiveMonitor);

  router.get('/live-monitor/meetings/:id', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { id } = req.params;
    const meeting = meetingStore.meetings.get(id) || [...meetingStore.meetings.values()].find(m => m.id === id || m.roomCode === id);
    if (!meeting) {
      return res.status(404).json({ error: 'Rapat tidak ditemukan.' });
    }
    const [rooms, activeSessions, sessionHistory] = await Promise.all([
      readLiveKitRooms(probe),
      store.getActiveObserverSessions(meeting.id).catch(() => []),
      store.listObserverSessions({ meetingId: meeting.id, pageSize: 20 }).catch(() => ({ sessions: [] })),
    ]);
    const attendees = [...meeting.participants.values()].filter(p => !p.leftAt).map(p => ({
      employeeId: p.employeeId,
      employeeName: p.employeeName,
      department: p.department,
      joinedAt: p.joinedAt,
      isHost: p.employeeId === meeting.hostId,
      isCoHost: (meeting.coHostIds || []).includes(p.employeeId),
      isGuest: Boolean(p.isGuest),
      moderatorMuted: Boolean(p.moderatorMuted),
    }));
    const connectedRooms = new Map((rooms ?? []).map(r => [r.name, r.numParticipants]));
    const liveCount = rooms ? connectedRooms.get(meeting.livekitRoom ?? `meeting-${meeting.id}`) ?? attendees.length : attendees.length;

    res.json({
      meeting: {
        id: meeting.id,
        roomName: meeting.roomName,
        roomCode: meeting.roomCode,
        hostId: meeting.hostId,
        hostName: meeting.participants.get(meeting.hostId)?.employeeName || meeting.hostId,
        status: meeting.status,
        createdAt: meeting.createdAt,
        livekitRoom: meeting.livekitRoom,
        participantCount: liveCount,
        isMonitored: Boolean(meeting.isMonitored || activeSessions.length > 0),
        activeObserverCount: activeSessions.length,
      },
      participants: attendees,
      activeObserverSessions: activeSessions,
      observerHistory: sessionHistory.sessions,
      connectionHealth: rooms ? 'healthy' : 'unavailable',
    });
  }));

  router.post('/observer/sessions', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const rawMeetingId = req.body?.meetingId || req.query?.meetingId;
    const meetingId = typeof rawMeetingId === 'string' ? rawMeetingId.trim() : '';
    if (!meetingId) {
      return res.status(400).json({ error: 'ID rapat (meetingId) diperlukan.' });
    }
    const rawReason = req.body?.accessReason || req.query?.accessReason;
    const cleanReason = typeof rawReason === 'string' ? rawReason.trim() : '';
    if (cleanReason.length < 5) {
      await store.recordAudit({
        actorId: req.admin.employeeId,
        targetId: meetingId,
        action: 'observer.session.denied',
        result: 'denied',
        reason: 'Alasan akses tidak memenuhi ketentuan audit kepatuhan (minimal 5 karakter)',
      }).catch(() => {});
      return res.status(400).json({
        error: 'Alasan akses (access reason) wajib diisi minimal 5 karakter sesuai kebijakan kepatuhan organisasi.',
      });
    }

    const meeting = meetingStore.meetings.get(meetingId)
      || [...meetingStore.meetings.values()].find(m => m.id === meetingId || m.roomCode === meetingId || m.roomName === meetingId || m.livekitRoom === meetingId);
    if (!meeting || meeting.status !== 'active') {
      await store.recordAudit({
        actorId: req.admin.employeeId,
        targetId: meetingId,
        action: 'observer.session.denied',
        result: 'denied',
        reason: 'Rapat tidak aktif atau tidak ditemukan',
      }).catch(() => {});
      return res.status(404).json({ error: 'Rapat tidak aktif atau tidak ditemukan.' });
    }

    const observerId = randomUUID();
    const session = await store.createObserverSession({
      observerId,
      adminUserId: req.admin.employeeId,
      meetingId: meeting.id,
      accessReason: cleanReason,
      durationMinutes: 60,
    });

    await store.recordAudit({
      actorId: req.admin.employeeId,
      targetId: meeting.id,
      action: 'observer.session.start',
      result: 'succeeded',
      newValue: observerId,
      reason: cleanReason,
    }).catch(err => console.warn('[OBSERVER] Audit log failed:', err.message));

    meeting.activeObserverCount = (meeting.activeObserverCount || 0) + 1;
    meeting.isMonitored = true;
    if (roomService?.updateRoomMetadata) {
      await roomService.updateRoomMetadata(meeting.livekitRoom, JSON.stringify({
        isMonitored: true,
        monitoredAt: new Date().toISOString(),
        disclosureNotice: 'Sesi ini sedang dipantau oleh Administrator Kepatuhan Perusahaan sesuai kebijakan organisasi.',
      })).catch(err => console.warn('[OBSERVER] Room metadata update warning:', err.message));
    }

    const observerIdentity = `observer-${req.admin.employeeId}-${observerId.slice(0, 8)}`;
    const at = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: observerIdentity,
      name: `Private Observer (${req.admin.employeeId})`,
      ttl: '1h',
      metadata: JSON.stringify({
        isObserver: true,
        observerId,
        meetingId: meeting.id,
        adminUserId: req.admin.employeeId,
        readOnly: true,
      }),
    });
    at.addGrant({
      room: meeting.livekitRoom,
      roomJoin: true,
      canPublish: false,
      canPublishData: false,
      canPublishSources: [],
      canSubscribe: true,
      hidden: true,
    });
    const token = await at.toJwt();

    res.status(201).json({
      success: true,
      observerId,
      meetingId: meeting.id,
      roomName: meeting.roomName,
      roomCode: meeting.roomCode,
      hostName: meeting.participants.get(meeting.hostId)?.employeeName || meeting.hostId,
      token,
      url: config.livekitUrl,
      livekitRoom: meeting.livekitRoom,
      expiresAt: session.expiresAt,
      session,
    });
  }));

  router.post('/observer/sessions/:observerId/end', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { observerId } = req.params;
    if (!observerId || typeof observerId !== 'string') {
      return res.status(400).json({ error: 'ID sesi pemantau tidak valid.' });
    }
    const session = await store.getObserverSession(observerId);
    if (!session) {
      return res.status(404).json({ error: 'Sesi pemantau tidak ditemukan.' });
    }
    if (session.sessionStatus !== 'active') {
      return res.json({ success: true, sessionStatus: session.sessionStatus, message: 'Sesi pemantau sudah selesai atau kedaluwarsa.' });
    }

    const endedSession = await store.endObserverSession(observerId, { reason: req.body?.reason });
    const started = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
    const ended = endedSession?.endedAt ? new Date(endedSession.endedAt).getTime() : Date.now();
    const durationSeconds = Math.max(0, Math.floor((ended - started) / 1000));
    await store.recordAudit({
      actorId: req.admin.employeeId,
      targetId: session.meetingId,
      action: 'observer.session.end',
      result: 'succeeded',
      previousValue: observerId,
      newValue: JSON.stringify({ durationSeconds, startedAt: session.startedAt, endedAt: endedSession?.endedAt }),
      reason: `${req.body?.reason || 'Sesi pemantau diakhiri oleh Super Admin'} (durasi: ${durationSeconds} detik)`,
    }).catch(err => console.warn('[OBSERVER] Audit log failed:', err.message));

    const meeting = meetingStore.meetings.get(session.meetingId);
    if (meeting) {
      meeting.activeObserverCount = Math.max(0, (meeting.activeObserverCount || 1) - 1);
      if (meeting.activeObserverCount === 0) {
        meeting.isMonitored = false;
        if (roomService?.updateRoomMetadata) {
          await roomService.updateRoomMetadata(meeting.livekitRoom, JSON.stringify({ isMonitored: false })).catch(() => {});
        }
      }
      const observerIdentity = `observer-${session.adminUserId}-${observerId.slice(0, 8)}`;
      if (roomService?.removeParticipant) {
        await roomService.removeParticipant(meeting.livekitRoom, observerIdentity).catch(() => {});
      }
    }

    res.json({ success: true, sessionStatus: 'ended', session: endedSession });
  }));

  router.post('/observer/sessions/:observerId/revoke', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { observerId } = req.params;
    const session = await store.getObserverSession(observerId);
    if (!session) {
      return res.status(404).json({ error: 'Sesi pemantau tidak ditemukan.' });
    }
    const revokedSession = await store.revokeObserverSession(observerId, { reason: req.body?.reason });
    const started = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
    const ended = revokedSession?.endedAt ? new Date(revokedSession.endedAt).getTime() : Date.now();
    const durationSeconds = Math.max(0, Math.floor((ended - started) / 1000));
    await store.recordAudit({
      actorId: req.admin.employeeId,
      targetId: session.meetingId,
      action: 'observer.session.revoked',
      result: 'succeeded',
      previousValue: observerId,
      newValue: JSON.stringify({ durationSeconds, startedAt: session.startedAt, endedAt: revokedSession?.endedAt }),
      reason: `${req.body?.reason || 'Sesi pemantau dicabut'} (durasi: ${durationSeconds} detik)`,
    }).catch(err => console.warn('[OBSERVER] Audit log failed:', err.message));

    const meeting = meetingStore.meetings.get(session.meetingId);
    if (meeting) {
      meeting.activeObserverCount = Math.max(0, (meeting.activeObserverCount || 1) - 1);
      if (meeting.activeObserverCount === 0) {
        meeting.isMonitored = false;
        if (roomService?.updateRoomMetadata) {
          await roomService.updateRoomMetadata(meeting.livekitRoom, JSON.stringify({ isMonitored: false })).catch(() => {});
        }
      }
      const observerIdentity = `observer-${session.adminUserId}-${observerId.slice(0, 8)}`;
      if (roomService?.removeParticipant) {
        await roomService.removeParticipant(meeting.livekitRoom, observerIdentity).catch(() => {});
      }
    }

    res.json({ success: true, sessionStatus: 'revoked', session: revokedSession });
  }));

  router.get('/observer/sessions/active', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { meetingId } = req.query;
    const sessions = await store.getActiveObserverSessions(meetingId ? String(meetingId).trim() : null);
    res.json({ sessions });
  }));

  router.get('/observer/sessions', requirePermission(AdminPermission.READ_AUDIT, AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { meetingId = '', adminUserId = '', status = '', page = '1', pageSize = '20' } = req.query;
    const data = await store.listObserverSessions({
      meetingId: String(meetingId).trim(),
      adminUserId: String(adminUserId).trim(),
      status: String(status).trim(),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
    res.json(data);
  }));
  router.get('/meetings/history/export', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { q = '', from = '', to = '' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')
      || (from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))) {
      return res.status(400).json({ error: 'Filter riwayat rapat tidak valid.' });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: 'Tanggal akhir tidak boleh sebelum tanggal awal.' });
    }
    const csv = await store.exportMeetingHistoryCsv({ search: q.trim(), from: from || null, to: to || null, hostNameForMeeting });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="riwayat-rapat.csv"');
    res.send(csv);
  }));
  router.get('/meetings/history', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { q = '', from = '', to = '', page = '1', format = '' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')
      || (from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Filter riwayat rapat atau nomor halaman tidak valid.' });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: 'Tanggal akhir tidak boleh sebelum tanggal awal.' });
    }
    if (format === 'csv') {
      const csv = await store.exportMeetingHistoryCsv({ search: q.trim(), from: from || null, to: to || null, hostNameForMeeting });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="riwayat-rapat.csv"');
      return res.send(csv);
    }
    res.json(await store.listMeetingHistory({ search: q.trim(), from: from || null, to: to || null, page: Number(page), hostNameForMeeting }));
  }));
  router.get('/system', requirePermission(AdminPermission.READ_SYSTEM), asyncRoute(async (_req, res) => {
    const [system, recordingQueue, queueStats] = await Promise.all([
      readAdminSystem({
        config, probe, fetchImpl, recordingCapabilities, postMeetingBatch,
        databaseReady: () => store.databaseReady(),
        databaseVersion: () => store.databaseVersion(),
      }),
      store.recordingQueue().catch(() => null),
      store.recordingQueueExtendedStats().catch(() => null),
    ]);
    res.json({ ...system, recordingQueue, queueStats });
  }));

  const handleListProcessingJobs = asyncRoute(async (req, res) => {
    const { q = '', status = '', processingType = '', from = '', to = '', order = 'desc', page = '1', pageSize = '20' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')
      || !['', 'queued', 'processing', 'done', 'failed'].includes(status)
      || typeof processingType !== 'string' || processingType.length > 64
      || (from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))
      || (from && to && from > to)
      || !['asc', 'desc'].includes(order)
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))
      || typeof pageSize !== 'string' || !['10', '20', '50'].includes(pageSize)) {
      return res.status(400).json({ error: 'Parameter filter pekerjaan pemrosesan tidak valid.' });
    }
    const data = await store.listProcessingJobs({
      search: q.trim(),
      status,
      processingType: processingType.trim(),
      from: from || null,
      to: to || null,
      order,
      page: Number(page),
      pageSize: Number(pageSize),
    });
    res.json(data);
  });

  router.get('/system/jobs', requirePermission(AdminPermission.READ_SYSTEM), handleListProcessingJobs);
  router.get('/processing-jobs', requirePermission(AdminPermission.READ_SYSTEM), handleListProcessingJobs);

  const handleGetProcessingJobDetail = asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(id)) {
      return res.status(400).json({ error: 'ID pekerjaan tidak valid.' });
    }
    const job = await store.getProcessingJobDetail(id);
    if (!job) {
      return res.status(404).json({ error: 'Pekerjaan pemrosesan tidak ditemukan.' });
    }
    res.json({ job });
  });

  router.get('/system/jobs/:id', requirePermission(AdminPermission.READ_SYSTEM), handleGetProcessingJobDetail);
  router.get('/processing-jobs/:id', requirePermission(AdminPermission.READ_SYSTEM), handleGetProcessingJobDetail);

  const handleRetryProcessingJob = asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(id)) {
      return res.status(400).json({ error: 'ID pekerjaan tidak valid.' });
    }
    if (typeof retryUpload !== 'function') {
      return res.status(503).json({ error: 'Fungsi percobaan ulang antrean tidak tersedia di server.' });
    }
    const outcome = await retryUpload(id, { actorId: req.admin.employeeId });
    if (!outcome.ok) {
      return res.status(outcome.status || 400).json({ error: outcome.error });
    }
    await store.recordAudit({
      actorId: req.admin.employeeId,
      targetId: id,
      action: 'recording.retry',
      result: 'succeeded',
      newValue: 'queued',
      reason: outcome.reason || 'Admin memicu percobaan ulang pekerjaan',
    }).catch(err => console.warn('[ADMIN] Audit log for retry failed:', err.message));
    res.json({ success: true, message: outcome.message, job: outcome.job });
  });

  router.post('/system/jobs/:id/retry', requirePermission(AdminPermission.READ_SYSTEM), handleRetryProcessingJob);
  router.post('/processing-jobs/:id/retry', requirePermission(AdminPermission.READ_SYSTEM), handleRetryProcessingJob);
  router.get('/recordings', requirePermission(AdminPermission.READ_RECORDINGS), asyncRoute(async (req, res) => {
    const { q = '', status = '', page = '1' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')
      || !['', 'queued', 'processing', 'done', 'failed'].includes(status)
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Filter rekaman atau nomor halaman tidak valid.' });
    }
    res.json(await store.listRecordingMetadata({ search: q.trim(), status, page: Number(page) }));
  }));

  router.delete('/recordings/:id', requirePermission(AdminPermission.DELETE_RECORDINGS), asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (!/^[a-z0-9_-]{1,64}$/i.test(id)) return res.status(400).json({ error: 'ID rekaman tidak valid.' });
    const outcome = await deleteRecording(id, { actorId: req.admin.employeeId });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ success: true, mediaCleanupPending: outcome.mediaCleanupPending });
  }));

  const manage = requirePermission(AdminPermission.MANAGE_ACCOUNTS);
  const readOverview = requirePermission(AdminPermission.MANAGE_ACCOUNTS, AdminPermission.READ_MEETINGS, AdminPermission.READ_SYSTEM);
  router.get('/overview', readOverview, asyncRoute(async (req, res) => {
    const { days = '30' } = req.query;
    if (!['7', '30', '90'].includes(days)) {
      return res.status(400).json({ error: 'Pilih periode 7, 30, atau 90 hari.' });
    }
    res.json(await store.overview(Number(days)));
  }));
  router.get('/employees', manage, asyncRoute(async (req, res) => {
    const { q = '', department = '', status = '', role = '', page = '1' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || typeof department !== 'string' || department.length > 64
      || typeof status !== 'string' || status.length > 32
      || typeof role !== 'string' || !['', 'super_admin', 'employee'].includes(role)
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page)
      || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Filter atau nomor halaman tidak valid.' });
    }
    res.json(await store.listEmployees({
      search: q.trim(), department: department.trim(), status: status.trim(), role: role.trim(), page: Number(page),
    }));
  }));
  router.patch('/accounts/:employeeId/status', manage, asyncRoute(async (req, res) => {
    const { employeeId } = req.params;
    const { status } = req.body ?? {};
    if (!validAdminEmployeeId(employeeId) || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'ID karyawan dan status active atau inactive diperlukan.' });
    }
    sendOutcome(res, await store.setAccountStatus(req.admin.employeeId, employeeId, status));
  }));
  router.patch('/accounts/:employeeId/super-admin', manage, asyncRoute(async (req, res) => {
    const { employeeId } = req.params;
    const { granted } = req.body ?? {};
    if (!validAdminEmployeeId(employeeId) || typeof granted !== 'boolean') {
      return res.status(400).json({ error: 'ID karyawan dan nilai granted berupa boolean diperlukan.' });
    }
    sendOutcome(res, await store.setSuperAdmin(req.admin.employeeId, employeeId, granted));
  }));
  router.post('/accounts/:employeeId/invite', manage, asyncRoute(async (req, res) => {
    const { employeeId } = req.params;
    if (!validAdminEmployeeId(employeeId)) return res.status(400).json({ error: 'ID karyawan tidak valid.' });
    sendOutcome(res, await store.inviteEmployee(req.admin.employeeId, employeeId), 201);
  }));
  router.get('/activation-requests', manage, asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.length > 100) return res.status(400).json({ error: 'Kata kunci pencarian terlalu panjang.' });
    res.json({ requests: await store.listActivationRequests(q.trim()) });
  }));
  router.post('/activation-requests/:requestId/approve', manage, asyncRoute(async (req, res) => {
    const { requestId } = req.params;
    if (!/^[1-9]\d*$/.test(requestId)) return res.status(400).json({ error: 'ID permintaan tidak valid.' });
    sendOutcome(res, await store.reviewActivationRequest(req.admin.employeeId, Number(requestId), true));
  }));
  router.post('/activation-requests/:requestId/decline', manage, asyncRoute(async (req, res) => {
    const { requestId } = req.params;
    if (!/^[1-9]\d*$/.test(requestId)) return res.status(400).json({ error: 'ID permintaan tidak valid.' });
    sendOutcome(res, await store.reviewActivationRequest(req.admin.employeeId, Number(requestId), false));
  }));
  app.use('/api/admin', router);
}
