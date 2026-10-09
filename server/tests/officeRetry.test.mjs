import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { summarize, transcribeAudio } from '../providers.js';
import { loadConfig } from '../config.js';

const valid = { title: 'Evaluasi monitoring', executiveSummary: 'Periksa koneksi.', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] };
const meeting = { roomName: 'QC', transcripts: [{ speakerName: 'Tester', text: 'Periksa koneksi.' }], participants: new Map([['BT-99001', { joinedAt: '2026-10-09', employeeName: 'Tester', employeeId: 'BT-99001' }]]) };
const config = { ...loadConfig({ LLM_PROVIDER: 'office', LLM_KEY: 'test-only' }), llmTimeoutMs: 100, llmRetryBudgetMs: 500, llmRetryDelayMs: 5 };
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }));

test('Office retries temporary HTTP failures with identical payload and succeeds', async () => {
  const bodies = []; let calls = 0;
  const result = await summarize(meeting, config, async (_url, options) => {
    bodies.push(options.body); calls++;
    return calls < 3 ? new Response('', { status: calls === 1 ? 503 : 429 }) : success();
  });
  assert.equal(calls, 3); assert.equal(new Set(bodies).size, 1);
  assert.equal(result.title, valid.title); assert.equal(result.provider, 'Office (qwen-35b)');
  assert.deepEqual(result.attendanceSummary, ['Tester (BT-99001)']);
});

test('Office retries connection refusal and per-attempt timeout', async () => {
  let calls = 0;
  await summarize(meeting, config, async (_url, { signal }) => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    if (calls === 2) await delay(1000, null, { signal });
    return success();
  });
  assert.equal(calls, 3);
});

test('Office stops after the configured retry count; retries can be disabled', async () => {
  for (const retries of [0, 2]) {
    let calls = 0;
    await assert.rejects(summarize(meeting, { ...config, llmRetryCount: retries }, async () => { calls++; return new Response('', { status: 502 }); }), error => error.status === 502);
    assert.equal(calls, retries + 1);
  }
});

test('Office does not retry permanent HTTP errors or malformed responses', async () => {
  for (const response of [() => new Response('', { status: 401 }), () => new Response('', { status: 403 }), () => new Response('', { status: 400 }), () => new Response('broken JSON'), () => new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"missing fields"}' } }] }))]) {
    let calls = 0;
    await assert.rejects(summarize(meeting, config, async () => { calls++; return response(); }));
    assert.equal(calls, 1);
  }
});

test('Retry-After beyond remaining budget fails promptly instead of retrying too early', async () => {
  for (const retryAfter of ['60', new Date(Date.now() + 60000).toUTCString()]) {
    let calls = 0; const started = Date.now();
    await assert.rejects(summarize(meeting, config, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }); }));
    assert.equal(calls, 1); assert.ok(Date.now() - started < 500);
  }
});

test('Retry-After within budget is respected', async () => {
  let calls = 0; const started = Date.now();
  await summarize(meeting, config, async () => ++calls === 1 ? new Response('', { status: 503, headers: { 'Retry-After': '0.05' } }) : success());
  assert.equal(calls, 2); assert.ok(Date.now() - started >= 45);
});

test('overall Office deadline bounds repeated timeouts and caps attempt duration', async () => {
  let calls = 0; const started = Date.now();
  await assert.rejects(summarize(meeting, { ...config, llmRetryBudgetMs: 180 }, async (_url, { signal }) => { calls++; await delay(1000, null, { signal }); }), error => error.status === 504);
  // A busy event loop may consume the budget before the second attempt starts.
  // The deadline must win over the configured attempt count in that case.
  assert.ok(calls >= 1 && calls <= 2); assert.ok(Date.now() - started < 700);
});

test('Office retry does not change STT retry behavior', async () => {
  let calls = 0;
  await assert.rejects(transcribeAudio(Buffer.from('test'), 'audio/webm', 'id', { ...config, sttBaseUrl: 'http://stt.test', sttModel: 'small', sttTimeoutMs: 100 }, async () => { calls++; return new Response('', { status: 503 }); }));
  assert.equal(calls, 1);
});

test('retry configuration rejects invalid values and preserves zero', () => {
  for (const env of [{ LLM_RETRY_COUNT: '-1' }, { LLM_RETRY_COUNT: '4' }, { LLM_RETRY_COUNT: '0.5' }, { LLM_RETRY_DELAY_MS: 'NaN' }, { LLM_RETRY_DELAY_MS: '5001' }, { LLM_RETRY_BUDGET_MS: '120001' }]) assert.throws(() => loadConfig(env));
  assert.equal(loadConfig({ LLM_RETRY_COUNT: '0', LLM_RETRY_DELAY_MS: '0' }).llmRetryCount, 0);
  assert.equal(loadConfig({ LLM_TIMEOUT_MS: '100' }).llmRetryBudgetMs, 200);
});
