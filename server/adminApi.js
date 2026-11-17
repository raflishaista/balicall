import { Router } from 'express';
import { AdminPermission, PgAdminStore, validAdminEmployeeId } from './adminStore.js';
import { compileAdminMeetings, readAdminSystem, readLiveKitRooms } from './adminMonitoring.js';

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

export function attachAdminApi(app, config, { meetingStore, probe, fetchImpl, recordingCapabilities, postMeetingBatch, retryUpload }) {
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
