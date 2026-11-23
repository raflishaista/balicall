import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashToken } from '../authStore.js';

process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

test('single call supports 100+ concurrent employee participants while guests from one IP cap at 30 per 15 minutes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-limit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const EMPLOYEE_COUNT = 100;
  const hostToken = 'h'.repeat(43);
  const users = {
    [hashToken(hostToken)]: {
      employeeId: 'BT-HOST-01',
      name: 'Host Stress Test',
      email: 'host.stress@balitower.test',
      department: 'IT',
      position: 'Host',
    },
  };

  const participantTokens = [];
  for (let i = 1; i <= EMPLOYEE_COUNT; i++) {
    const tok = `p${String(i).padStart(4, '0')}`.padEnd(43, 'x');
    participantTokens.push({
      tok,
      employeeId: `BT-SIM-${String(i).padStart(4, '0')}`,
      name: `Dummy User ${i}`,
    });
    users[hashToken(tok)] = {
      employeeId: `BT-SIM-${String(i).padStart(4, '0')}`,
      name: `Dummy User ${i}`,
      email: `dummy${i}@balitower.test`,
      department: 'Engineering',
      position: 'Tester',
    };
  }

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

  const authStore = {
    async session(hash) {
      return users[hash] || null;
    },
    async revoke() {},
  };

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

  // 1. Host creates the meeting room
  const createRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: headersFor(hostToken),
    body: JSON.stringify({ roomName: '100 User Load Test', intent: 'create' }),
  });
  assert.equal(createRes.status, 200);
  const { meetingId, roomCode, token: hostLk } = await createRes.json();

  // 2. Join 100 dummy employees concurrently in batches of 25
  const joinedUsers = [];
  for (let offset = 0; offset < participantTokens.length; offset += 25) {
    const batch = participantTokens.slice(offset, offset + 25);
    const results = await Promise.all(
      batch.map(async u => {
        const res = await fetch(`${base}/token`, {
          method: 'POST',
          headers: headersFor(u.tok),
          body: JSON.stringify({ roomName: roomCode, roomCode, intent: 'join' }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        const pres = await fetch(`${base}/meetings/${meetingId}/presence`, {
          method: 'POST',
          headers: headersFor(u.tok, body.token),
          body: JSON.stringify({ connected: true }),
        });
        assert.equal(pres.status, 200);
        return { ...u, lkToken: body.token };
      })
    );
    joinedUsers.push(...results);
  }
  assert.equal(joinedUsers.length, EMPLOYEE_COUNT);

  // 3. Verify guest per-IP rate limit: first 30 guests succeed, 31st gets 429
  let guestSuccessCount = 0;
  let guestRateLimitedStatus = null;
  for (let g = 1; g <= 31; g++) {
    const gRes = await fetch(`${base}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Guest ${g}`, inviteCode: roomCode }),
    });
    if (gRes.status === 200) {
      guestSuccessCount += 1;
    } else {
      guestRateLimitedStatus = gRes.status;
    }
  }
  assert.equal(guestSuccessCount, 30);
  assert.equal(guestRateLimitedStatus, 429);

  // 4. Verify meeting state with 131 active participants (1 host + 100 employees + 30 guests)
  const stateRes = await fetch(`${base}/meetings/${meetingId}/transcript`, {
    headers: headersFor(hostToken, hostLk),
  });
  assert.equal(stateRes.status, 200);
  const stateBody = await stateRes.json();
  assert.equal(stateBody.participants.length, EMPLOYEE_COUNT + 30 + 1);

  // 5. Verify auto breakout rooms distribute all 130 non-host participants across 10 rooms (13 each)
  const boRes = await fetch(`${base}/meetings/${meetingId}/breakout-rooms`, {
    method: 'POST',
    headers: headersFor(hostToken, hostLk),
    body: JSON.stringify({ roomCount: 10, mode: 'auto' }),
  });
  assert.equal(boRes.status, 201);
  const { breakout } = await boRes.json();
  assert.equal(Object.keys(breakout.assignments).length, EMPLOYEE_COUNT + 30);
});
