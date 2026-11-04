import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

test('join intent rejects absent rooms and joins an active room', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'balicall-join-intent-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = createApp(loadConfig({ LLM_PROVIDER: 'demo', MEETING_DATA_FILE: join(dir, 'meetings.json') }), { livekitProbe: async () => [] });
  const server = ctx.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { ctx.close(); server.close(); });
  const call = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const missing = await call({ roomName: 'QC missing', employeeId: 'participant', employeeName: 'Participant', intent: 'join' });
  assert.equal(missing.status, 404);
  assert.equal(ctx.store.meetings.size, 0);
  const host = await call({ roomName: 'QC existing', employeeId: 'host', employeeName: 'Host', intent: 'create' });
  assert.equal(host.status, 200);
  const participant = await call({ roomName: 'QC existing', employeeId: 'participant', employeeName: 'Participant', intent: 'join' });
  assert.equal(participant.status, 200);
  assert.equal(participant.data.meetingId, host.data.meetingId);
  assert.equal(ctx.store.get(host.data.meetingId).hostId, 'host');
  const legacy = await call({ roomName: 'QC legacy', employeeId: 'legacy', employeeName: 'Legacy' });
  assert.equal(legacy.status, 200);
});
