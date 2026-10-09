import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AccessToken } from 'livekit-server-sdk';

process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Attendance condition timed out'); await delay(5); }
}
async function fixture(t, overrides = {}, dependencies = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-attendance-'));
  const config = { ...loadConfig({ LLM_PROVIDER: 'demo' }), dataFile: join(directory, 'meetings.json'), attendanceGraceMs: 20, ...overrides };
  let context, server, base;
  const start = async () => {
    context = createApp(config, { livekitProbe: async () => true, ...dependencies });
    server = context.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  await start();
  const stop = async () => { context.close(); await new Promise(r => server.close(r)); };
  t.after(async () => {
    await stop();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('balicall-attendance-'));
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(path, body, token) {
    const response = await fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: response.status, data: await response.json() };
  }
  const joined = await request('/token', { roomName: 'Attendance QC', employeeId: 'BT-99001', employeeName: 'Tester', department: 'QA' });
  assert.equal(joined.status, 200);
  const { token, meetingId } = joined.data;
  const meeting = () => context.store.get(meetingId);
  const event = (name, extra = {}) => ({ event: name, id: randomUUID(), createdAt: String(Math.floor(Date.now() / 1000)), room: { name: meeting().livekitRoom, sid: 'RM_test' }, participant: { identity: 'BT-99001', sid: 'PA_first' }, ...extra });
  const webhook = async (value, { signed = true, tampered = false } = {}) => {
    const body = JSON.stringify(value);
    const key = new AccessToken(config.livekitKey, config.livekitSecret);
    key.sha256 = createHash('sha256').update(tampered ? body + ' ' : body).digest('base64');
    const response = await fetch(base + '/api/livekit/webhook', { method: 'POST', headers: { 'Content-Type': 'application/webhook+json', ...(signed ? { Authorization: await key.toJwt() } : {}) }, body });
    return { status: response.status, data: await response.json() };
  };
  return { meeting, event, webhook, request, token, meetingId, get store() { return context.store; }, get base() { return base; }, async restart() { await stop(); await start(); } };
}

test('webhooks require real SDK signature and exact body digest even in development', async t => {
  const f = await fixture(t); const event = f.event('participant_joined');
  assert.equal((await f.webhook(event, { signed: false })).status, 401);
  assert.equal((await f.webhook(event, { tampered: true })).status, 401);
  assert.equal(f.meeting().participants.get('BT-99001').joinedAt, null);
  assert.equal((await f.webhook(event)).status, 200);
  assert.ok(f.meeting().participants.get('BT-99001').livekitJoinedAt);
});

test('join/leave updates physical attendance without prematurely ending room or blocking final text', async t => {
  const f = await fixture(t); await f.webhook(f.event('participant_joined'));
  await f.webhook(f.event('participant_left'));
  const person = f.meeting().participants.get('BT-99001');
  assert.equal(person.connected, false); assert.ok(person.livekitLeftAt); assert.equal(person.leftAt, null);
  assert.equal(f.meeting().status, 'active'); assert.equal(f.meeting().summary, null);
  const saved = await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Final queued utterance' }, f.token);
  assert.equal(saved.status, 200);
});

test('duplicate receipts survive restart and stale participant SID cannot undo reconnect', async t => {
  const f = await fixture(t); const first = f.event('participant_joined');
  await f.webhook(first); assert.equal((await f.webhook(first)).data.duplicate, true);
  await f.webhook(f.event('participant_left'));
  await f.webhook(f.event('participant_joined', { participant: { identity: 'BT-99001', sid: 'PA_second' } }));
  assert.equal(f.meeting().participants.get('BT-99001').connected, true);
  await f.webhook(f.event('participant_left')); // Old PA_first SID.
  assert.equal(f.meeting().participants.get('BT-99001').connected, true);
  await f.restart(); assert.equal((await f.webhook(first)).data.duplicate, true);
  assert.equal(f.meeting().participants.get('BT-99001').livekitParticipantSid, 'PA_second');
});

test('out-of-order join fills attendance time without resurrecting a departed participant', async t => {
  const f = await fixture(t); await f.webhook(f.event('participant_left'));
  await f.webhook(f.event('participant_joined'));
  const person = f.meeting().participants.get('BT-99001');
  assert.ok(person.livekitJoinedAt); assert.ok(person.livekitLeftAt); assert.equal(person.connected, false);
});

test('unknown rooms/identities and stale room instances cannot mutate authorized roster', async t => {
  const f = await fixture(t);
  assert.equal((await f.webhook(f.event('participant_joined', { participant: { identity: 'BT-99999', sid: 'PA_fake' } }))).data.ignored, 'unknown-participant');
  assert.equal((await f.webhook(f.event('room_finished', { room: { name: 'unknown', sid: 'RM_other' } }))).data.ignored, 'unknown-room');
  await f.webhook(f.event('participant_joined'));
  assert.equal((await f.webhook(f.event('room_finished', { room: { name: f.meeting().livekitRoom, sid: 'RM_old' } }))).data.ignored, 'old-room-instance');
  assert.equal(f.meeting().participants.size, 1); assert.equal(f.meeting().attendanceFinalization, undefined);
});

test('room_finished generates one summary and shares work with concurrent manual request', async t => {
  let calls = 0;
  const summary = { title: 'Attendance summary', executiveSummary: 'Done', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] };
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test', llmRetryCount: 0 }, { fetchImpl: async () => { calls++; await delay(50); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] })); } });
  await f.webhook(f.event('participant_joined'));
  await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Saved dialogue' }, f.token);
  const finished = f.event('room_finished'); assert.equal((await f.webhook(finished)).status, 200);
  assert.equal((await f.webhook(finished)).data.duplicate, true);
  const manual = f.request(`/meetings/${f.meetingId}/summarize`, {}, f.token);
  await until(() => f.meeting().attendanceFinalization.status === 'complete');
  assert.equal((await manual).status, 200); assert.equal(calls, 1);
  assert.equal(f.meeting().status, 'ended'); assert.ok(f.meeting().participants.get('BT-99001').leftAt);
});

