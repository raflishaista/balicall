import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function fixture(t) {
  let tick, samples = 0, cleaned = 0, amplitude = 51, state, renders = 0, root;
  const oldDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/useMicrophoneLevel.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => name === 'react' ? React : {
    createAudioAnalyser: () => ({ cleanup: () => cleaned++, analyser: {
      frequencyBinCount: 16, getByteFrequencyData: buffer => { samples++; buffer.fill(amplitude); },
    } }),
  });
  const track = { mediaStream: {} };
  function Harness({ enabled = true }) { state = exports.useMicrophoneLevel(track, enabled); renders++; return null; }
  t.after(async () => { await act(async () => root?.unmount()); globalThis.document = oldDocument; });
  return {
    async mount() { await act(async () => { root = create(React.createElement(Harness)); }); },
    async tick() { await act(async () => tick()); },
    async disable() { await act(async () => root.update(React.createElement(Harness, { enabled: false }))); },
    set amplitude(value) { amplitude = value; },
    get state() { return state; }, get renders() { return renders; },
    get samples() { return samples; }, get cleaned() { return cleaned; },
  };
}

test('voice sampling stays at 30 Hz while meter updates are bounded to 10 Hz', async t => {
  const f = fixture(t); await f.mount(); const initial = f.renders;
  for (let i = 0; i < 30; i++) { f.amplitude = 10 + i * 6; await f.tick(); }
  assert.equal(f.samples, 30);
  assert.ok(f.renders - initial <= 10);
  assert.equal(f.state.readVolume(), 184 / 255);
});

test('background tabs keep voice detection current without rerendering the meeting', async t => {
  const f = fixture(t); await f.mount(); const initial = f.renders;
  document.visibilityState = 'hidden'; f.amplitude = 180;
  for (let i = 0; i < 30; i++) await f.tick();
  assert.equal(f.renders, initial); assert.equal(f.samples, 30);
  assert.equal(f.state.readVolume(), 180 / 255);
  document.visibilityState = 'visible';
  for (let i = 0; i < 3; i++) await f.tick();
  assert.equal(f.state.volume, 0.71);
  await f.disable(); assert.equal(f.cleaned, 1); assert.equal(f.state.readVolume(), 0); assert.equal(f.state.volume, 0);
});
