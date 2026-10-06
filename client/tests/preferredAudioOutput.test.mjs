import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomEvent } from 'livekit-client';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { usePreferredAudioOutput } from '../src/usePreferredAudioOutput.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(t, { supported = true, devices = [{ kind: 'audiooutput', deviceId: 'speaker-2' }], switchImpl } = {}) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousElement = globalThis.HTMLMediaElement;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { enumerateDevices: async () => devices } } });
  globalThis.HTMLMediaElement = class {};
  if (supported) globalThis.HTMLMediaElement.prototype.setSinkId = () => {};
  const calls = [];
  const room = Object.assign(new EventEmitter(), { switchActiveDevice: async (kind, id) => { calls.push([kind, id]); return switchImpl ? switchImpl(kind, id) : true; } });
  let root, error;
  function Harness({ connected, outputId }) { const current = usePreferredAudioOutput(room, connected, outputId); React.useEffect(() => { error = current; }, [current]); return null; }
  const render = async (connected, outputId = 'speaker-2') => { await act(async () => { const element = React.createElement(Harness, { connected, outputId }); if (root) root.update(element); else root = create(element); }); };
  t.after(async () => { await act(async () => root?.unmount()); globalThis.HTMLMediaElement = previousElement; if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator; });
  return { render, calls, room, get error() { return error; } };
}
test('preferred output applies only after connection and does not overwrite in-call changes on reconnect', async t => {
  const h = await mount(t); await h.render(false); assert.deepEqual(h.calls, []);
  await h.render(true); assert.deepEqual(h.calls, [['audiooutput', 'speaker-2']]); assert.equal(h.error, null);
  await h.render(false); await h.render(true); assert.equal(h.calls.length, 1);
});
test('unsupported browser does not call output switching and explains default output', async t => {
  const h = await mount(t, { supported: false }); await h.render(true);
  assert.deepEqual(h.calls, []); assert.match(h.error, /belum didukung/);
});
test('missing preferred speaker uses default output without microphone/camera changes', async t => {
  const h = await mount(t, { devices: [] }); await h.render(true);
  assert.deepEqual(h.calls, [['audiooutput', 'default']]); assert.match(h.error, /tidak tersedia/);
});
test('output selection failure attempts default and remains actionable', async t => {
  const h = await mount(t, { switchImpl: async (_, id) => { if (id !== 'default') throw new Error('denied'); return true; } }); await h.render(true);
  assert.deepEqual(h.calls, [['audiooutput', 'speaker-2'], ['audiooutput', 'default']]); assert.match(h.error, /belum dapat digunakan/);
});
test('a manual output change clears the initial preference warning', async t => {
  const h = await mount(t, { devices: [] }); await h.render(true); assert.ok(h.error);
  await act(async () => h.room.emit(RoomEvent.ActiveDeviceChanged, 'audiooutput', 'new-speaker'));
  assert.equal(h.error, null);
});
test('leaving before enumeration resolves does not change a disconnected room', async t => {
  let resolve;
  const h = await mount(t);
  navigator.mediaDevices.enumerateDevices = () => new Promise(done => { resolve = done; });
  await h.render(true); await h.render(false);
  await act(async () => resolve([{ kind: 'audiooutput', deviceId: 'speaker-2' }]));
  assert.deepEqual(h.calls, []);
});