test('empty room skips AI and issued-but-never-connected token is not attendance', async t => {
  let calls = 0;
  const f = await fixture(t, {}, { fetchImpl: async () => { calls++; throw new Error('No AI expected'); } });
  await f.webhook(f.event('room_finished'));
  await until(() => f.meeting().attendanceFinalization.status === 'skipped');
  assert.equal(calls, 0); assert.equal(f.meeting().summary, null);
  assert.equal(f.meeting().participants.get('BT-99001').joinedAt, null);
});

test('pending room finalization survives restart and a new call gets a different room', async t => {
  const f = await fixture(t, { attendanceGraceMs: 100 });
  await f.webhook(f.event('participant_joined'));
  await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Saved before restart' }, f.token);
  await f.webhook(f.event('room_finished'));
  const next = await f.request('/token', { roomName: 'Attendance QC', employeeId: 'BT-99002', employeeName: 'Next', department: 'QA' });
  assert.notEqual(next.data.meetingId, f.meetingId);
  await f.restart(); await until(() => f.meeting().attendanceFinalization.status === 'complete');
  assert.equal(f.meeting().summary.transcriptCount, 1);
});

test('auto-summary failure preserves transcripts and manual retry recovers', async t => {
  let recovered = false;
  const valid = { title: 'Recovered', executiveSummary: 'Done', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] };
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test', llmRetryCount: 0 }, { fetchImpl: async () => recovered ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] })) : new Response('', { status: 503 }) });
  await f.webhook(f.event('participant_joined')); await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Keep this transcript' }, f.token);
  await f.webhook(f.event('room_finished')); await until(() => f.meeting().attendanceFinalization.status === 'failed');
  assert.equal(f.meeting().transcripts.length, 1); assert.equal(f.meeting().summary, null);
  recovered = true; assert.equal((await f.request(`/meetings/${f.meetingId}/summarize`, {}, f.token)).status, 200);
  assert.equal(f.meeting().attendanceFinalization.status, 'complete');
});

test('room finalization drains accepted STT before closing and rejects new uploads after grace', async t => {
  let release, started = false;
  const f = await fixture(t, { sttProvider: 'server', sttBaseUrl: 'http://stt.test', sttModel: 'small', sttModels: ['small'], attendanceGraceMs: 10 }, { fetchImpl: async () => { started = true; await new Promise(r => { release = r; }); return new Response(JSON.stringify({ text: 'Final audio transcript' })); } });
  await f.webhook(f.event('participant_joined'));
  const upload = fetch(`${f.base}/api/meetings/${f.meetingId}/audio`, { method: 'POST', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'audio/webm', 'X-Request-Id': 'final-audio' }, body: 'test audio' });
  await until(() => started); await f.webhook(f.event('participant_left')); await f.webhook(f.event('room_finished'));
  await until(() => f.meeting().closingForUploads);
  assert.equal(f.meeting().status, 'active');
  assert.equal((await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Too late' }, f.token)).status, 409);
  release(); assert.equal((await upload).status, 200);
  await until(() => f.meeting().attendanceFinalization.status === 'complete');
  assert.equal(f.meeting().summary.transcriptCount, 1); assert.equal(f.meeting().transcripts[0].text, 'Final audio transcript');
});

test('attendance finalization grace is bounded', () => {
  for (const value of ['-1', '30001', 'NaN', '1.5']) assert.throws(() => loadConfig({ ATTENDANCE_FINALIZE_GRACE_MS: value }));
  assert.equal(loadConfig({ ATTENDANCE_FINALIZE_GRACE_MS: '0' }).attendanceGraceMs, 0);
});

test('automatic minutes replace a concurrent manual snapshot missing the last utterance', async t => {
  let calls = 0, release;
  const valid = { title: 'Complete minutes', executiveSummary: 'Done', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] };
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test', llmRetryCount: 0, attendanceGraceMs: 0 }, { fetchImpl: async () => {
    calls++;
    if (calls === 1) await new Promise(r => { release = r; });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
  } });
  await f.webhook(f.event('participant_joined'));
  await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Initial utterance' }, f.token);
  const manual = f.request(`/meetings/${f.meetingId}/summarize`, {}, f.token);
  await until(() => release);
  await f.request(`/meetings/${f.meetingId}/transcript`, { text: 'Last utterance' }, f.token);
  await f.webhook(f.event('room_finished'));
  await until(() => f.meeting().attendanceFinalization.status === 'processing');
  release(); assert.equal((await manual).status, 200);
  await until(() => f.meeting().attendanceFinalization.status === 'complete');
  assert.equal(calls, 2); assert.equal(f.meeting().summary.transcriptCount, 2);
});
