import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashToken } from '../authStore.js';
process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

test('host can create auto/choice breakout rooms, participants get breakout tokens, and host can close them', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-breakout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const p1Token = 'a'.repeat(43);
  const p2Token = 'b'.repeat(43);
  const users = {
    [hashToken(hostToken)]: { employeeId: 'BT-40001', name: 'Host User', email: 'host4@example.test', department: 'IT', position: 'Host' },
    [hashToken(p1Token)]: { employeeId: 'BT-40002', name: 'Participant 1', email: 'p1@example.test', department: 'IT', position: 'User' },
    [hashToken(p2Token)]: { employeeId: 'BT-40003', name: 'Participant 2', email: 'p2@example.test', department: 'IT', position: 'User' },
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
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headersFor = (tok, bearer) => ({
    'Content-Type': 'application/json',
    Cookie: `balicall_session=${tok}`,
    'X-CSRF-Token': hashToken(`balicall-csrf:${tok}`),
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  });

  const { meetingId, roomCode, token: hostLk } = await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(hostToken),
    body: JSON.stringify({ roomName: 'Breakout Test Room', intent: 'create' }),
  })).json();

  const p1Lk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(p1Token),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  const p2Lk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(p2Token),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  // Participant cannot create breakout rooms
  const nonHostCreate = await fetch(`${base}/meetings/${meetingId}/breakout-rooms`, {
    method: 'POST',
    headers: headersFor(p1Token, p1Lk),
    body: JSON.stringify({ roomCount: 2, mode: 'auto' }),
  });
  assert.equal(nonHostCreate.status, 403);

  // Host creates 2 breakout rooms in auto mode
  const autoCreate = await fetch(`${base}/meetings/${meetingId}/breakout-rooms`, {
    method: 'POST',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ roomCount: 2, mode: 'auto' }),
  });
  assert.equal(autoCreate.status, 201);
  const { breakout } = await autoCreate.json();
  assert.equal(breakout.active, true);
  assert.equal(breakout.mode, 'auto');
  assert.equal(breakout.rooms.length, 2);
  assert.equal(breakout.assignments['BT-40002'], 1);
  assert.equal(breakout.assignments['BT-40003'], 2);

  // Participant 2 fetches token for Room 2
  const tokRes = await fetch(`${base}/meetings/${meetingId}/breakout-rooms/2/token`, {
    method: 'POST',
    headers: headersFor(p2Token, p2Lk),
    body: JSON.stringify({}),
  });
  assert.equal(tokRes.status, 200);
  const tokBody = await tokRes.json();
  assert.ok(tokBody.token);
  assert.equal(tokBody.room.id, 2);

  // Host closes breakout rooms
  const closeRes = await fetch(`${base}/meetings/${meetingId}/breakout-rooms/close`, {
    method: 'POST',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({}),
  });
  assert.equal(closeRes.status, 200);
  assert.equal((await closeRes.json()).breakout, null);
});
