import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MeetingStore } from '../meetingStore.js';

async function fixture(t, overrides = {}, dependencies = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-test-'));
  const config = { ...loadConfig({ LLM_PROVIDER: 'demo' }), dataFile: join(directory, 'meetings.json'), ...overrides };
  const setup = () => createApp(config, { livekitProbe: async () => [], ...dependencies });
  let context = setup();
  let server = context.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + '\\') || absolute.startsWith(resolve(tmpdir()) + '/'));
    assert.ok(directory.includes('balicall-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const request = async (path, body, token, method = 'POST', extra = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra.headers }, body: body === undefined ? undefined : JSON.stringify(body), ...extra });
    return { status: response.status, data: await response.json() };
  };
  const joinRoom = async (id = 'tester', roomName = 'regression-test') => {
    const response = await request('/token', { roomName, employeeId: id, employeeName: id, department: 'Test' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const session = response.data;
    const route = endpoint => `/meetings/${session.meetingId}/${endpoint}`;
    return { ...session, route, post: (endpoint, body = {}) => request(route(endpoint), body, session.token), get: endpoint => request(route(endpoint), undefined, session.token, 'GET') };
  };
  return { config, request, joinRoom, get store() { return context.store; }, async restart() {
    await new Promise(resolve => server.close(resolve));
    context = setup(); server = context.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  } };
}

test('tokens share one session; presence reflects actual connection and forged speaker is ignored', async t => {
  const f = await fixture(t); const a = await f.joinRoom('a'); const b = await f.joinRoom('b');
  assert.equal(a.meetingId, b.meetingId);
  assert.equal(a.token.split('.').length, 3);
  assert.equal((await a.get('transcript')).data.participants[0].joinedAt, null);
  await a.post('presence', { connected: true });
  const saved = await a.post('transcript', { text: '  Percakapan pertama  ', speakerId: 'b', speakerName: 'Impersonation', requestId: 'first' });
  assert.equal(saved.status, 200); assert.equal(saved.data.entry.text, 'Percakapan pertama');
  assert.equal(saved.data.entry.speakerId, 'a'); assert.equal(saved.data.entry.speakerName, 'a');
  assert.ok((await a.get('transcript')).data.participants[0].joinedAt);
});

test('invalid token input and duplicate identity are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/token', { roomName: {}, employeeId: 'a', employeeName: 'A' })).status, 400);
  await f.joinRoom('a');
  assert.equal((await f.request('/token', { roomName: 'regression-test', employeeId: 'a', employeeName: 'A' })).status, 409);
});

test('session data requires a valid token scoped to that meeting', async t => {
  const f = await fixture(t); const a = await f.joinRoom('a', 'one'); const b = await f.joinRoom('b', 'two');
  assert.equal((await f.request(a.route('transcript'), undefined, null, 'GET')).status, 401);
  assert.equal((await f.request(a.route('transcript'), undefined, 'invalid', 'GET')).status, 401);
  assert.equal((await f.request(a.route('transcript'), undefined, b.token, 'GET')).status, 403);
});

test('invalid transcript input returns 400', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  for (const text of [123, {}, '   ', null]) assert.equal((await a.post('transcript', { text })).status, 400);
  assert.equal((await a.post('transcript', { text: 'hi', requestId: '../bad' })).status, 400);
});

test('uncertain network retries with the same ID save exactly one transcript', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  const first = await a.post('transcript', { text: 'hanya sekali', requestId: 'same-id' });
  const second = await a.post('transcript', { text: 'hanya sekali', requestId: 'same-id' });
  assert.equal(first.data.entry.id, second.data.entry.id);
  assert.equal((await a.get('transcript')).data.transcripts.length, 1);
});

test('summary reads stored dialogue and demo never invents decisions or tasks', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  await a.post('presence', { connected: true });
  await a.post('transcript', { text: 'Belum ada keputusan' });
  const old = (await a.get('transcript')).data.transcripts;
  await a.post('transcript', { text: 'Pembahasan terbaru' });
  const summary = await a.post('summarize', { transcripts: old });
  assert.equal(summary.status, 200); assert.equal(summary.data.summary.transcriptCount, 2);
  assert.deepEqual(summary.data.summary.decisions, []); assert.deepEqual(summary.data.summary.actionItems, []);
  assert.equal(summary.data.summary.attendanceSummary.length, 1);
});

