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

export function attachAdminApi(app, config, { meetingStore, probe, fetchImpl, recordingCapabilities, postMeetingBatch }) {
  const router = Router();
  const store = new PgAdminStore();
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
  router.get('/audit', requirePermission(AdminPermission.READ_AUDIT), asyncRoute(async (req, res) => {
    const { from = '', to = '', action = '', page = '1' } = req.query;
    if ((from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))) {
      return res.status(400).json({ error: 'Tanggal audit tidak valid.' });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: 'Tanggal akhir tidak boleh sebelum tanggal awal.' });
    }
    if (typeof action !== 'string' || (action !== '' && !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(action))
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Jenis tindakan atau nomor halaman tidak valid.' });
    }
    res.json(await store.listAudit({ from: from || null, to: to || null, action, page: Number(page) }));
  }));
  router.get('/meetings', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (_req, res) => {
    const [history, schedules, rooms] = await Promise.all([
      store.listMeetingMetadata(), store.listScheduleMetadata(), readLiveKitRooms(probe),
    ]);
    res.json(compileAdminMeetings({ history, schedules, rooms, snapshots: meetingStore.meetings.values() }));
  }));
  router.get('/meetings/history', requirePermission(AdminPermission.READ_MEETINGS), asyncRoute(async (req, res) => {
    const { q = '', from = '', to = '', page = '1' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || q.includes('\0')
      || (from !== '' && !isAdminDate(from)) || (to !== '' && !isAdminDate(to))
      || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Filter riwayat rapat atau nomor halaman tidak valid.' });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: 'Tanggal akhir tidak boleh sebelum tanggal awal.' });
    }
    res.json(await store.listMeetingHistory({ search: q.trim(), from: from || null, to: to || null, page: Number(page) }));
  }));
  router.get('/system', requirePermission(AdminPermission.READ_SYSTEM), asyncRoute(async (_req, res) => {
    res.json(await readAdminSystem({
      config, probe, fetchImpl, recordingCapabilities, postMeetingBatch, databaseReady: () => store.databaseReady(),
    }));
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
    const { q = '', department = '', status = '', page = '1' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || typeof department !== 'string' || department.length > 64
      || typeof status !== 'string' || status.length > 32 || typeof page !== 'string' || !/^[1-9]\d*$/.test(page)
      || !Number.isSafeInteger(Number(page))) {
      return res.status(400).json({ error: 'Filter atau nomor halaman tidak valid.' });
    }
    res.json(await store.listEmployees({
      search: q.trim(), department: department.trim(), status: status.trim(), page: Number(page),
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
  app.use('/api/admin', router);
}
