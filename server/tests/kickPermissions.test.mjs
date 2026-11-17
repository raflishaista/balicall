import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomServiceClient } from 'livekit-server-sdk';
import { hashToken } from '../authStore.js';
process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

test('only host can kick normal users, while super admin can kick hosts and other users', async t => {
  const removed = [];
  t.mock.method(RoomServiceClient.prototype, 'removeParticipant', async (_room, id) => {
    removed.push(id);
  });

  const dir = mkdtempSync(join(tmpdir(), 'balicall-kick-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const coHostToken = 'c'.repeat(43);
  const userToken = 'u'.repeat(43);
  const superToken = 's'.repeat(43);

  const users = {
    [hashToken(hostToken)]: { employeeId: 'BT-10001', name: 'Host User', email: 'host@example.test', department: 'IT', position: 'Host', isSuperAdmin: false },
    [hashToken(coHostToken)]: { employeeId: 'BT-10002', name: 'CoHost User', email: 'cohost@example.test', department: 'IT', position: 'CoHost', isSuperAdmin: false },
    [hashToken(userToken)]: { employeeId: 'BT-10003', name: 'Normal User', email: 'user@example.test', department: 'IT', position: 'User', isSuperAdmin: false },
    [hashToken(superToken)]: { employeeId: 'BT-10004', name: 'Super Admin', email: 'super@example.test', department: 'IT', position: 'Admin', isSuperAdmin: true },
  };

  const config = {
    ...loadConfig({
      ...process.env,
      AUTH_ENABLED: 'true',
      VERIFY_EMPLOYEE_ID: 'false',
      LLM_PROVIDER: 'demo',
      LIVEKIT_API_KEY: 'testkey',
      LIVEKIT_API_SECRET: 'testsecret123456789012345678901234',
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      RECORDING_UPLOAD_DIR: join(dir, 'uploads'),
    }),
    dataFile: join(dir, 'meetings.json'),
  };
  const authStore = { async session(hash) { return users[hash] || null; }, async revoke() {} };
  const context = createApp(config, { authStore, livekitProbe: async () => true });
  const store = context.store;
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headersFor = (cookieToken, bearer) => ({
    'Content-Type': 'application/json',
    Cookie: `balicall_session=${cookieToken}`,
    'X-CSRF-Token': hashToken(`balicall-csrf:${cookieToken}`),
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  });

  const createRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(hostToken),
    body: JSON.stringify({ roomName: 'Kick Perm Room', intent: 'create' }),
  });
  const { meetingId, roomCode, token: hostLk } = await createRes.json();

  const joinAs = async tok => {
    const res = await fetch(`${base}/token`, {
      method: 'POST',
      headers: headersFor(tok),
      body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).token;
  };

  const coHostLk = await joinAs(coHostToken);
  const userLk = await joinAs(userToken);
  const superLk = await joinAs(superToken);

  // Promote BT-10002 to co-host
  const promoteRes = await fetch(`${base}/meetings/${meetingId}/participants/BT-10002/role`, {
    method: 'PATCH',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ role: 'co-host' }),
  });
  assert.equal(promoteRes.status, 200);

  // Co-host cannot kick normal user
  const coHostKick = await fetch(`${base}/meetings/${meetingId}/participants/BT-10003`, {
    method: 'DELETE',
    headers: headersFor(coHostToken, coHostLk),
  });
  assert.equal(coHostKick.status, 403);

  // Normal user cannot kick anyone
  const userKick = await fetch(`${base}/meetings/${meetingId}/participants/BT-10002`, {
    method: 'DELETE',
    headers: headersFor(userToken, userLk),
  });
  assert.equal(userKick.status, 403);

  // Host cannot kick co-host, but CAN kick normal user
  const hostKickCoHost = await fetch(`${base}/meetings/${meetingId}/participants/BT-10002`, {
    method: 'DELETE',
    headers: headersFor(hostToken, hostLk),
  });
  assert.equal(hostKickCoHost.status, 403);

  const hostKickUser = await fetch(`${base}/meetings/${meetingId}/participants/BT-10003`, {
    method: 'DELETE',
    headers: headersFor(hostToken, hostLk),
  });
  assert.equal(hostKickUser.status, 200);

  // Super Admin can kick co-host AND host
  const superKickCoHost = await fetch(`${base}/meetings/${meetingId}/participants/BT-10002`, {
    method: 'DELETE',
    headers: headersFor(superToken, superLk),
  });
  assert.equal(superKickCoHost.status, 200);

  const superKickHost = await fetch(`${base}/meetings/${meetingId}/participants/BT-10001`, {
    method: 'DELETE',
    headers: headersFor(superToken, superLk),
  });
  assert.equal(superKickHost.status, 200);

  assert.deepEqual(removed, ['BT-10003', 'BT-10002', 'BT-10001']);
});

test('kicking a guest succeeds even if LiveKit reports participant does not exist', async t => {
  t.mock.method(RoomServiceClient.prototype, 'removeParticipant', async () => {
    throw new Error('twirp error unknown: participant does not exist');
  });

  const dir = mkdtempSync(join(tmpdir(), 'balicall-kick-guest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const host = { employeeId: 'BT-20001', name: 'Host User', email: 'host2@example.test', department: 'IT', position: 'Host', isSuperAdmin: false };
  const config = {
    ...loadConfig({
      ...process.env,
      AUTH_ENABLED: 'true',
      VERIFY_EMPLOYEE_ID: 'false',
      LLM_PROVIDER: 'demo',
      LIVEKIT_API_KEY: 'testkey',
      LIVEKIT_API_SECRET: 'testsecret123456789012345678901234',
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      RECORDING_UPLOAD_DIR: join(dir, 'uploads'),
    }),
    dataFile: join(dir, 'meetings.json'),
  };
  const authStore = { async session(hash) { return hash === hashToken(hostToken) ? host : null; }, async revoke() {} };
  const context = createApp(config, { authStore, livekitProbe: async () => true });
  const store = context.store;
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const hostHeaders = {
    'Content-Type': 'application/json',
    Cookie: `balicall_session=${hostToken}`,
    'X-CSRF-Token': hashToken(`balicall-csrf:${hostToken}`),
  };

  const createRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: hostHeaders,
    body: JSON.stringify({ roomName: 'Guest Kick Room', intent: 'create' }),
  });
  const { meetingId, roomCode, token: hostLk } = await createRes.json();

  const guestLogin = await fetch(`${base}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'kulkul', inviteCode: roomCode }),
  });
  assert.equal(guestLogin.status, 200);
  const { user: guestUser } = await guestLogin.json();

  const kickGuest = await fetch(`${base}/meetings/${meetingId}/participants/${encodeURIComponent(guestUser.employeeId)}`, {
    method: 'DELETE',
    headers: { ...hostHeaders, Authorization: `Bearer ${hostLk}` },
  });
  assert.equal(kickGuest.status, 200);
  const body = await kickGuest.json();
  assert.equal(body.success, true);
  assert.equal(body.removed, guestUser.employeeId);
  const storedMeeting = [...store.meetings.values()].find(m => m.id === meetingId);
  assert.ok(storedMeeting?.participants.get(guestUser.employeeId)?.leftAt);
});