test('transcripts and tokens survive a backend restart', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  const saved = await a.post('transcript', { text: 'Tetap tersimpan setelah restart', requestId: 'persist' });
  await f.restart();
  const result = await a.get('transcript');
  assert.equal(result.status, 200); assert.equal(result.data.transcripts[0].id, saved.data.entry.id);
  assert.equal((await a.post('transcript', { text: 'repeat', requestId: 'persist' })).data.entry.id, saved.data.entry.id);
});

test('leaving one participant keeps others active; after all leave the next session is separate', async t => {
  const f = await fixture(t); const a = await f.joinRoom('a'); const b = await f.joinRoom('b');
  await a.post('transcript', { text: 'Meeting lama' });
  assert.equal((await a.post('leave')).data.status, 'active');
  assert.equal((await a.post('transcript', { text: 'after leaving' })).status, 409);
  assert.equal((await b.post('leave')).data.status, 'ended');
  const next = await f.joinRoom('a');
  assert.notEqual(next.meetingId, a.meetingId);
  assert.equal((await next.get('transcript')).data.transcripts.length, 0);
  assert.equal((await a.get('transcript')).data.transcripts.length, 1);
});

test('participant can leave first to end call and then request summary', async t => {
  const valid = { title: 'Notulen Rapat Selesai', executiveSummary: 'Ringkasan setelah selesai', keyDiscussionPoints: ['Poin 1'], decisions: [], actionItems: [], attendanceSummary: ['Tester'] };
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test-key' }, {
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] })),
  });
  const a = await f.joinRoom();
  await a.post('transcript', { text: 'Percakapan sebelum meeting selesai.' });
  const leaveRes = await a.post('leave');
  assert.equal(leaveRes.status, 200);
  assert.equal(leaveRes.data.status, 'ended');

  // Participant can still summarize after leaving
  const sumRes = await a.post('summarize');
  assert.equal(sumRes.status, 200);
  assert.equal(sumRes.data.success, true);
  assert.equal(sumRes.data.summary.title, 'Notulen Rapat Selesai');
  assert.equal(sumRes.data.meetingStatus, 'ended');
});

test('empty meeting cannot be summarized; request bodies cannot inject fake transcript history', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  assert.equal((await a.post('summarize', { transcripts: [{ text: 'fake' }] })).status, 400);
});

test('bad upstream summary schema is an error, not a successful demo fallback', async t => {
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test-key' }, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"wrong shape"}' } }] })) });
  const a = await f.joinRoom(); await a.post('transcript', { text: 'hello' });
  const result = await a.post('summarize'); assert.equal(result.status, 502); assert.match(result.data.error, /schema/);
  assert.equal((await a.get('transcript')).data.summary, null);
});

test('upstream timeout is bounded and retryable', async t => {
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test-key', llmTimeoutMs: 100 }, {
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  });
  const a = await f.joinRoom(); await a.post('transcript', { text: 'hello' });
  const start = Date.now(); const result = await a.post('summarize');
  assert.equal(result.status, 504); assert.ok(Date.now() - start < 1500);
});

test('backend STT forwards complete audio with language and keeps keys on server; retries deduplicate', async t => {
  let calls = 0;
  const f = await fixture(t, { sttProvider: 'server', sttBaseUrl: 'http://stt.test/v1', sttModel: 'test-whisper', sttKey: 'server-only' }, {
    fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'http://stt.test/v1/audio/transcriptions');
      assert.equal(options.headers.Authorization, 'Bearer server-only');
      assert.equal(options.body.get('language'), 'id'); assert.equal(options.body.get('model'), 'test-whisper');
      assert.equal(await options.body.get('file').text(), 'fake-audio-test-fixture');
      return new Response(JSON.stringify({ text: 'Hasil suara menjadi teks' }));
    },
  });
  const a = await f.joinRoom();
  const upload = () => f.request(a.route('audio'), undefined, a.token, 'POST', { headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/webm', 'X-Request-Id': 'audio-id', 'X-Speech-Language': 'id' }, body: 'fake-audio-test-fixture' });
  const [first, concurrent] = await Promise.all([upload(), upload()]);
  assert.equal(first.status, 200); assert.equal(concurrent.data.entry.id, first.data.entry.id);
  const retry = await upload(); assert.equal(retry.data.entry.id, first.data.entry.id);
  assert.equal(calls, 1); assert.equal((await a.get('transcript')).data.transcripts.length, 1);
  const health = await f.request('/health', undefined, undefined, 'GET');
  assert.equal(JSON.stringify(health.data).includes('server-only'), false);
});

