import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

process.env.DATABASE_URL = '';
const database = new PGlite();
let failRecordingQueueQuery = false;
const query = async (sql, params) => {
  if (failRecordingQueueQuery && sql.includes('PERCENTILE_CONT')) throw Error('Simulated queue query outage');
  return params?.length ? database.query(sql, params)
    : database.exec(sql).then(results => results.at(-1));
};
const originalPool = Object.getOwnPropertyDescriptor(pg, 'Pool');
Object.defineProperty(pg, 'Pool', { configurable: true, value: class {
  on() {}
  query(sql, params) { return query(sql, params); }
  async connect() { return { query, release() {} }; }
} });
const { initDb } = await import('../db.js');
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');
const { hashToken, initAuthDb, PgAuthStore } = await import('../authStore.js');
Object.defineProperty(pg, 'Pool', originalPool);

test('admin permissions are enforced and account changes are audited', async t => {
  t.after(() => database.close());
  assert.equal(await initDb('postgresql://synthetic/in-memory'), true);
  const adminId = 'BT-99091';
  const employeeId = 'BT-99092';
  for (const id of [adminId, employeeId]) {
    await query(`INSERT INTO balicall_employees (employee_id,name,email,department,position)
      VALUES ($1,'Test account',$2,'QA','Tester')`, [id, id.toLowerCase() + '@example.test']);
  }
  await initAuthDb();
  await query('UPDATE balicall_auth_accounts SET password_hash=$1 WHERE employee_id IN ($2,$3)', ['fixture-hash', adminId, employeeId]);
  const auth = new PgAuthStore();
  const tokens = { admin: 'a'.repeat(43), employee: 'b'.repeat(43), guest: 'c'.repeat(43) };
  await auth.createSession(hashToken(tokens.admin), adminId, 1);
  await auth.createSession(hashToken(tokens.employee), employeeId, 1);
  const directory = await mkdtemp(join(tmpdir(), 'balicall-admin-test-'));
  const config = { ...loadConfig({ AUTH_ENABLED: 'true', LLM_PROVIDER: 'demo',
    LIVE_STT_URL: '/live-stt/asr', LIVE_STT_SECRET: 'w'.repeat(32) }),
    dataFile: join(directory, 'meetings.json'),
    recordingSttUrl: 'http://recording-fixture.test/v1', recordingSttModels: ['small'],
    recordingDiarizers: ['none', 'nemotron'],
    qwenGgufSttBaseUrl: 'http://q8-fixture.test/v1', qwenSttBaseUrl: 'http://qwen-fixture.test/v1',
    qwenBatchEnabled: true, qwenBatchRecordingsDir: directory,
    seaLiveSttUrl: '/sea-live-stt/asr', seaLiveSttSecret: 'x'.repeat(32),
    seaLiveHealthUrl: 'http://sea-fixture.test/health', seaLivePilotEnabled: true };
  const authForTest = Object.create(auth);
  authForTest.session = hash => hash === hashToken(tokens.guest)
    ? { employeeId: 'guest-fixture', isGuest: true } : auth.session(hash);
  let meetingStore;
  let rooms = [];
  let livekitAvailable = true;
  let whisperAvailable = true;
  const start = async (settings) => {
    const context = createApp(settings, {
      authStore: authForTest,
      livekitProbe: async () => {
        if (!livekitAvailable) throw Error('Simulated LiveKit outage');
        return rooms;
      },
      fetchImpl: async url => {
        if (url === 'http://127.0.0.1:8003/health' && whisperAvailable) {
          return Response.json({ status: 'ok', model: 'whisperlivekit-small', streaming: true });
        }
        if (url === 'http://whisper-fixture.test/worker/health') {
          return Response.json({ status: 'ok', model: 'whisperlivekit-small', streaming: true });
        }
        if (url === 'http://recording-fixture.test/health') {
          return Response.json({ model: 'small', recordingModels: [{ model: 'small', diarizers: ['none', 'nemotron'] }] });
        }
        if (url === 'http://q8-fixture.test/health') return Response.json({ status: 'ok', backend: 'qwen3' });
        if (url === 'http://q8-fixture.test/v1/models') {
          return Response.json({ data: [{ backend: 'qwen3', id: 'qwen3-asr-0.6b-q8_0.gguf' }] });
        }
        if (url === 'http://qwen-fixture.test/health') {
          return Response.json({ ready: true, model: 'qwen3-asr-0.6b', batchDiarization: true });
        }
        throw Error('Simulated worker outage');
      },
    });
    meetingStore = context.store;
    const server = context.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { context.close(); await new Promise(resolve => server.close(resolve)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    return (path, actor, body, csrf = true, method = body === undefined ? 'GET' : 'PATCH') => fetch(base + path, {
      method,
      headers: {
        ...(actor && { Cookie: 'balicall_session=' + tokens[actor] }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(actor && csrf && { 'X-CSRF-Token': hashToken('balicall-csrf:' + tokens[actor]) }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  const request = await start(config);
  t.after(async () => { await rm(config.dataFile, { force: true }); await rmdir(directory); });
  assert.equal((await request('/admin/access')).status, 401);
  assert.equal((await request('/admin/access', 'employee')).status, 403);
  assert.equal((await request('/admin/system', 'employee')).status, 403);
  assert.equal((await request('/admin/system', 'guest')).status, 403);
  assert.equal((await request('/admin/system')).status, 401);
  assert.equal((await request('/admin/meetings', 'employee')).status, 403);
  assert.equal((await request('/admin/audit', 'guest')).status, 403);
  assert.equal((await request('/admin/audit?from=2025-01-02&page=2', 'employee')).status, 403);
  assert.equal((await request('/admin/audit?page=2')).status, 401);
  assert.equal((await request('/admin/audit/export', 'employee')).status, 403);
  assert.equal((await request('/admin/audit/export', 'guest')).status, 403);
  assert.equal((await request('/admin/audit/export')).status, 401);

  const { PgAdminStore } = await import('../adminStore.js');
  const admin = new PgAdminStore();
  assert.equal((await admin.bootstrap(adminId)).ok, true);
  assert.equal((await admin.bootstrap(employeeId)).status, 409);
  const access = await (await request('/admin/access', 'admin')).json();
  assert.deepEqual(access.permissions, ['accounts:manage', 'meetings:read', 'system:read', 'audit:read', 'recordings:read']);
  assert.equal((await (await request('/auth/session', 'admin')).json()).user.isSuperAdmin, true);
  const { livekit, databaseConnected, recordingQueue } = await (await request('/admin/system', 'admin')).json();
  assert.equal(livekit, 'reachable');
  assert.equal(databaseConnected, true);
  assert.deepEqual(recordingQueue, {
    queued: 0, processing: 0, failed: 0, medianCompletionSeconds: null, completionSampleSize: 0,
  });
  await query('INSERT INTO balicall_meetings(id,room_name) VALUES ($1,$2)', ['fixture-room', 'Private fixture title']);
  const { meetings } = await (await request('/admin/meetings', 'admin')).json();
  assert.equal(meetings[0].hostName, null);
  assert.equal(meetings[0].durationSeconds, null);
  assert.equal(meetings[0].participantCount, 0);

  await t.test('queue counts current statuses and calculates the median of valid recent completions', async () => {
    await query(`INSERT INTO balicall_recording_uploads(id,title,status,created_at,completed_at)
      VALUES ('queue-1','Queue fixture','queued',NOW(),NULL),
        ('queue-2','Queue fixture','processing',NOW(),NULL),
        ('queue-3','Queue fixture','failed',NOW()-interval '1 hour',NOW()),
        ('queue-4','Queue fixture','failed',NOW()-interval '8 days',NULL),
        ('queue-5','Queue fixture','done',NOW(),NOW()),
        ('queue-6','Queue fixture','done',NOW()-interval '20 seconds',NOW()),
        ('queue-7','Queue fixture','done',NOW()-interval '60 seconds',NOW()),
        ('queue-8','Queue fixture','done',NOW()-interval '100 seconds',NOW()),
        ('queue-9','Queue fixture','done',NOW()-interval '9 days',NOW()-interval '8 days'),
        ('queue-10','Queue fixture','done',NOW(),NOW()+interval '1 hour'),
        ('queue-11','Queue fixture','done',NOW(),NOW()-interval '1 hour'),
        ('queue-12','Queue fixture','done',NULL,NOW()),
        ('queue-13','Queue fixture','done',NOW(),NULL),
        ('queue-14','Queue fixture','done','-infinity',NOW()),
        ('queue-15','Queue fixture','done',NOW(),'infinity')`);
    try {
      const response = await request('/admin/system', 'admin');
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).recordingQueue, {
        queued: 1, processing: 1, failed: 2, medianCompletionSeconds: 40, completionSampleSize: 4,
      });
      failRecordingQueueQuery = true;
      const degraded = await request('/admin/system', 'admin');
      assert.equal(degraded.status, 200);
      const system = await degraded.json();
      assert.equal(system.recordingQueue, null);
      assert.equal(system.services.find(service => service.id === 'database').status, 'ready');
      assert.equal(system.services.find(service => service.id === 'livekit').status, 'ready');
    } finally {
      failRecordingQueueQuery = false;
      await query("DELETE FROM balicall_recording_uploads WHERE id LIKE 'queue-%'");
    }
  });

  await t.test('overview counts persisted meetings by period and directory filters paginate', async () => {
    const { rows: [directory] } = await query('SELECT COUNT(*)::int AS total FROM balicall_employees');
    await query(`INSERT INTO balicall_employees (employee_id,name,department,position,status)
      SELECT 'QC-'||n,'Rina '||LPAD(n::text,2,'0'),'QA Overview','Tester',
        CASE WHEN n=22 THEN 'inactive' ELSE 'active' END
      FROM generate_series(1,22) n`);
    await query(`INSERT INTO balicall_auth_accounts (employee_id,login_email,password_hash)
      VALUES ('QC-1','qc1@example.test',NULL), ('QC-22','qc22@example.test','fixture-hash')`);
    await query(`INSERT INTO balicall_meetings (id,room_name,status,created_at)
      VALUES ('older-room','Old meeting','ended',NOW()-interval '14 days'),
        ('scheduled-then-joined','Started scheduled meeting','ended',NOW()-interval '14 days'),
        ('future-schedule','Upcoming meeting','scheduled',NOW()+interval '3 days')`);
    await query(`INSERT INTO balicall_attendees(meeting_id,employee_id,employee_name,joined_at)
      VALUES ('scheduled-then-joined','QC-1','Rina 01',NOW()-interval '1 day'),
        ('scheduled-then-joined','QC-2','Rina 02',NOW()-interval '12 hours')`);
    await query(`WITH boundary AS (
        SELECT ((NOW() AT TIME ZONE 'Asia/Jakarta')::date - 6)::timestamp AT TIME ZONE 'Asia/Jakarta' AS starts_at
      )
      INSERT INTO balicall_recording_uploads (id,title,file_size,status,created_at,completed_at)
      SELECT 'recording-a','Fixture A',1024,'done',starts_at,starts_at FROM boundary
      UNION ALL SELECT 'recording-b','Fixture B',2048,'done',starts_at-interval '1 second',starts_at FROM boundary
      UNION ALL SELECT 'recording-c','Fixture C',NULL,'failed',starts_at,starts_at FROM boundary`);

    for (const path of ['/admin/overview','/admin/employees']) {
      assert.equal((await request(path)).status, 401);
      assert.equal((await request(path, 'employee')).status, 403);
      assert.equal((await request(path, 'guest')).status, 403);
    }
    const first = await request('/admin/overview?days=7', 'admin');
    assert.equal(first.status, 200);
    const { dailyActivity, recentActivity, periodStart, periodEnd, ...totals } = await first.json();
    assert.deepEqual(totals, {
      days: 7, totalEmployees: directory.total + 22, activatedAccounts: 3,
      totalMeetings: 2, totalRecordings: 2, uploadedBytes: '1024',
    });
    assert.equal(dailyActivity.length, 7);
    assert.deepEqual(dailyActivity[0], { date: periodStart, meetings: 0, attendances: 0, meetingsWithParticipants: 0 });
    assert.equal(dailyActivity.at(-1).date, periodEnd);
    assert.equal(dailyActivity.reduce((sum, day) => sum + day.meetings, 0), totals.totalMeetings);
    assert.equal(dailyActivity.reduce((sum, day) => sum + day.attendances, 0), 2);
    assert.deepEqual(recentActivity.map(({ kind, id }) => [kind, id]), [
      ['meeting_created', 'fixture-room'], ['recording_completed', 'recording-a'], ['recording_completed', 'recording-b'],
    ]);
    assert.match(recentActivity[1].occurredAt, /T(00:00:00\+07:00|17:00:00(?:\+00:00|Z))$/);
    assert.ok(recentActivity.every(event => Object.keys(event).sort().join(',') === 'id,kind,occurredAt,title'));
    const month = await (await request('/admin/overview?days=30', 'admin')).json();
    assert.equal(month.totalMeetings, 3);
    assert.equal(month.totalRecordings, 3);
    assert.equal(month.uploadedBytes, '3072');
    assert.equal(month.dailyActivity.length, 30);
    assert.equal(month.dailyActivity.reduce((sum, day) => sum + day.meetingsWithParticipants, 0), 1);
    assert.equal((await request('/admin/overview?days=0', 'admin')).status, 400);

    const filters = '/admin/employees?q=RINA&department=QA%20Overview&status=active';
    const page1 = await (await request(filters, 'admin')).json();
    assert.equal(page1.total, 21);
    assert.equal(page1.employees.length, 20);
    assert.equal(page1.employees[0].employeeId, 'QC-1');
    assert.equal(page1.employees[0].activated, false);
    assert.ok(page1.departments.includes('QA Overview'));
    const page2 = await (await request(filters + '&page=2', 'admin')).json();
    assert.equal(page2.page, 2);
    assert.deepEqual(page2.employees.map(employee => employee.employeeId), ['QC-21']);
    const inactive = await (await request('/admin/employees?department=QA%20Overview&status=inactive', 'admin')).json();
    assert.deepEqual(inactive.employees, [{
      employeeId: 'QC-22', name: 'Rina 22', department: 'QA Overview', status: 'inactive', activated: true, isSuperAdmin: false, lastLoginAt: null,
    }]);
    const literalSearch = await (await request('/admin/employees?q=%25', 'admin')).json();
    assert.equal(literalSearch.total, 0);
    assert.deepEqual(literalSearch.employees, []);
    assert.equal((await request('/admin/employees?page=0', 'admin')).status, 400);
  });

  await t.test('employee directory enforces summary cards, email and role filters, pagination, access gates and persistent last login', async () => {
    // 1. Access gates
    assert.equal((await request('/admin/employees')).status, 401);
    assert.equal((await request('/admin/employees', 'employee')).status, 403);
    assert.equal((await request('/admin/employees', 'guest')).status, 403);
    const authed = await request('/admin/employees', 'admin');
    assert.equal(authed.status, 200);

    // 2. Role validation
    assert.equal((await request('/admin/employees?role=invalid_role', 'admin')).status, 400);
    assert.equal((await request('/admin/employees?role=super_admin', 'admin')).status, 200);
    assert.equal((await request('/admin/employees?role=employee', 'admin')).status, 200);
    assert.equal((await request('/admin/employees?role=', 'admin')).status, 200);

    try {
      // 3. Seed specific test employees
      await query(`
        INSERT INTO balicall_employees (employee_id, name, email, department, position, status)
        VALUES
          ('DIR-1', 'Santoso Unique', 'santoso.dir@unique.test', 'Operations', 'Lead', 'active'),
          ('DIR-2', 'Aminah Unique', 'aminah.dir@unique.test', 'Engineering', 'Developer', 'active'),
          ('DIR-3', 'Agus Belum', 'agus.dir@unique.test', 'Engineering', 'Junior Dev', 'active'),
          ('DIR-4', 'Dewi Blank', 'dewi.dir@unique.test', '   ', 'Specialist', 'active'),
          ('DIR-5', 'Joko Off', 'joko.dir@unique.test', 'Finance', 'Analyst', 'inactive')
      `);
      await query(`
        INSERT INTO balicall_auth_accounts (employee_id, login_email, password_hash)
        VALUES
          ('DIR-1', 'santoso.login@company.test', 'fixture-hash-1'),
          ('DIR-2', 'aminah.login@company.test', 'fixture-hash-2'),
          ('DIR-3', 'agus.login@company.test', NULL),
          ('DIR-4', 'dewi.login@company.test', 'fixture-hash-4'),
          ('DIR-5', 'joko.login@company.test', 'fixture-hash-5')
      `);
      await query(`
        INSERT INTO balicall_admin_roles (employee_id, role)
        VALUES ('DIR-1', 'super_admin')
      `);

      // 4. Directory-wide summary counts
      const baseDir = await (await request('/admin/employees', 'admin')).json();
      assert.ok(baseDir.summary);
      assert.equal(typeof baseDir.summary.activeAccounts, 'number');
      assert.equal(typeof baseDir.summary.superAdmins, 'number');
      assert.equal(typeof baseDir.summary.totalDepartments, 'number');
      // Also present at top level
      assert.equal(baseDir.activeAccounts, baseDir.summary.activeAccounts);
      assert.equal(baseDir.superAdmins, baseDir.summary.superAdmins);
      assert.equal(baseDir.totalDepartments, baseDir.summary.totalDepartments);

      // Verify summary is constant across filtered queries
      const filteredSearch = await (await request('/admin/employees?q=Aminah%20Unique', 'admin')).json();
      assert.equal(filteredSearch.total, 1);
      assert.deepEqual(filteredSearch.summary, baseDir.summary);

      const filteredRole = await (await request('/admin/employees?role=super_admin', 'admin')).json();
      assert.deepEqual(filteredRole.summary, baseDir.summary);

      const filteredDept = await (await request('/admin/employees?department=Engineering', 'admin')).json();
      assert.deepEqual(filteredDept.summary, baseDir.summary);

      // 5. Search by name, employee email, login email (case-insensitive literal)
      const byName = await (await request('/admin/employees?q=santoso%20unique', 'admin')).json();
      assert.ok(byName.employees.some(e => e.employeeId === 'DIR-1'));

      const byEmpEmail = await (await request('/admin/employees?q=santoso.dir@unique', 'admin')).json();
      assert.ok(byEmpEmail.employees.some(e => e.employeeId === 'DIR-1'));

      const byLoginEmail = await (await request('/admin/employees?q=SANTOSO.LOGIN@COMPANY', 'admin')).json();
      assert.ok(byLoginEmail.employees.some(e => e.employeeId === 'DIR-1'));

      // 6. Role filter
      const superAdmins = await (await request('/admin/employees?role=super_admin', 'admin')).json();
      assert.ok(superAdmins.employees.every(e => e.isSuperAdmin === true));
      assert.ok(superAdmins.employees.some(e => e.employeeId === 'DIR-1'));

      const regularEmployees = await (await request('/admin/employees?role=employee', 'admin')).json();
      assert.ok(regularEmployees.employees.every(e => e.isSuperAdmin === false));
      assert.ok(regularEmployees.employees.some(e => e.employeeId === 'DIR-2'));
      assert.ok(!regularEmployees.employees.some(e => e.employeeId === 'DIR-1'));

      // 7. Combined filter: role + search + department + status
      const combined = await (await request('/admin/employees?role=employee&q=aminah&department=Engineering&status=active', 'admin')).json();
      assert.equal(combined.total, 1);
      assert.equal(combined.employees[0].employeeId, 'DIR-2');
      assert.equal(combined.employees[0].isSuperAdmin, false);

      // 8. Persistent last_login_at across session lifecycle & logout
      // DIR-2 starts with no login history: lastLoginAt is null
      assert.equal(combined.employees[0].lastLoginAt, null);

      // Login DIR-2
      const dir2Token = 'd'.repeat(43);
      const dir2TokenHash = hashToken(dir2Token);
      await auth.createSession(dir2TokenHash, 'DIR-2', 8);

      // Fetch employee again: lastLoginAt is now populated
      const loggedInCheck = await (await request('/admin/employees?q=aminah', 'admin')).json();
      const recordedTimestamp = loggedInCheck.employees[0].lastLoginAt;
      assert.ok(recordedTimestamp, 'lastLoginAt should be set after createSession');
      assert.ok(!isNaN(Date.parse(recordedTimestamp)));

      // Re-fetching does not alter the recorded timestamp
      const refreshCheck = await (await request('/admin/employees?q=aminah', 'admin')).json();
      assert.equal(refreshCheck.employees[0].lastLoginAt, recordedTimestamp);

      // Failed login does not alter the recorded timestamp
      const failedLogin = await request('/auth/login', null, { email: 'aminah.login@company.test', password: 'wrong' }, false, 'POST');
      assert.equal(failedLogin.status, 401);
      const afterFailedCheck = await (await request('/admin/employees?q=aminah', 'admin')).json();
      assert.equal(afterFailedCheck.employees[0].lastLoginAt, recordedTimestamp);

      // Logout / revoke session
      await auth.revoke(dir2TokenHash);
      const afterLogoutCheck = await (await request('/admin/employees?q=aminah', 'admin')).json();
      assert.equal(afterLogoutCheck.employees[0].lastLoginAt, recordedTimestamp, 'lastLoginAt must persist after session revocation');

      // 9. Payload safety: ensure sensitive credentials are not leaked
      const sample = loggedInCheck.employees[0];
      const forbiddenFields = ['password', 'password_hash', 'passwordHash', 'token', 'token_hash', 'tokenHash', 'activationCode', 'activation_code'];
      for (const field of forbiddenFields) {
        assert.equal(field in sample, false, `Field ${field} must not be present in employee response`);
      }

      // 10. Verify no runtime schema check exists on PgAuthStore
      assert.equal(typeof auth.hasLastLoginColumn, 'undefined');

      // 11. Transaction atomicity: if updating last_login_at fails, session creation is rolled back
      const atomicToken = 'e'.repeat(43);
      const atomicTokenHash = hashToken(atomicToken);
      let failNextUpdate = false;
      const failingClient = {
        async query(sql, params) {
          if (failNextUpdate && typeof sql === 'string' && sql.includes('UPDATE balicall_auth_accounts SET last_login_at')) {
            throw new Error('Simulated last_login_at update failure');
          }
          return query(sql, params);
        },
        release() {}
      };
      const failingStore = new PgAuthStore({
        async connect() { return failingClient; },
        query(sql, params) { return query(sql, params); }
      });

      failNextUpdate = true;
      await assert.rejects(
        () => failingStore.createSession(atomicTokenHash, 'DIR-2', 8),
        /Simulated last_login_at update failure/
      );

      // Verify transaction rollback: session was NOT created
      const sessionCheck = await query('SELECT 1 FROM balicall_auth_sessions WHERE token_hash = $1', [atomicTokenHash]);
      assert.equal(sessionCheck.rows.length, 0, 'Session must not be created when timestamp update fails');
    } finally {
      await query("DELETE FROM balicall_admin_roles WHERE employee_id LIKE 'DIR-%'");
      await query("DELETE FROM balicall_auth_sessions WHERE employee_id LIKE 'DIR-%'");
      await query("DELETE FROM balicall_auth_accounts WHERE employee_id LIKE 'DIR-%'");
      await query("DELETE FROM balicall_employees WHERE employee_id LIKE 'DIR-%'");
    }
  });

  await t.test('recording inventory pages metadata without granting access to uploaded content', async () => {
    await query(`INSERT INTO balicall_recording_uploads(id,title,file_size,status,stage,owner_id,original_filename,file_path,error,transcript,summary,created_at)
      SELECT 'inventory-'||n, 'Inventaris 100% '||LPAD(n::text,2,'0'),
        CASE WHEN n=1 THEN NULL ELSE 1024 END, CASE WHEN n=22 THEN 'processing' ELSE 'done' END,
        CASE WHEN n=22 THEN 'transcribing' END, $1, 'private-name.mp4', '/private/upload/path',
        'private worker error', '["private transcript"]'::jsonb, '{"private":"summary content"}'::jsonb,
        TIMESTAMPTZ '2026-01-01 00:00:00+00' + n * INTERVAL '1 minute'
      FROM generate_series(1,22) n`, [employeeId]);

    const route = '/admin/recordings';
    assert.equal((await request(route)).status, 401);
    assert.equal((await request(route, 'employee')).status, 403);
    assert.equal((await request(route, 'guest')).status, 403);
    const response = await request(route + '?q=inventaris%20100%25', 'admin');
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.total, 22);
    assert.equal(page.totalUploads, 25);
    assert.equal(page.uploadedBytes, String(24 * 1024));
    assert.equal(page.recordings.length, 20);
    assert.equal(page.recordings[0].id, 'inventory-22');
    assert.deepEqual(Object.keys(page.recordings[0]).sort(), ['createdAt','fileSize','id','stage','status','title']);
    assert.ok(!JSON.stringify(page).includes('private'));

    const tail = await (await request(route + '?q=100%25&page=2', 'admin')).json();
    assert.deepEqual(tail.recordings.map(recording => recording.id), ['inventory-2', 'inventory-1']);
    assert.equal(tail.recordings[1].fileSize, null);
    const filtered = await (await request(route + '?status=processing', 'admin')).json();
    assert.equal(filtered.total, 1);
    assert.equal(filtered.recordings[0].stage, 'transcribing');
    assert.equal(filtered.totalUploads, page.totalUploads);
    assert.equal((await request(route + '?status=unknown', 'admin')).status, 400);
    assert.equal((await request(route + '?page=0', 'admin')).status, 400);
    assert.equal((await request('/recording-uploads/inventory-22', 'admin')).status, 404);
  });

  await t.test('account invitations use the existing one-time activation flow and keep codes out of audit', async () => {
    const invitePath = id => '/admin/accounts/' + id + '/invite';
    const postInvite = (id, actor, csrf = true) => request(invitePath(id), actor, {}, csrf, 'POST');
    assert.equal((await postInvite('QC-1', 'employee')).status, 403);
    assert.equal((await postInvite('QC-1', 'admin', false)).status, 403);
    assert.equal((await postInvite(employeeId, 'admin')).status, 409);
    assert.equal((await postInvite('QC-22', 'admin')).status, 409);
    assert.equal((await postInvite('QC-2', 'admin')).status, 409);
    await query("UPDATE balicall_employees SET email='qc2@example.test' WHERE employee_id='QC-2'");
    const first = await postInvite('QC-2', 'admin');
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const { invite: previous } = await first.json();
    const { invite } = await (await postInvite('QC-2', 'admin')).json();
    assert.equal(invite.email, 'qc2@example.test');
    assert.notEqual(invite.activationCode, previous.activationCode);
    const activation = { email: invite.email, password: 'Fixture activation password 2026' };
    const activate = activationCode => request('/auth/activate', undefined, { ...activation, activationCode }, true, 'POST');
    assert.equal((await activate(previous.activationCode)).status, 400);
    assert.equal((await activate(invite.activationCode)).status, 200);
    assert.equal((await activate(invite.activationCode)).status, 400);
    const { entries } = await (await request('/admin/audit', 'admin')).json();
    assert.equal(entries.filter(entry => entry.action === 'account.invite' && entry.targetId === 'QC-2'
      && entry.result === 'succeeded').length, 2);
    assert.ok(!JSON.stringify(entries).includes(invite.activationCode));
    assert.ok(!JSON.stringify(entries).includes(previous.activationCode));
  });

  await t.test('monitoring merges a started schedule with its LiveKit room and identifies worker outages', async () => {
    await query(`INSERT INTO balicall_schedules(id,room_name,title,host_id,host_name,scheduled_start,scheduled_end)
      VALUES ('monitor-started','room-started','Scheduled and started',$1,'Original host',NOW()-interval '10 minutes',NOW()+interval '30 minutes'),
             ('monitor-upcoming','room-upcoming','Upcoming fixture',$1,'Planned host',NOW()+interval '1 day',NOW()+interval '25 hours')`, [adminId]);
    const started = meetingStore.ensureScheduledRoom({ roomName: 'room-started', scheduleId: 'monitor-started', hostId: employeeId });
    meetingStore.join('room-started', { employeeId, employeeName: 'Current host', department: 'QA' });
    const joinedAt = new Date(Date.now() - 120000).toISOString();
    meetingStore.transact(() => {
      meetingStore.get(started.id).participants.get(employeeId).joinedAt = joinedAt;
      meetingStore.get(started.id).transcripts.push({ text: 'private monitoring fixture transcript' });
    });
    await query('INSERT INTO balicall_meetings(id,room_name) VALUES ($1,$2)', [started.id,'room-started']);
    rooms = [{ name: started.livekitRoom, numParticipants: 3 }];
    const listing = await (await request('/admin/meetings', 'admin')).json();
    const matching = listing.meetings.filter(meeting => meeting.title === 'Scheduled and started');
    assert.equal(matching.length, 1);
    assert.equal(matching[0].status, 'active');
    assert.equal(matching[0].participantCount, 3);
    assert.equal(matching[0].hostName, 'Current host');
    assert.ok(matching[0].durationSeconds >= 120);
    const planned = listing.meetings.find(meeting => meeting.title === 'Upcoming fixture');
    assert.equal(planned.status, 'scheduled');
    assert.equal(planned.hostName, 'Planned host');
    assert.equal(planned.durationSeconds, 3600);
    assert.ok(!JSON.stringify(listing).includes('private monitoring fixture transcript'));
    for (const emptyRooms of [[{ name: started.livekitRoom, numParticipants: 0 }], []]) {
      rooms = emptyRooms;
      const empty = await (await request('/admin/meetings', 'admin')).json();
      const meeting = empty.meetings.find(item => item.id === started.id);
      assert.equal(meeting.status, 'empty');
      assert.equal(meeting.participantCount, 0);
      assert.equal(meeting.durationSeconds, null);
      assert.equal(empty.meetings.find(item => item.id === 'fixture-room').status, 'waiting');
    }
    const ready = await (await request('/admin/system', 'admin')).json();
    assert.equal(ready.services.find(service => service.id === 'whisper-live').status, 'ready');

    livekitAvailable = false;
    whisperAvailable = false;
    const degraded = await (await request('/admin/meetings', 'admin')).json();
    assert.equal(degraded.livekitStatus, 'unavailable');
    const unverified = degraded.meetings.find(meeting => meeting.id === started.id);
    assert.equal(unverified.status, 'unverified');
    assert.equal(unverified.participantCount, null);
    assert.equal(unverified.durationSeconds, null);
    assert.equal(degraded.meetings.find(meeting => meeting.id === 'monitor-upcoming').status, 'scheduled');
    const system = await (await request('/admin/system', 'admin')).json();
    assert.ok(Number.isFinite(Date.parse(system.checkedAt)));
    const statuses = Object.fromEntries(system.services.map(service => [service.id, service.status]));
    assert.equal(statuses.livekit, 'unavailable');
    assert.equal(statuses.database, 'ready');
    assert.equal(statuses['recording-stt'], 'ready');
    assert.equal(statuses['recording-nemotron'], 'ready');
    assert.equal(statuses['whisper-live'], 'unavailable');
    assert.equal(statuses['sea-live'], 'unavailable');
    assert.equal(statuses['qwen-live'], 'not_configured');
    assert.equal(statuses['qwen-q8-chunk'], 'ready');
    assert.equal(statuses['post-meeting-qwen'], 'ready');
    assert.ok(!JSON.stringify(system).includes('fixture.test'));
    livekitAvailable = true;
    rooms = [{ name: started.livekitRoom, numParticipants: 1 }];
    const recovered = await (await request('/admin/meetings', 'admin')).json();
    assert.equal(recovered.meetings.find(meeting => meeting.id === started.id).status, 'active');

    rooms = [];
    const endedAt = new Date(Date.parse(joinedAt) + 60000).toISOString();
    await query('UPDATE balicall_meetings SET status=$2, ended_at=$3 WHERE id=$1', [started.id, 'ended', endedAt]);
    const finished = await (await request('/admin/meetings', 'admin')).json();
    const ended = finished.meetings.find(meeting => meeting.id === started.id);
    assert.equal(ended.status, 'ended');
    assert.equal(ended.participantCount, 1);
    assert.equal(ended.durationSeconds, 60);
  });

  await t.test('meeting history pages all finished records and filters by title and WIB date', async () => {
    await query(`
      INSERT INTO balicall_meetings(id,room_name,status,created_at,ended_at)
      SELECT 'history-' || n, CASE WHEN n IN (1,2) THEN 'Rapat Arsip 100%' ELSE 'Rapat Arsip' END,
        CASE WHEN n = 57 THEN 'active' ELSE 'ended' END,
        TIMESTAMPTZ '2025-01-01 17:00:00+00',
        CASE WHEN n IN (2,56,57) THEN NULL WHEN n = 1 THEN TIMESTAMPTZ '2025-01-01 18:00:00+00'
             ELSE TIMESTAMPTZ '2025-01-01 18:00:00+00' + n * INTERVAL '1 day' END
      FROM generate_series(1,57) n
    `);
    await query(`INSERT INTO balicall_attendees(meeting_id,employee_id,employee_name,joined_at)
      VALUES ('history-1',$1,'Fixture host',TIMESTAMPTZ '2025-01-01 17:05:00+00'),
             ('history-1',$2,'Fixture invitee',NULL)`, [adminId, employeeId]);
    await query(`INSERT INTO balicall_schedules(id,room_name,title,host_id,host_name,scheduled_start,scheduled_end)
      VALUES ('history-reused','Rapat Arsip 100%','Jadwal lain',$1,'Host jadwal lain',NOW(),NOW()+interval '1 hour')`, [adminId]);
    meetingStore.transact(() => {
      meetingStore.meetings.set('history-1', {
        id: 'history-1', roomName: 'Rapat Arsip 100%', hostId: employeeId, status: 'ended',
        transcripts: [], participants: new Map([
          [adminId, { employeeId: adminId, employeeName: 'Fixture host' }],
          [employeeId, { employeeId, employeeName: 'Host tercatat' }],
        ]),
      });
    });
    const path = '/admin/meetings/history';
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, 'employee')).status, 403);
    assert.equal((await request(path, 'guest')).status, 403);
    const first = await request(path + '?q=rapat%20arsip', 'admin');
    assert.equal(first.status, 200);
    const page1 = await first.json();
    assert.equal(page1.total, 56);
    assert.equal(page1.meetings.length, page1.pageSize);
    assert.equal(page1.meetings[0].id, 'history-55');
    assert.equal(page1.summary.totalEndedMeetings, 56);
    assert.equal(page1.summary.durationSamples, 1);
    assert.equal(page1.summary.totalDurationSeconds, 3300);
    assert.equal(page1.summary.participantSamples, 1);

    const last = await (await request(path + '?q=Rapat%20Arsip&page=999', 'admin')).json();
    assert.equal(last.page, Math.ceil(56 / page1.pageSize));
    assert.ok(last.meetings.some(meeting => meeting.id === 'history-1'));
    // Summary remains consistent across pages
    assert.equal(last.summary.totalEndedMeetings, 56);
    assert.equal(last.summary.durationSamples, 1);
    assert.equal(last.summary.totalDurationSeconds, 3300);
    assert.equal(last.summary.participantSamples, 1);

    const matching = await (await request(path + '?q=100%25&from=2025-01-02&to=2025-01-02', 'admin')).json();
    assert.equal(matching.total, 2);
    assert.deepEqual(matching.meetings.map(meeting => meeting.id), ['history-1', 'history-2']);
    assert.equal(matching.meetings[0].participantCount, 1);
    assert.equal(matching.meetings[0].durationSeconds, 3300);
    assert.equal(matching.meetings[0].hostName, 'Host tercatat');
    assert.equal(matching.meetings[1].hostName, null);
    assert.equal(matching.meetings[1].participantCount, null);
    assert.equal(matching.meetings[1].endedAt, null);
    assert.equal(matching.meetings[1].durationSeconds, null);
    // Summary changes when filters are applied
    assert.equal(matching.summary.totalEndedMeetings, 2);
    assert.equal(matching.summary.durationSamples, 1);
    assert.equal(matching.summary.totalDurationSeconds, 3300);
    assert.equal(matching.summary.averageParticipants, 1);
    assert.equal(matching.summary.participantSamples, 1);

    const missing = await (await request(path + '?q=missing', 'admin')).json();
    assert.equal(missing.total, 0);
    assert.equal(missing.summary.totalEndedMeetings, 0);
    assert.equal(missing.summary.durationSamples, 0);
    assert.equal(missing.summary.participantSamples, 0);
    assert.equal(missing.summary.averageParticipants, null);

    assert.equal((await request(path + '?from=2025-01-03&to=2025-01-02', 'admin')).status, 400);
    assert.equal((await request(path + '?page=0', 'admin')).status, 400);

    // CSV export authorization and content verification
    const exportPath = '/admin/meetings/history/export';
    assert.equal((await request(exportPath)).status, 401);
    assert.equal((await request(exportPath, 'employee')).status, 403);
    assert.equal((await request(exportPath, 'guest')).status, 403);
    assert.equal((await request(exportPath + '?from=2025-01-03&to=2025-01-02', 'admin')).status, 400);

    const exportRes = await request(exportPath + '?q=rapat%20arsip', 'admin');
    assert.equal(exportRes.status, 200);
    assert.ok(exportRes.headers.get('content-type')?.includes('text/csv'));
    assert.ok(exportRes.headers.get('content-disposition')?.includes('riwayat-rapat.csv'));
    const csvBuffer = Buffer.from(await exportRes.arrayBuffer());
    assert.equal(csvBuffer[0], 0xEF, 'Byte 0 must be 0xEF for UTF-8 BOM');
    assert.equal(csvBuffer[1], 0xBB, 'Byte 1 must be 0xBB for UTF-8 BOM');
    assert.equal(csvBuffer[2], 0xBF, 'Byte 2 must be 0xBF for UTF-8 BOM');
    const csvContent = csvBuffer.toString('utf8');
    const lines = csvContent.trim().split('\r\n');
    // Header + all 56 matching records across all pages
    assert.equal(lines.length, 57);
    assert.ok(lines[0].includes('Judul') && lines[0].includes('Waktu (WIB)') && lines[0].includes('Host')
      && lines[0].includes('Jumlah peserta') && lines[0].includes('Durasi') && lines[0].includes('Status'));
    // history-1 row contains host, participants, formatted duration and status
    const history1Line = lines.find(line => line.includes('Host tercatat'));
    assert.ok(history1Line);
    assert.ok(history1Line.includes('Rapat Arsip 100%'));
    assert.ok(history1Line.includes('55 mnt'));
    assert.ok(history1Line.includes('Selesai'));
    assert.ok(!csvContent.includes('Fixture host'));
    assert.ok(!csvContent.includes('Host jadwal lain'));
    assert.ok(lines.some(line => line.startsWith('Rapat Arsip 100%') && line.includes('Belum tercatat,—,—,Selesai')));

    // Test CSV formula injection defense and escaping
    await query(`
      INSERT INTO balicall_meetings(id,room_name,status,created_at,ended_at)
      VALUES ('history-formula', '=cmd|'' /C calc''!A0', 'ended', TIMESTAMPTZ '2025-01-02 10:00:00+00', TIMESTAMPTZ '2025-01-02 11:00:00+00'),
             ('history-quotes', 'Rapat "Khusus", Evaluasi\nTahap 2', 'ended', TIMESTAMPTZ '2025-01-02 10:00:00+00', TIMESTAMPTZ '2025-01-02 11:00:00+00')
    `);
    const formulaExport = await (await request(exportPath + '?q=cmd', 'admin')).text();
    assert.ok(formulaExport.includes("'=cmd|"), 'Formula character = must be prepended with single quote');

    const quotesExport = await (await request(exportPath + '?q=khusus', 'admin')).text();
    assert.ok(quotesExport.includes('"Rapat ""Khusus"", Evaluasi\nTahap 2"'), 'Quotes, commas, and newlines must be RFC 4180 escaped');

    // Also verify /admin/meetings/history?format=csv alias
    const aliasRes = await request(path + '?q=cmd&format=csv', 'admin');
    assert.equal(aliasRes.status, 200);
    assert.ok(aliasRes.headers.get('content-type')?.includes('text/csv'));
  });

  await t.test('monitoring uses the configured WhisperLiveKit health address for a proxied worker', async () => {
    const proxy = await start({ ...config, liveSttHealthUrl: 'http://whisper-fixture.test/worker/health' });
    const system = await (await proxy('/admin/system', 'admin')).json();
    assert.equal(system.services.find(service => service.id === 'whisper-live').status, 'ready');
    assert.ok(!JSON.stringify(system).includes('whisper-fixture.test'));
  });

  const role = id => '/admin/accounts/' + id + '/super-admin';
  const status = id => '/admin/accounts/' + id + '/status';
  assert.equal((await request(role(employeeId), 'employee', { granted: true })).status, 403);
  assert.equal((await request(role(employeeId), 'admin', { granted: true }, false)).status, 403);
  assert.equal((await request(role(adminId), 'admin', { granted: false })).status, 409);
  assert.equal((await request(role(employeeId), 'admin', { granted: true })).status, 200);
  const employeeList = await (await request('/admin/employees?q=Test%20account', 'admin')).json();
  assert.equal(employeeList.employees.find(employee => employee.employeeId === employeeId).isSuperAdmin, true);
  assert.equal((await request('/admin/access', 'employee')).status, 200);
  assert.equal((await request(role(employeeId), 'admin', { granted: false })).status, 200);
  assert.equal((await request('/admin/access', 'employee')).status, 403);
  assert.equal((await request(status(adminId), 'admin', { status: 'inactive' })).status, 409);
  assert.equal((await request(status(employeeId), 'admin', { status: 'inactive' })).status, 200);
  assert.equal(await auth.createSession(hashToken(tokens.employee), employeeId, 1), false);
  assert.equal((await request('/admin/access', 'employee')).status, 401);
  assert.equal((await request(status(employeeId), 'admin', { status: 'active' })).status, 200);
  assert.equal((await request('/admin/access', 'employee')).status, 401);

  const { entries } = await (await request('/admin/audit', 'admin')).json();
  const success = entries.find(entry => entry.action === 'account.status.change' && entry.targetId === employeeId);
  assert.deepEqual([success.actorId, success.result], [adminId, 'succeeded']);
  assert.ok(Number.isFinite(Date.parse(success.occurredAt)));
  assert.ok(entries.some(entry => entry.action === 'admin.revoke' && entry.result === 'denied'));
  assert.ok(entries.some(entry => entry.action === 'admin.bootstrap' && entry.actorId === null));
  assert.ok(!JSON.stringify(entries).includes('fixture-hash'));

  await t.test('audit pages include older entries and combine action and inclusive WIB date filters', async () => {
    await query(`
      INSERT INTO balicall_admin_audit(target_id, action, result, occurred_at)
      SELECT 'AUDIT-' || n, CASE WHEN n % 2 = 0 THEN 'admin.grant' ELSE 'account.invite' END,
        'succeeded', CASE
          WHEN n = 1 THEN TIMESTAMPTZ '2025-01-01 16:59:59+00'
          WHEN n <= 4 THEN TIMESTAMPTZ '2025-01-01 17:00:00+00'
          ELSE TIMESTAMPTZ '2025-01-02 17:00:00+00' END
      FROM generate_series(1, 56) n ORDER BY n
    `);
    const first = await (await request('/admin/audit', 'admin')).json();
    const second = await (await request('/admin/audit?page=2', 'admin')).json();
    assert.equal(first.pageSize, 50);
    assert.equal(first.total, entries.length + 56);
    assert.equal(first.entries.length, 50);
    assert.equal(second.page, 2);
    assert.equal(second.total, first.total);
    assert.equal(second.entries.at(-1).targetId, 'AUDIT-1');
    assert.equal(new Set([...first.entries, ...second.entries].map(entry => entry.id)).size, first.total);
    assert.ok(first.actions.includes('admin.grant'));

    const day = '/admin/audit?from=2025-01-02&to=2025-01-02';
    const datesOnly = await (await request(day, 'admin')).json();
    assert.deepEqual(datesOnly.entries.map(entry => entry.targetId), ['AUDIT-4', 'AUDIT-3', 'AUDIT-2']);
    const filtered = await (await request(day + '&action=admin.grant&page=2', 'admin')).json();
    assert.equal(filtered.page, 1);
    assert.equal(filtered.total, 2);
    assert.deepEqual(filtered.entries.map(entry => entry.targetId), ['AUDIT-4', 'AUDIT-2']);
    const empty = await (await request(day + '&action=admin.revoke', 'admin')).json();
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.entries, []);
    for (const queryString of ['from=2025-02-30', 'from=2025-01-03&to=2025-01-02', 'page=0', 'action=admin.grant&action=admin.revoke']) {
      assert.equal((await request('/admin/audit?' + queryString, 'admin')).status, 400, queryString);
    }

    assert.ok(first.summary);
    assert.equal(first.summary.total, first.total);
    assert.equal(typeof first.summary.succeeded, 'number');
    assert.equal(typeof first.summary.denied, 'number');
    assert.equal(typeof first.summary.noChange, 'number');
    assert.ok(Array.isArray(first.actors));

    const searchRes = await (await request('/admin/audit?q=AUDIT-56', 'admin')).json();
    assert.equal(searchRes.total, 1);
    assert.equal(searchRes.entries[0].targetId, 'AUDIT-56');

    // Test searching by Indonesian action label
    const labelSearch = await (await request('/admin/audit?q=Beri+akses', 'admin')).json();
    assert.ok(labelSearch.total > 0);
    assert.ok(labelSearch.entries.every(e => e.action === 'admin.grant'));

    // Test sorting ASC vs DESC
    const ascRes = await (await request('/admin/audit?order=asc&pageSize=10', 'admin')).json();
    const descRes = await (await request('/admin/audit?order=desc&pageSize=10', 'admin')).json();
    assert.notEqual(ascRes.entries[0].id, descRes.entries[0].id);

    // Test result=failed query support
    const failedRes = await (await request('/admin/audit?result=failed', 'admin')).json();
    assert.equal(failedRes.total, 0);

    const statusRes = await (await request('/admin/audit?result=succeeded&pageSize=10', 'admin')).json();
    assert.equal(statusRes.pageSize, 10);
    assert.equal(statusRes.entries.length, 10);
    assert.ok(statusRes.entries.every(e => e.result === 'succeeded'));

    const csvRes = await request('/admin/audit/export?action=admin.grant', 'admin');
    assert.equal(csvRes.status, 200);
    assert.equal(csvRes.headers.get('content-type'), 'text/csv; charset=utf-8');
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('ID Event,Waktu (WIB),Pelaku,Target,Tindakan,Hasil'));
    assert.ok(csvText.includes('AUD-'));
    assert.ok(csvText.includes('Beri akses Super Admin'));
  });
  await t.test('processing jobs table supports filtering, failure investigation, error classification, and retry with audit', async () => {
    await query(`
      INSERT INTO balicall_recording_uploads(id, title, original_filename, owner_id, owner_name, file_size, status, stage, stt_model, diarizer, error, transcript, created_at, completed_at)
      VALUES
        ('job-1', 'Rekaman Rapat Divisi', 'divisi-meeting.mp4', $1, 'Budi QA', 2048000, 'done', null, 'whisper-small', 'none', null, '{"text":"Halo dunia"}'::jsonb, NOW() - interval '2 days', NOW() - interval '2 days' + interval '45 seconds'),
        ('job-2', 'Rapat Koordinasi IT', 'it-sync.mp3', $1, 'Budi QA', 1024000, 'failed', null, 'qwen', 'nemotron', 'Worker STT tidak dapat dijangkau. Pastikan worker berjalan.', null, NOW() - interval '1 day', null),
        ('job-3', 'Evaluasi Proyek', 'evaluasi.mp3', $1, 'Budi QA', 512000, 'failed', null, 'whisper-small', 'pyannote', 'Server dimulai ulang saat rekaman diproses. Unggah ulang rekaman.', '{"text":"Transkrip awal berhasil", "segments":[{"text":"Halo", "speaker":"SPEAKER_00", "start":0, "end":2}]}'::jsonb, NOW() - interval '3 hours', null),
        ('job-4', 'Sync Mingguan', 'sync.mp4', $1, 'Budi QA', 4096000, 'processing', 'transcribing', 'sea', 'none', null, null, NOW() - interval '5 minutes', null)
    `, [employeeId]);

    try {
      assert.equal((await request('/admin/system/jobs')).status, 401);
      await auth.createSession(hashToken(tokens.employee), employeeId, 1);
      assert.equal((await request('/admin/system/jobs', 'employee')).status, 403);
      assert.equal((await request('/admin/system/jobs', 'guest')).status, 403);

      const res = await request('/admin/system/jobs', 'admin');
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.jobs.length >= 4);

      const searchRes = await (await request('/admin/system/jobs?q=Koordinasi', 'admin')).json();
      assert.equal(searchRes.total, 1);
      assert.equal(searchRes.jobs[0].id, 'job-2');
      assert.equal(searchRes.jobs[0].errorCategory.code, 'service_unavailable');
      assert.equal(searchRes.jobs[0].canRetry, false);

      const failedRes = await (await request('/admin/system/jobs?status=failed', 'admin')).json();
      assert.ok(failedRes.jobs.every(j => j.status === 'failed'));

      const detailRes = await request('/admin/system/jobs/job-3', 'admin');
      assert.equal(detailRes.status, 200);
      const detail = await detailRes.json();
      assert.equal(detail.job.id, 'job-3');
      assert.equal(detail.job.hasTranscript, true);
      assert.equal(detail.job.segmentCount, 1);
      assert.equal(detail.job.canRetry, true);
      assert.equal(detail.job.errorCategory.code, 'interrupted');
      assert.ok(!JSON.stringify(detail).includes('Transkrip awal berhasil'));

      const retryRes = await request('/admin/system/jobs/job-3/retry', 'admin', {}, true, 'POST');
      assert.equal(retryRes.status, 200);
      const retryBody = await retryRes.json();
      assert.equal(retryBody.success, true);

      const rechecked = await (await request('/admin/system/jobs/job-3', 'admin')).json();
      assert.ok(['processing', 'done'].includes(rechecked.job.status));

      const duplicateRetry = await request('/admin/system/jobs/job-3/retry', 'admin', {}, true, 'POST');
      assert.equal(duplicateRetry.status, 409);

      const unretryable = await request('/admin/system/jobs/job-2/retry', 'admin', {}, true, 'POST');
      assert.equal(unretryable.status, 422);

      const auditRes = await (await request('/admin/audit?action=recording.retry', 'admin')).json();
      assert.ok(auditRes.entries.some(e => e.targetId === 'job-3' && e.action === 'recording.retry'));

      // Check detail reflects retryCount and retryHistory
      const afterRetryDetail = await (await request('/admin/system/jobs/job-3', 'admin')).json();
      assert.equal(afterRetryDetail.job.retryCount, 1);
      assert.ok(Array.isArray(afterRetryDetail.job.retryHistory));
      assert.equal(afterRetryDetail.job.retryHistory.length, 1);
      assert.equal(afterRetryDetail.job.retryHistory[0].action, 'recording.retry');

      // Test max retries prevention (5 attempts limit)
      await query(`
        INSERT INTO balicall_admin_audit(actor_id, target_id, action, result, reason)
        VALUES
          ($1, 'job-3', 'recording.retry', 'succeeded', 'Manual retry 2'),
          ($1, 'job-3', 'recording.retry', 'succeeded', 'Manual retry 3'),
          ($1, 'job-3', 'recording.retry', 'succeeded', 'Manual retry 4'),
          ($1, 'job-3', 'recording.retry', 'succeeded', 'Manual retry 5')
      `, [employeeId]);
      await query("UPDATE balicall_recording_uploads SET status = 'failed' WHERE id = 'job-3'");

      const maxedDetail = await (await request('/admin/system/jobs/job-3', 'admin')).json();
      assert.equal(maxedDetail.job.retryCount, 5);
      assert.equal(maxedDetail.job.canRetry, false);
      assert.ok(maxedDetail.job.retryReason.includes('maksimum'));

      const maxedRetryRes = await request('/admin/system/jobs/job-3/retry', 'admin', {}, true, 'POST');
      assert.equal(maxedRetryRes.status, 422);
      const maxedBody = await maxedRetryRes.json();
      assert.ok(maxedBody.error.includes('maksimum'));

      const sysRes = await (await request('/admin/system', 'admin')).json();
      assert.ok(sysRes.queueStats);
      assert.equal(typeof sysRes.queueStats.completed7d, 'number');
      assert.equal(typeof sysRes.queueStats.failed7d, 'number');
      assert.equal(sysRes.queueStats.windowDays, 7);

      // Verify core infrastructure metadata
      const dbService = sysRes.services.find(s => s.id === 'database');
      assert.ok(dbService);
      assert.ok(dbService.version);
      assert.ok(dbService.connectionState);
      assert.ok(dbService.lastChecked);

      const apiService = sysRes.services.find(s => s.id === 'api');
      assert.ok(apiService);
      assert.equal(apiService.version, null);
      assert.ok(apiService.lastChecked);
    } finally {
      await query("DELETE FROM balicall_recording_uploads WHERE id LIKE 'job-%'");
    }
  });

  const disabled = await start({ ...config, authEnabled: false });
  assert.equal((await disabled('/admin/access', 'admin')).status, 503);
  await t.test('activation requests can be submitted, searched, declined, and approved for login', async () => {
    const pass = 'applicant-password-12345';
    assert.equal((await request('/auth/request-activation', undefined, { name: 'Rina', email: 'rina@balitower.co.id', password: 'short' }, true, 'POST')).status, 400);
    assert.equal((await request('/auth/request-activation', undefined, { name: 'Rina Putri', email: 'rina@balitower.co.id', password: pass }, true, 'POST')).status, 201);
    assert.equal((await request('/auth/request-activation', undefined, { name: 'Budi Santoso', email: 'budi@balitower.co.id', password: pass }, true, 'POST')).status, 201);

    assert.equal((await request('/admin/activation-requests')).status, 401);
    assert.equal((await request('/admin/activation-requests', 'guest')).status, 403);
    const all = await (await request('/admin/activation-requests', 'admin')).json();
    assert.equal(all.requests.length, 2);
    const filtered = await (await request('/admin/activation-requests?q=budi', 'admin')).json();
    assert.deepEqual(filtered.requests.map(r => r.email), ['budi@balitower.co.id']);

    const rinaReq = all.requests.find(r => r.email === 'rina@balitower.co.id');
    const budiReq = all.requests.find(r => r.email === 'budi@balitower.co.id');

    assert.equal((await request('/admin/activation-requests/' + budiReq.id + '/decline', 'admin', {}, true, 'POST')).status, 200);
    assert.equal((await request('/admin/activation-requests/' + budiReq.id + '/decline', 'admin', {}, true, 'POST')).status, 409);

    assert.equal((await request('/admin/activation-requests/' + rinaReq.id + '/approve', 'admin', {}, true, 'POST')).status, 200);
    const remaining = await (await request('/admin/activation-requests', 'admin')).json();
    assert.equal(remaining.requests.length, 0);

    const loginRes = await request('/auth/login', undefined, { email: 'rina@balitower.co.id', password: pass }, true, 'POST');
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.user.email, 'rina@balitower.co.id');

    const declinedLogin = await request('/auth/login', undefined, { email: 'budi@balitower.co.id', password: pass }, true, 'POST');
    assert.equal(declinedLogin.status, 401);

    const audit = await (await request('/admin/audit', 'admin')).json();
    assert.ok(audit.entries.some(e => e.action === 'account.request.approve' && e.result === 'succeeded'));
    assert.ok(audit.entries.some(e => e.action === 'account.request.decline' && e.result === 'succeeded'));

    // An already active account can submit an activation request separately without login conflict
    const updatedPass = 'updated-password-12345';
    assert.equal((await request('/auth/request-activation', undefined, { name: 'Rina Updated', email: 'rina@balitower.co.id', password: updatedPass }, true, 'POST')).status, 201);
    const renewed = (await (await request('/admin/activation-requests?q=rina', 'admin')).json()).requests[0];
    assert.ok(renewed);
    assert.equal((await request('/admin/activation-requests/' + renewed.id + '/approve', 'admin', {}, true, 'POST')).status, 200);
    const updatedLogin = await request('/auth/login', undefined, { email: 'rina@balitower.co.id', password: updatedPass }, true, 'POST');
    assert.equal(updatedLogin.status, 200);
    assert.equal((await updatedLogin.json()).user.email, 'rina@balitower.co.id');
  });
});
