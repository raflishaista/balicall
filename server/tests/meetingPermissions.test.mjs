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

test('host can lock screen share by role and toggle participant chat', async t => {
  const updatedPermissions = [];
  t.mock.method(RoomServiceClient.prototype, 'listParticipants', async () => [
    { identity: 'BT-30001', permission: { canSubscribe: true, canPublish: true, canPublishData: true } },
    { identity: 'BT-30002', permission: { canSubscribe: true, canPublish: true, canPublishData: true } },
    { identity: 'BT-30003', permission: { canSubscribe: true, canPublish: true, canPublishData: true } },
  ]);
  t.mock.method(RoomServiceClient.prototype, 'updateParticipant', async (_room, id, opts) => {
    updatedPermissions.push({ id, sources: opts?.permission?.canPublishSources });
  });

  const dir = mkdtempSync(join(tmpdir(), 'balicall-perms-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const coHostToken = 'c'.repeat(43);
  const userToken = 'u'.repeat(43);
  const users = {
    [hashToken(hostToken)]: { employeeId: 'BT-30001', name: 'Host User', email: 'host3@example.test', department: 'IT', position: 'Host' },
    [hashToken(coHostToken)]: { employeeId: 'BT-30002', name: 'CoHost User', email: 'co3@example.test', department: 'IT', position: 'CoHost' },
    [hashToken(userToken)]: { employeeId: 'BT-30003', name: 'Normal User', email: 'user3@example.test', department: 'IT', position: 'User' },
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
  const headersFor = (tok, bearer, json = true) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Cookie: `balicall_session=${tok}`,
    'X-CSRF-Token': hashToken(`balicall-csrf:${tok}`),
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  });

  const { meetingId, roomCode, token: hostLk } = await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(hostToken),
    body: JSON.stringify({ roomName: 'Perm Room', intent: 'create' }),
  })).json();

  const coHostLk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(coHostToken),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  const userLk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(userToken),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  await fetch(`${base}/meetings/${meetingId}/participants/BT-30002/role`, {
    method: 'PATCH',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ role: 'co-host' }),
  });

  // Non-host cannot change permissions
  const coHostAttempt = await fetch(`${base}/meetings/${meetingId}/permissions`, {
    method: 'PATCH',
    headers: headersFor(coHostToken, coHostLk),
    body: JSON.stringify({ screenSharePolicy: 'host' }),
  });
  assert.equal(coHostAttempt.status, 403);

  // Host sets screenSharePolicy = 'co-hosts' and chatDisabled = true
  const hostSet = await fetch(`${base}/meetings/${meetingId}/permissions`, {
    method: 'PATCH',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ screenSharePolicy: 'co-hosts', chatDisabled: true }),
  });
  assert.equal(hostSet.status, 200);
  const body = await hostSet.json();
  assert.equal(body.screenSharePolicy, 'co-hosts');
  assert.equal(body.chatDisabled, true);

  // Normal user lost screen share sources [3, 4], while host and co-host kept them
  assert.deepEqual(updatedPermissions.find(u => u.id === 'BT-30001')?.sources, [1, 2, 3, 4]);
  assert.deepEqual(updatedPermissions.find(u => u.id === 'BT-30002')?.sources, [1, 2, 3, 4]);
  assert.deepEqual(updatedPermissions.find(u => u.id === 'BT-30003')?.sources, [1, 2]);

  // Normal user cannot upload chat files when chatDisabled = true
  const form = new FormData();
  form.append('file', new Blob(['blocked'], { type: 'text/plain' }), 'blocked.txt');
  const userFileRes = await fetch(`${base}/meetings/${meetingId}/files`, {
    method: 'POST',
    headers: headersFor(userToken, userLk, false),
    body: form,
  });
  assert.equal(userFileRes.status, 403);
});