test('missing STT config and unsupported audio are explicit errors', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  const result = await f.request(a.route('audio'), undefined, a.token, 'POST', { headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/webm', 'X-Request-Id': 'test', 'X-Speech-Language': 'id' }, body: 'fixture' });
  assert.equal(result.status, 503);
});

test('corrupted storage is not silently discarded', async t => {
  const f = await fixture(t); const a = await f.joinRoom(); await a.post('transcript', { text: 'stored' });
  assert.equal(JSON.parse(readFileSync(f.config.dataFile, 'utf8')).version, 1);
  const reopened = new MeetingStore(f.config.dataFile);
  assert.equal(reopened.get(a.meetingId).transcripts.length, 1);
  assert.throws(() => reopened.restore('{broken'), SyntaxError);
});

test('abandoned sessions are archived before reusing a room name', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  await a.post('transcript', { text: 'old abandoned session' });
  f.store.transact(() => { f.store.get(a.meetingId).participants.get('tester').lastSeen = new Date(Date.now() - 60000).toISOString(); });
  const next = await f.joinRoom();
  assert.notEqual(next.meetingId, a.meetingId);
  assert.equal((await next.get('transcript')).data.transcripts.length, 0);
  assert.equal((await a.get('transcript')).data.status, 'ended');
});

test('failed disk writes roll back the transcript mutation', async t => {
  const f = await fixture(t); const a = await f.joinRoom();
  const original = f.store.filename;
  f.store.filename = join(original, 'impossible-child.json');
  const response = await a.post('transcript', { text: 'not persisted', requestId: 'disk-fail' });
  assert.equal(response.status, 500);
  assert.equal(f.store.get(a.meetingId).transcripts.length, 0);
  f.store.filename = original;
  assert.equal((await a.post('transcript', { text: 'persisted after retry', requestId: 'disk-fail' })).status, 200);
});

test('empty STT responses are idempotent and do not create blank transcript rows', async t => {
  let calls = 0;
  const f = await fixture(t, { sttBaseUrl: 'http://stt.test/v1', sttModel: 'test' }, {
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ text: '   ' })); },
  });
  const a = await f.joinRoom();
  const upload = () => f.request(a.route('audio'), undefined, a.token, 'POST', { headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/webm', 'X-Request-Id': 'silence' }, body: 'fixture' });
  assert.equal((await upload()).data.entry, null);
  assert.equal((await upload()).data.entry, null);
  await f.restart(); assert.equal((await upload()).data.entry, null);
  assert.equal(calls, 1); assert.equal((await a.get('transcript')).data.transcripts.length, 0);
});

test('a slow summary cannot overwrite newer dialogue with a stale cached result', async t => {
  let release, started;
  const waitStarted = new Promise(resolve => { started = resolve; });
  const valid = { title: 'Summary', executiveSummary: 'Summary', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] };
  const f = await fixture(t, { llmProvider: 'office', llmKey: 'test' }, {
    fetchImpl: async () => { started(); await new Promise(resolve => { release = resolve; }); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] })); },
  });
  const a = await f.joinRoom(); await a.post('transcript', { text: 'first words' });
  const summarizing = a.post('summarize');
  await waitStarted; await a.post('transcript', { text: 'new words' }); release();
  assert.equal((await summarizing).data.summary.transcriptCount, 1);
  assert.equal((await a.get('transcript')).data.summary, null);
});

test('employee ID format validation rejects malformed text such as ns-12nsunauu with 400 Format ID Salah', async t => {
  const f = await fixture(t, { verifyEmployeeId: true });
  const badFormat = await f.request('/token', {
    roomName: 'test-room',
    employeeId: 'ns-12nsunauu',
    employeeName: 'Unknown',
    department: 'General',
  });
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.data.error, 'Format ID Salah.');
  assert.equal(badFormat.data.code, 'INVALID_ID_FORMAT');

  const unregistered = await f.request('/token', {
    roomName: 'test-room',
    employeeId: 'BT-99999',
    employeeName: 'Ghost',
    department: 'General',
  });
  assert.equal(unregistered.status, 403);
  assert.equal(unregistered.data.code, 'EMPLOYEE_NOT_FOUND');

  const valid = await f.request('/token', {
    roomName: 'test-room',
    employeeId: 'BT-10492',
    employeeName: 'Rafli Aditya',
    department: 'NOC & Core Network',
  });
  assert.equal(valid.status, 200);
  assert.ok(valid.data.token);
});

test('GET /api/employees returns registered directory', async t => {
  const f = await fixture(t);
  const res = await f.request('/employees', undefined, undefined, 'GET');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.employees));
  assert.ok(res.data.employees.length > 0);
});

