import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

test('create meeting generates 5-digit alphanumeric roomCode and join with roomCode succeeds', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-test-roomcode-'));
  const config = {
    ...loadConfig({ LLM_PROVIDER: 'demo' }),
    dataFile: join(directory, 'meetings.json'),
    verifyEmployeeId: false,
  };
  const context = createApp(config, {
    livekitProbe: async () => [],
    fetchImpl: () => Promise.reject(new Error('no fetch')),
  });
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  t.after(async () => {
    context.close();
    await new Promise(resolve => server.close(resolve));
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {}
  });

  // 1. Create meeting with intent: 'create'
  const createRes = await fetch(`http://127.0.0.1:${port}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName: 'Rapat Koordinasi Jaringan',
      employeeId: 'BT-00001',
      employeeName: 'Host User',
      department: 'NOC',
      intent: 'create',
    }),
  });
  assert.equal(createRes.status, 200);
  const createData = await createRes.json();
  assert.ok(createData.token);
  assert.equal(createData.roomName, 'Rapat Koordinasi Jaringan');
  assert.ok(createData.roomCode, 'roomCode should be returned');
  assert.match(createData.roomCode, /^[A-Z0-9]{5}$/, 'roomCode must be 5 alphanumeric characters');

  // 2. Join meeting with 5-digit code
  const joinRes = await fetch(`http://127.0.0.1:${port}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: createData.roomCode,
      employeeId: 'BT-00002',
      employeeName: 'Participant User',
      department: 'NOC',
      intent: 'join',
    }),
  });
  assert.equal(joinRes.status, 200);
  const joinData = await joinRes.json();
  assert.ok(joinData.token);
  assert.equal(joinData.roomName, 'Rapat Koordinasi Jaringan');
  assert.equal(joinData.roomCode, createData.roomCode);
  assert.equal(joinData.meetingId, createData.meetingId);

  // 3. Joining non-existent room code returns 404
  const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: '99999',
      employeeId: 'BT-00003',
      employeeName: 'Another User',
      department: 'NOC',
      intent: 'join',
    }),
  });
  assert.equal(notFoundRes.status, 404);
  const notFoundData = await notFoundRes.json();
  assert.match(notFoundData.error, /tidak ditemukan/i);
});
