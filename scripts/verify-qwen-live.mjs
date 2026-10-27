// Run on the worker host with newly generated synthetic PCM WAV fixtures only.
// Uses an isolated API store: never creates meetings in the running application's database.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
// Set before dynamic import: db.js loads .env and may otherwise create a real pool.
process.env.DATABASE_URL = '';
const { createApp } = await import('../server/app.js');
import { loadConfig } from '../server/config.js';

const [configPath, wavPath, outputPath] = process.argv.slice(2);
assert.ok(configPath && wavPath && outputPath, 'Usage: node scripts/verify-qwen-live.mjs CONFIG SYNTHETIC_16K_WAV OUTPUT_JSON');
const match = readFileSync(configPath, 'utf8').match(/^QWEN_LIVE_STT_SECRET=(.+)$/m);
assert.ok(match, 'Task-owned worker secret missing');
const secret = match[1].trim().replace(/^['"]|['"]$/g, '');
const directory = mkdtempSync(join(tmpdir(), 'balicall-qwen-proxy-'));
const context = createApp({ ...loadConfig({ LLM_PROVIDER: 'demo', QWEN_LIVE_STT_SECRET: secret,
  QWEN_LIVE_STT_URL: '/qwen-live-stt/asr' }), dataFile: join(directory, 'meetings.json') },
  { livekitProbe: async () => [] });
const server = context.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
let token;
const request = async (path, body, method = 'POST') => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data };
};
let socket;
try {
  const joined = await request('/token', { roomName: 'synthetic-qwen-proxy-check', employeeId: 'synthetic-qa', employeeName: 'Synthetic QA', department: 'Test' });
  assert.equal(joined.status, 200);
  token = joined.data.token;
  const route = suffix => `/meetings/${joined.data.meetingId}/${suffix}`;
  const session = await request(route('live-session'), { model: 'qwen3-asr-0.6b-live', language: 'en', diarize: true });
  assert.equal(session.status, 200);
  const wav = readFileSync(wavPath);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), name = wav.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') {
      assert.equal(wav.readUInt16LE(offset + 8), 1); assert.equal(wav.readUInt16LE(offset + 10), 1);
      assert.equal(wav.readUInt32LE(offset + 12), 16000); assert.equal(wav.readUInt16LE(offset + 22), 16);
    }
    if (name === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(pcm?.length);
  const url = new URL(session.data.url, 'http://127.0.0.1:5187'); url.protocol = 'ws:';
  socket = new WebSocket(url);
  const started = performance.now(); let firstInterim, stopSent; const finals = [];
  const done = new Promise((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('Proxy websocket failed')));
    socket.addEventListener('close', () => reject(new Error('Socket closed before flush acknowledgement')));
    socket.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      if (frame.type === 'error') reject(new Error(frame.error));
      if (frame.interim && firstInterim === undefined) firstInterim = (performance.now() - started) / 1000;
      finals.push(...(frame.final || []));
      if (frame.type === 'ready_to_stop') resolve();
    });
  });
  // Install the rejection handler before pacing audio.
  done.catch(() => {});
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  for (let offset = 0; offset < pcm.length; offset += 6400) {
    socket.send(pcm.subarray(offset, offset + 6400));
    await delay(Math.max(0, started + Math.min(offset + 6400, pcm.length) / 32 - performance.now()));
  }
  stopSent = (performance.now() - started) / 1000;
  socket.send(new Uint8Array());
  let timer;
  try { await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Flush timeout')), 60000); })]); }
  finally { clearTimeout(timer); }
  assert.ok(firstInterim < stopSent, 'Interim must arrive while audio streams');
  assert.ok(finals.length > 0);
  assert.equal(new Set(finals.map(final => final.segmentId)).size, finals.length);
  for (const final of finals) {
    const body = { sttModel: 'qwen3-asr-0.6b-live', final };
    const first = await request(route('transcript'), body), retry = await request(route('transcript'), body);
    assert.equal(first.status, 200); assert.equal(retry.status, 200); assert.equal(first.data.entry.id, retry.data.entry.id);
    assert.equal(first.data.entry.segments[0].sessionId, final.sessionId);
  }
  const stored = await request(route('transcript'), undefined, 'GET');
  assert.equal(stored.status, 200); assert.equal(stored.data.transcripts.length, finals.length);
  const forged = await request(route('transcript'), { sttModel: 'qwen3-asr-0.6b-live', final: { ...finals[0], sourceId: 'forged' } });
  assert.equal(forged.status, 400);
  await request(route('leave'), {});
  const report = { passed: true, fixture: 'Synthetic WAV input; voice count is not inferred by this check', via: 'API ticket → Vite websocket proxy → GPU workers → isolated API persistence',
    firstInterimSeconds: Number(firstInterim.toFixed(3)), finals: finals.length, stored: stored.data.transcripts.length,
    retryDeduplicated: true, forgedSourceRejected: true, speakers: [...new Set(finals.map(final => final.speakerLabel))] };
  writeFileSync(outputPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  socket?.close(); context.close(); await new Promise(resolve => server.close(resolve));
}
