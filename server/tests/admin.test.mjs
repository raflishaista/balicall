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
    assert.deepEqual(dailyActivity[0], { date: periodStart, meetings: 0, attendances: 0 });
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
      employeeId: 'QC-22', name: 'Rina 22', department: 'QA Overview', status: 'inactive', activated: true, isSuperAdmin: false,
    }]);
    const literalSearch = await (await request('/admin/employees?q=%25', 'admin')).json();
    assert.equal(literalSearch.total, 0);
    assert.deepEqual(literalSearch.employees, []);
    assert.equal((await request('/admin/employees?page=0', 'admin')).status, 400);
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
    const last = await (await request(path + '?q=Rapat%20Arsip&page=999', 'admin')).json();
    assert.equal(last.page, Math.ceil(56 / page1.pageSize));
    assert.ok(last.meetings.some(meeting => meeting.id === 'history-1'));
    const matching = await (await request(path + '?q=100%25&from=2025-01-02&to=2025-01-02', 'admin')).json();
    assert.equal(matching.total, 2);
    assert.deepEqual(matching.meetings.map(meeting => meeting.id), ['history-1', 'history-2']);
    assert.equal(matching.meetings[0].participantCount, 1);
    assert.equal(matching.meetings[0].durationSeconds, 3300);
    assert.equal(matching.meetings[1].endedAt, null);
    assert.equal(matching.meetings[1].durationSeconds, null);
    assert.equal((await (await request(path + '?q=missing', 'admin')).json()).total, 0);
    assert.equal((await request(path + '?from=2025-01-03&to=2025-01-02', 'admin')).status, 400);
    assert.equal((await request(path + '?page=0', 'admin')).status, 400);
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
  });
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
  const disabled = await start({ ...config, authEnabled: false });
  assert.equal((await disabled('/admin/access', 'admin')).status, 503);
});
