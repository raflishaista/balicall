import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MeetingStore } from '../meetingStore.js';
import { hashToken } from '../authStore.js';

test('waiting room holds participants until host admits or denies them', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-wait-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const config = loadConfig({
    ...process.env,
    AUTH_ENABLED: 'false',
    LLM_PROVIDER: 'demo',
    LIVEKIT_API_KEY: 'testkey',
    LIVEKIT_API_SECRET: 'testsecret123456789012345678901234',
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    MEETINGS_FILE: join(dir, 'meetings.json'),
    RECORDING_UPLOAD_DIR: join(dir, 'uploads'),
  });

  const store = new MeetingStore(config.meetingsFile, 0);
  const context = createApp(config, { store });
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const postToken = body => fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const hostRes = await postToken({
    roomName: 'waiting-room-test',
    employeeId: 'BT-10001',
    employeeName: 'Host User',
    intent: 'create',
    waitingRoom: true,
  });
  assert.equal(hostRes.status, 200);
  const hostData = await hostRes.json();
  assert.equal(hostData.waitingRoom, true);
  assert.ok(hostData.token);

  const guest1Res = await postToken({
    roomName: hostData.roomCode,
    roomCode: hostData.roomCode,
    employeeId: 'BT-10002',
    employeeName: 'Waiting Alice',
    intent: 'join',
  });
  assert.equal(guest1Res.status, 202);
  const guest1Data = await guest1Res.json();
  assert.equal(guest1Data.waiting, true);
  assert.equal(guest1Data.meetingId, hostData.meetingId);

  const guest2Res = await postToken({
    roomName: hostData.roomCode,
    roomCode: hostData.roomCode,
    employeeId: 'BT-10003',
    employeeName: 'Waiting Bob',
    intent: 'join',
  });
  assert.equal(guest2Res.status, 202);

  const waitingStatus1 = await (await fetch(`${base}/meetings/${hostData.meetingId}/waiting-status?employeeId=BT-10002`)).json();
  assert.equal(waitingStatus1.status, 'waiting');

  const hostWaiting = await (await fetch(`${base}/meetings/${hostData.meetingId}/waiting-room`, {
    headers: { Authorization: `Bearer ${hostData.token}` },
  })).json();
  assert.equal(hostWaiting.waitingRoom, true);
  assert.deepEqual(hostWaiting.waitingUsers.map(u => u.id), ['BT-10002', 'BT-10003']);

  const denyRes = await fetch(`${base}/meetings/${hostData.meetingId}/waiting-room/BT-10003/deny`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostData.token}` },
  });
  assert.equal(denyRes.status, 200);
  const deniedStatus = await (await fetch(`${base}/meetings/${hostData.meetingId}/waiting-status?employeeId=BT-10003`)).json();
  assert.equal(deniedStatus.status, 'denied');

  const admitRes = await fetch(`${base}/meetings/${hostData.meetingId}/waiting-room/BT-10002/admit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostData.token}` },
  });
  assert.equal(admitRes.status, 200);
  const admittedStatus = await (await fetch(`${base}/meetings/${hostData.meetingId}/waiting-status?employeeId=BT-10002`)).json();
  assert.equal(admittedStatus.status, 'admitted');

  // Verify live SSE pushes immediate admission status for an already-admitted user
  const sseRes = await fetch(`${base}/meetings/${hostData.meetingId}/waiting-events?employeeId=BT-10002`);
  assert.equal(sseRes.status, 200);
  const sseText = await sseRes.text();
  assert.match(sseText, /"status":"admitted"/);

  const joinAfterAdmit = await postToken({
    roomName: hostData.roomCode,
    roomCode: hostData.roomCode,
    employeeId: 'BT-10002',
    employeeName: 'Waiting Alice',
    intent: 'join',
  });
  assert.equal(joinAfterAdmit.status, 200);
  const admittedBody = await joinAfterAdmit.json();
  assert.ok(admittedBody.token);
});

test('authenticated guest receives live SSE admission immediately when host accepts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-wait-guest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const host = { employeeId: 'BT-99001', name: 'Host', email: 'host@example.test', department: 'IT', position: 'Host' };
  const config = loadConfig({
    ...process.env,
    AUTH_ENABLED: 'true',
    VERIFY_EMPLOYEE_ID: 'false',
    LLM_PROVIDER: 'demo',
    LIVEKIT_API_KEY: 'testkey',
    LIVEKIT_API_SECRET: 'testsecret123456789012345678901234',
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    MEETINGS_FILE: join(dir, 'meetings.json'),
    RECORDING_UPLOAD_DIR: join(dir, 'uploads'),
  });
  const authStore = {
    async session(hash) { return hash === hashToken(hostToken) ? host : null; },
    async revoke() {},
  };
  const store = new MeetingStore(config.meetingsFile, 0);
  const context = createApp(config, { store, authStore });
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

  const createdRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: hostHeaders,
    body: JSON.stringify({ roomName: 'Guest Wait Room', intent: 'create', waitingRoom: true }),
  });
  assert.equal(createdRes.status, 200);
  const created = await createdRes.json();
  assert.equal(created.waitingRoom, true);

  const guestLoginRes = await fetch(`${base}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Live Guest', inviteCode: created.roomCode }),
  });
  assert.equal(guestLoginRes.status, 200);
  const guestData = await guestLoginRes.json();
  const guestCookie = guestLoginRes.headers.getSetCookie().find(c => c.startsWith('balicall_guest=')).split(';')[0];
  const guestHeaders = {
    'Content-Type': 'application/json',
    Cookie: guestCookie,
    'X-CSRF-Token': guestData.csrfToken,
  };

  const guestTokenWait = await fetch(`${base}/token`, {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({ roomName: created.roomCode, roomCode: created.roomCode, intent: 'join' }),
  });
  assert.equal(guestTokenWait.status, 202);
  const waitBody = await guestTokenWait.json();
  assert.equal(waitBody.waiting, true);

  // Guest checks waiting-status (was 403 before auth.js fix)
  const statusRes = await fetch(`${base}/meetings/${created.meetingId}/waiting-status`, { headers: { Cookie: guestCookie } });
  assert.equal(statusRes.status, 200);
  assert.equal((await statusRes.json()).status, 'waiting');

  // Guest opens live SSE stream, then host admits, and SSE receives immediate admitted event
  const abortController = new AbortController();
  const sseRes = await fetch(`${base}/meetings/${created.meetingId}/waiting-events`, {
    headers: { Cookie: guestCookie },
    signal: abortController.signal,
  });
  assert.equal(sseRes.status, 200);

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const firstChunk = await reader.read();
  buffer += decoder.decode(firstChunk.value, { stream: true });
  assert.match(buffer, /"status":"waiting"/);

  const admitRes = await fetch(`${base}/meetings/${created.meetingId}/waiting-room/${encodeURIComponent(guestData.user.employeeId)}/admit`, {
    method: 'POST',
    headers: { ...hostHeaders, Authorization: `Bearer ${created.token}` },
  });
  assert.equal(admitRes.status, 200);

  const secondChunk = await reader.read();
  buffer += decoder.decode(secondChunk.value, { stream: true });
  assert.match(buffer, /"status":"admitted"/);
  abortController.abort();

  // Guest immediately gets token on retry
  const guestTokenAdmitted = await fetch(`${base}/token`, {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({ roomName: created.roomCode, roomCode: created.roomCode, intent: 'join' }),
  });
  assert.equal(guestTokenAdmitted.status, 200);
  const admitted = await guestTokenAdmitted.json();
  assert.ok(admitted.token);
});
