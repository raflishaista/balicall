import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashToken } from '../authStore.js';
process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

test('host can create/close polls, non-hosts are blocked from creating, and participants + guests can vote', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-polls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const hostToken = 'h'.repeat(43);
  const p1Token = 'a'.repeat(43);
  const users = {
    [hashToken(hostToken)]: { employeeId: 'PL-50001', name: 'Host User', email: 'host5@example.test', department: 'IT', position: 'Host' },
    [hashToken(p1Token)]: { employeeId: 'PL-50002', name: 'Participant 1', email: 'p1_5@example.test', department: 'IT', position: 'User' },
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
    body: JSON.stringify({ roomName: 'Poll Test Room', intent: 'create' }),
  })).json();

  const p1Lk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(p1Token),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  // Non-host cannot create poll
  const nonHostCreate = await fetch(`${base}/meetings/${meetingId}/polls`, {
    method: 'POST',
    headers: headersFor(p1Token, p1Lk),
    body: JSON.stringify({ title: 'Blocked Poll', options: ['A', 'B'], durationMinutes: 5 }),
  });
  assert.equal(nonHostCreate.status, 403);

  // Host creates poll
  const createRes = await fetch(`${base}/meetings/${meetingId}/polls`, {
    method: 'POST',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ title: 'Lunch choice?', options: ['Nasi Goreng', 'Mie Ayam'], durationMinutes: 10 }),
  });
  assert.equal(createRes.status, 201);
  const { poll } = await createRes.json();
  assert.equal(poll.active, true);
  assert.equal(poll.title, 'Lunch choice?');
  assert.deepEqual(poll.options, ['Nasi Goreng', 'Mie Ayam']);
  assert.deepEqual(poll.counts, [0, 0]);

  // Participant votes for option 0
  const p1Vote = await fetch(`${base}/meetings/${meetingId}/polls/vote`, {
    method: 'POST',
    headers: headersFor(p1Token, p1Lk),
    body: JSON.stringify({ optionIndex: 0 }),
  });
  assert.equal(p1Vote.status, 200);
  const p1Body = await p1Vote.json();
  assert.equal(p1Body.poll.myVote, 0);
  assert.deepEqual(p1Body.poll.counts, [1, 0]);
  assert.equal(p1Body.poll.totalVotes, 1);

  // Guest logs in, joins, and votes for option 1
  const guestLoginRes = await fetch(`${base}/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Guest Voter', inviteCode: roomCode }),
  });
  assert.equal(guestLoginRes.status, 200);
  const guestCookie = (guestLoginRes.headers.getSetCookie?.() || [])
    .map(c => c.split(';')[0])
    .find(c => c.startsWith('balicall_guest=')) || '';
  const { csrfToken: guestCsrf } = await guestLoginRes.json();
  const guestHeaders = bearer => ({
    'Content-Type': 'application/json',
    Cookie: guestCookie,
    'X-CSRF-Token': guestCsrf,
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  });

  const guestLk = (await (await fetch(`${base}/token`, {
    method: 'POST',
    headers: guestHeaders(),
    body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
  })).json()).token;

  const guestVote = await fetch(`${base}/meetings/${meetingId}/polls/vote`, {
    method: 'POST',
    headers: guestHeaders(guestLk),
    body: JSON.stringify({ optionIndex: 1 }),
  });
  assert.equal(guestVote.status, 200);
  const guestBody = await guestVote.json();
  assert.equal(guestBody.poll.myVote, 1);
  assert.deepEqual(guestBody.poll.counts, [1, 1]);
  assert.equal(guestBody.poll.totalVotes, 2);

  // Host closes poll
  const closeRes = await fetch(`${base}/meetings/${meetingId}/polls/close`, {
    method: 'POST',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({}),
  });
  assert.equal(closeRes.status, 200);
  assert.equal((await closeRes.json()).poll, null);
});
