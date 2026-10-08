import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { startLiveTranscription } from '../src/liveTranscription.ts';

test('worklet resamples 48kHz to 16kHz PCM and flushes the last packet', () => {
  let Processor;
  const chunks = [];
  const context = vm.createContext({ sampleRate: 48000, Int16Array,
    AudioWorkletProcessor: class { port = { postMessage: data => chunks.push(data) }; },
    registerProcessor: (_name, ctor) => { Processor = ctor; },
  });
  vm.runInContext(readFileSync(new URL('../public/live-pcm-worklet.js', import.meta.url), 'utf8'), context);
  const processor = new Processor();
  processor.process([[new Float32Array(4800).fill(.5)]]);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(new Int16Array(chunks[0]).length, 1600);
  assert.equal(new Int16Array(chunks[0])[0], 16384);
  assert.equal(chunks[1], 'flushed');
});

function environment(t) {
  const keys = ['WebSocket', 'AudioContext', 'AudioWorkletNode', 'MediaStream', 'window'];
  const saved = keys.map(key => globalThis[key]);
  t.after(() => keys.forEach((key, i) => { globalThis[key] = saved[i]; }));
  const sockets = [], contexts = [], tracks = [];
  globalThis.window = { location: { href: 'http://localhost:5187/' } };
  globalThis.WebSocket = class {
    static OPEN = 1; readyState = 1; bufferedAmount = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); setImmediate(() => this.message({ type: 'config' })); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  const node = () => ({ connect() {}, disconnect() {} });
  globalThis.AudioContext = class {
    state = 'running'; destination = {};
    audioWorklet = { addModule: async () => {} };
    constructor() { contexts.push(this); }
    createMediaStreamSource(stream) { tracks.push(stream.tracks); return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    async resume() {} async close() { this.state = 'closed'; }
  };
  globalThis.AudioWorkletNode = class {
    port = { postMessage: () => queueMicrotask(() => this.port.onmessage({ data: 'flushed' })) };
    connect() {} disconnect() {}
  };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  return { sockets, contexts, tracks };
}

test('stream finish waits for final text and ready_to_stop without stopping the LiveKit track', async t => {
  const env = environment(t), final = [], interim = [], errors = [];
  const track = { stop() { throw new Error('LiveKit owns this track'); } };
  let ready;
  const listening = new Promise(resolve => { ready = resolve; });
  const live = startLiveTranscription({ track, createSession: async () => ({ url: '/live-stt/asr?ticket=test' }),
    onFinal: text => final.push(text), onInterim: text => interim.push(text), onError: error => errors.push(error), onReady: value => { if (value) ready(); } });
  await listening;
  assert.equal(env.sockets[0].url.protocol, 'ws:'); assert.equal(env.tracks[0][0], track);
  env.sockets[0].message({ type: 'transcript', final: [], interim: 'Halo' });
  let finished = false;
  const pending = live.finish().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(env.sockets[0].sent.at(-1).byteLength, 0);
  env.sockets[0].message({ type: 'transcript', final: ['Halo semuanya.'], interim: '' });
  env.sockets[0].message({ type: 'ready_to_stop' });
  await pending;
  assert.deepEqual(final, ['Halo semuanya.']); assert.deepEqual(interim, ['Halo', '']);
  assert.deepEqual(errors, []); assert.equal(env.contexts[0].state, 'closed');
});

test('unexpected disconnect exposes an error and blocks successful finalization', async t => {
  const env = environment(t), errors = [];
  let ready;
  const listening = new Promise(resolve => { ready = resolve; });
  const live = startLiveTranscription({ track: {}, createSession: async () => ({ url: '/live-stt/asr' }),
    onFinal() {}, onInterim() {}, onError: error => errors.push(error), onReady: value => { if (value) ready(); } });
  await listening; env.sockets[0].close();
  await assert.rejects(live.finish(), /terputus/);
  assert.equal(errors.length, 1);
});
