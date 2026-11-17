import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

process.env.DATABASE_URL = '';
const database = new PGlite();
const query = async (sql, params) => {
  return params?.length ? database.query(sql, params)
    : database.exec(sql).then(results => results.at(-1));
};

const originalPool = Object.getOwnPropertyDescriptor(pg, 'Pool');
Object.defineProperty(pg, 'Pool', {
  configurable: true,
  value: class {
    on() {}
    query(sql, params) { return query(sql, params); }
    async connect() { return { query, release() {} }; }
  },
});

const { initDb } = await import('../db.js');
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');
const { hashToken, initAuthDb, PgAuthStore } = await import('../authStore.js');
const { TokenVerifier } = await import('livekit-server-sdk');
Object.defineProperty(pg, 'Pool', originalPool);

test('Private Observer Mode: complete security, RBAC, media permissions, and audit verification', async t => {
  t.after(() => database.close());
  assert.equal(await initDb('postgresql://synthetic/in-memory'), true);

  const superAdminId = 'BT-88001';
  const normalUserId = 'BT-88002';
  const hostUserId = 'BT-88003';

  // Seed employees
  for (const [id, name, dept] of [
    [superAdminId, 'Super Admin User', 'Compliance & Security'],
    [normalUserId, 'Normal Staff', 'Operations'],
    [hostUserId, 'Meeting Host', 'Engineering'],
  ]) {
    await query(`
      INSERT INTO balicall_employees (employee_id, name, email, department, position, status)
      VALUES ($1, $2, $3, $4, 'Staff', 'active')
    `, [id, name, `${id.toLowerCase()}@balitower.co.id`, dept]);
  }

  await initAuthDb();

  // Mark super admin role
  await query(`
    INSERT INTO balicall_admin_roles (employee_id, role)
    VALUES ($1, 'super_admin')
    ON CONFLICT (employee_id) DO NOTHING
  `, [superAdminId]);

  // Set password hashes so accounts are activated
  await query(`
    UPDATE balicall_auth_accounts SET password_hash = 'fixture-hash'
    WHERE employee_id IN ($1, $2, $3)
  `, [superAdminId, normalUserId, hostUserId]);

  const auth = new PgAuthStore();
  const tokens = {
    superAdmin: 's'.repeat(43),
    normalUser: 'n'.repeat(43),
    hostUser: 'h'.repeat(43),
  };

  await auth.createSession(hashToken(tokens.superAdmin), superAdminId, 1);
  await auth.createSession(hashToken(tokens.normalUser), normalUserId, 1);
  await auth.createSession(hashToken(tokens.hostUser), hostUserId, 1);

  const directory = await mkdtemp(join(tmpdir(), 'balicall-observer-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }).catch(() => {}));

  const config = loadConfig({
    AUTH_ENABLED: 'true',
    DATA_FILE: join(directory, 'meetings.json'),
    LIVEKIT_KEY: 'test-lk-key',
    LIVEKIT_SECRET: 'test-lk-secret-must-be-long-enough-32-chars!',
  });

  const removedParticipants = [];
  const updatedMetadata = [];
  const mockRoomService = {
    listRooms: async () => [{ name: 'meeting-test-room-1', numParticipants: 2 }],
    listParticipants: async () => [],
    updateRoomMetadata: async (room, metadata) => {
      updatedMetadata.push({ room, metadata: JSON.parse(metadata) });
      return {};
    },
    removeParticipant: async (room, identity) => {
      removedParticipants.push({ room, identity });
      return {};
    },
  };

  const context = createApp(config, {
    authStore: auth,
    livekitProbe: () => mockRoomService.listRooms(),
  });

  // Mock server request helper
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const request = (path, roleToken, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (roleToken) {
      headers.Cookie = `balicall_session=${roleToken}`;
      headers['X-CSRF-Token'] = hashToken(`balicall-csrf:${roleToken}`);
    }
    return fetch(`${base}${path}`, {
      ...options,
      headers,
    });
  };

  // Create an active meeting in meetingStore
  const meeting = context.store.join('Security Strategy Review', {
    employeeId: hostUserId,
    employeeName: 'Meeting Host',
    department: 'Engineering',
  });
  const meetingId = meeting.id;
  assert.ok(meetingId, 'Meeting must be created and have an ID');

  // ============================================================
  // Scenario 1: Normal user cannot access observer routes
  // ============================================================
  const normalObserverRes = await request('/admin/observer/sessions', tokens.normalUser, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, accessReason: 'Ingin memantau tanpa izin' }),
  });
  assert.equal(normalObserverRes.status, 403, 'Normal user must be forbidden from observer API');

  const normalMonitorRes = await request('/admin/live-monitor', tokens.normalUser);
  assert.equal(normalMonitorRes.status, 403, 'Normal user must be forbidden from Live Monitor API');

  // ============================================================
  // Scenario 2: Meeting host cannot grant unauthorized access
  // ============================================================
  const hostObserverRes = await request('/admin/observer/sessions', tokens.hostUser, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, accessReason: 'Host ingin memantau' }),
  });
  assert.equal(hostObserverRes.status, 403, 'Meeting host cannot access observer endpoints without Super Admin role');

  // ============================================================
  // Scenario 3: Super Admin can request authorized access
  // ============================================================
  // Should reject if reason is missing or too short (< 5 chars)
  const invalidReasonRes = await request('/admin/observer/sessions', tokens.superAdmin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, accessReason: 'abc' }),
  });
  assert.equal(invalidReasonRes.status, 400, 'Must reject access request with insufficient reason');

  // Should succeed with valid reason
  const validAccessReason = 'Audit Kepatuhan SLA Audio-Video Tahunan';
  const observeRes = await request('/admin/observer/sessions', tokens.superAdmin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, accessReason: validAccessReason }),
  });
  assert.equal(observeRes.status, 201, 'Super Admin must receive 201 Created');
  const observeData = await observeRes.json();
  assert.equal(observeData.success, true);
  assert.ok(observeData.observerId, 'Must return observerId');
  assert.ok(observeData.token, 'Must return LiveKit observer token');
  assert.equal(observeData.session.sessionStatus, 'active');
  assert.equal(observeData.session.accessReason, validAccessReason);

  const observerId = observeData.observerId;
  const observerToken = observeData.token;

  // ============================================================
  // Scenario 4: Observer does not appear as a normal participant
  // ============================================================
  const verifier = new TokenVerifier(config.livekitKey, config.livekitSecret);
  const claims = await verifier.verify(observerToken);
  assert.equal(claims.video?.hidden, true, 'LiveKit grant must have hidden: true');
  assert.ok(claims.sub.startsWith('observer-'), 'Identity must indicate observer identity');

  // ============================================================
  // Scenario 5: Observer cannot publish audio
  // ============================================================
  assert.equal(claims.video?.canPublish, false, 'Observer token must prohibit publishing tracks');
  assert.deepEqual(claims.video?.canPublishSources, [], 'Observer token must explicitly have empty publish sources');

  // ============================================================
  // Scenario 6: Observer cannot publish video
  // ============================================================
  assert.equal(claims.video?.canPublish, false, 'Observer cannot publish video');

  // ============================================================
  // Scenario 7: Observer cannot send chat
  // ============================================================
  assert.equal(claims.video?.canPublishData, false, 'Observer cannot send data / chat');

  // ============================================================
  // Scenario 8: Observer cannot share screen
  // ============================================================
  assert.equal(claims.video?.canPublish, false, 'Observer cannot publish screen tracks');

  // ============================================================
  // Scenario 9: Observer cannot modify meeting settings
  // ============================================================
  const muteAttemptRes = await request(`/meetings/${meetingId}/participants/${normalUserId}/mute`, tokens.superAdmin, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${observerToken}`,
      'Content-Type': 'application/json',
    },
  });
  assert.equal(muteAttemptRes.status, 403, 'Observer must be blocked from muting participants');
  const muteErr = await muteAttemptRes.json();
  assert.equal(muteErr.code, 'OBSERVER_READ_ONLY');

  // ============================================================
  // Scenario 10: Observer session expires correctly
  // ============================================================
  const activeSessionsRes = await request('/admin/observer/sessions/active', tokens.superAdmin);
  assert.equal(activeSessionsRes.status, 200);
  const { sessions } = await activeSessionsRes.json();
  assert.ok(sessions.some(s => s.observerId === observerId), 'Current session must appear in active sessions');

  // Fast forward expiry in database
  await query(`
    UPDATE balicall_observer_sessions
    SET expires_at = NOW() - INTERVAL '1 minute'
    WHERE observer_id = $1
  `, [observerId]);

  const expiredSessionsRes = await request('/admin/observer/sessions/active', tokens.superAdmin);
  const expiredData = await expiredSessionsRes.json();
  assert.ok(!expiredData.sessions.some(s => s.observerId === observerId), 'Expired session must not appear in active sessions');

  // Verify session status in DB transitioned to 'expired'
  const adminStoreModule = await import('../adminStore.js');
  const sessionDetail = await (new adminStoreModule.PgAdminStore()).getObserverSession(observerId);
  assert.equal(sessionDetail.sessionStatus, 'expired', 'Session must be transitioned to expired');

  // ============================================================
  // Scenario 11: Audit records are created correctly
  // ============================================================
  const auditRes = await request('/admin/audit', tokens.superAdmin);
  assert.equal(auditRes.status, 200);
  const auditData = await auditRes.json();
  const startAudit = auditData.entries.find(e => e.action === 'observer.session.start');
  assert.ok(startAudit, 'Audit record for observer.session.start must exist');
  assert.equal(startAudit.actorId, superAdminId);
  assert.equal(startAudit.targetId, meetingId);
  assert.equal(startAudit.reason, validAccessReason);
  assert.equal(startAudit.result, 'succeeded');

  // ============================================================
  // Scenario 12: Revoked authorization immediately terminates access
  // ============================================================
  // Create a second observer session to test revocation
  const observeRes2 = await request('/admin/observer/sessions', tokens.superAdmin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, accessReason: 'Pemeriksaan investigasi insiden keamanan' }),
  });
  assert.equal(observeRes2.status, 201);
  const observer2 = await observeRes2.json();

  const revokeRes = await request(`/admin/observer/sessions/${observer2.observerId}/revoke`, tokens.superAdmin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Dibatalkan oleh CISO' }),
  });
  assert.equal(revokeRes.status, 200);
  const revokeData = await revokeRes.json();
  assert.equal(revokeData.sessionStatus, 'revoked');

  // Check audit for revocation
  const auditRevoke = await request('/admin/audit', tokens.superAdmin);
  const revokeAuditEntry = (await auditRevoke.json()).entries.find(e => e.action === 'observer.session.revoked');
  assert.ok(revokeAuditEntry, 'Audit log for observer.session.revoked must exist');
  assert.match(revokeAuditEntry.reason, /durasi: \d+ detik/);
  assert.ok(revokeAuditEntry.newValue.includes('durationSeconds'));

  // ============================================================
  // Scenario 13: Observer cannot bypass permissions through API calls
  // ============================================================
  // Attempting to call /api/token with observer identity
  const bypassRes = await request('/token', tokens.normalUser, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName: 'Security Strategy Review',
      employeeId: 'observer-BT-88001-fake',
      employeeName: 'Bypasser',
      intent: 'join',
    }),
  });
  assert.equal(bypassRes.status, 403, 'Cannot join meeting with observer identity');

  // Attempting to modify meeting or post actions with observer token
  const fileBypassRes = await request(`/meetings/${meetingId}/speaker-name`, tokens.superAdmin, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${observerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Hacked Name' }),
  });
  assert.equal(fileBypassRes.status, 403, 'Cannot modify meeting state with observer token');
  const fileBypassData = await fileBypassRes.json();
  assert.equal(fileBypassData.code, 'OBSERVER_READ_ONLY');

  // Check that policy violations were logged to audit
  const auditPolicy = await request('/admin/audit', tokens.superAdmin);
  const violations = (await auditPolicy.json()).entries.filter(e => e.action === 'observer.policy.violation');
  assert.ok(violations.length >= 2, 'Policy violations must be audited');

  // ============================================================
  // Scenario 14: Encryption restrictions are respected
  // ============================================================
  // Token is verified cryptographically by TokenVerifier
  const verifiedClaims = await verifier.verify(observerToken);
  assert.equal(verifiedClaims.iss, config.livekitKey);
  assert.equal(verifiedClaims.video.room, `meeting-${meetingId}`);
  assert.equal(verifiedClaims.video.canSubscribe, true);
  assert.equal(verifiedClaims.video.canPublish, false);
});
