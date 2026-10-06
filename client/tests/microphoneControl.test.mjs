import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useMicrophoneControl } from '../src/useMicrophoneControl.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function mount(t, participant, connected = true) {
  participant.getTrackPublication ??= () => undefined;
  let state, root;
  function Harness({ connected }) { const current = useMicrophoneControl(participant, connected); React.useEffect(() => { state = current; }); return null; }
  await act(async () => { root = create(React.createElement(Harness, { connected })); });
  t.after(async () => { await act(async () => root.unmount()); });
  return { get current() { return state; }, async connect(connected) { await act(async () => root.update(React.createElement(Harness, { connected }))); }, async unmount() { await act(async () => root.unmount()); } };
}
test('mute toggles existing audio without touching camera', async t => {
  const toggles = [], track = { stop() {} };
  const participant = { isMicrophoneEnabled: true, isCameraEnabled: true, getTrackPublication: () => ({ track }),
    async setMicrophoneEnabled(enabled) { toggles.push(enabled); this.isMicrophoneEnabled = enabled; return { track }; } };
  const h = await mount(t, participant);
  await act(async () => { await h.current.toggleMicrophone(); await h.current.toggleMicrophone(); });
  assert.deepEqual(toggles, [false, true]); assert.equal(participant.isCameraEnabled, true);
});
test('first enable owns input before publication and uses only audio capture', async t => {
  let captured, source, stopped = false;
  const track = { kind: 'audio', stop() { stopped = true; } };
  const participant = { isMicrophoneEnabled: false, async createTracks(options) { captured = options; return [track]; },
    async publishTrack(value, options) { assert.equal(value, track); source = options.source; return { track }; } };
  const h = await mount(t, participant);
  await act(async () => { await h.current.toggleMicrophone(); });
  assert.deepEqual(captured, { audio: true, video: false }); assert.equal(source, 'microphone'); assert.equal(stopped, false);
});
test('pending microphone operation suppresses repeated clicks and clears loading', async t => {
  let resolve, task, calls = 0;
  const participant = { isMicrophoneEnabled: true, setMicrophoneEnabled() { calls++; return new Promise(done => { resolve = done; }); } };
  const h = await mount(t, participant);
  await act(async () => { task = h.current.toggleMicrophone(); await h.current.toggleMicrophone(); });
  assert.equal(calls, 1); assert.equal(h.current.pending, true);
  await act(async () => { resolve(); await task; }); assert.equal(h.current.pending, false);
});
test('permission denied can be retried without changing camera', async t => {
  let denied = true;
  const participant = { isMicrophoneEnabled: false, isCameraEnabled: true,
    async createTracks() { if (denied) throw new DOMException('denied', 'NotAllowedError'); return [{ kind: 'audio', stop() {} }]; }, async publishTrack(track) { return { track }; } };
  const h = await mount(t, participant);
  await act(async () => { await h.current.toggleMicrophone(); });
  assert.match(h.current.error, /izin/); assert.equal(participant.isCameraEnabled, true);
  denied = false; await act(async () => { await h.current.toggleMicrophone(); }); assert.equal(h.current.error, null);
});
test('late microphone permission after unmount is stopped before publish', async t => {
  let resolve, task, stopped = false, published = false;
  const participant = { isMicrophoneEnabled: false, createTracks: () => new Promise(done => { resolve = done; }), async publishTrack() { published = true; } };
  const h = await mount(t, participant);
  await act(async () => { task = h.current.toggleMicrophone(); }); await h.unmount();
  await act(async () => { resolve([{ kind: 'audio', stop() { stopped = true; } }]); await task; });
  assert.equal(stopped, true); assert.equal(published, false);
});
test('reconnect invalidates an earlier pending microphone capture', async t => {
  let resolve, task, stopped = false, published = 0;
  const participant = { isMicrophoneEnabled: false, createTracks: () => new Promise(done => { resolve = done; }), async publishTrack() { published++; } };
  const h = await mount(t, participant);
  await act(async () => { task = h.current.toggleMicrophone(); }); await h.connect(false); await h.connect(true);
  await act(async () => { resolve([{ kind: 'audio', stop() { stopped = true; } }]); await task; });
  assert.equal(stopped, true); assert.equal(published, 0);
});
test('leaving during publication immediately stops capture and cleans late publication', async t => {
  let resolve, task, stopped = false, unpublished = false;
  const track = { kind: 'audio', stop() { stopped = true; } };
  const participant = { isMicrophoneEnabled: false, async createTracks() { return [track]; }, publishTrack: () => new Promise(done => { resolve = done; }), async unpublishTrack(value) { assert.equal(value, track); unpublished = true; } };
  const h = await mount(t, participant);
  await act(async () => { task = h.current.toggleMicrophone(); }); await h.connect(false); assert.equal(stopped, true);
  await act(async () => { resolve({ track }); await task; }); assert.equal(unpublished, true);
});
test('disconnected microphone toggle does not request media', async t => {
  let requested = false;
  const h = await mount(t, { isMicrophoneEnabled: false, createTracks() { requested = true; } }, false);
  await act(async () => { await h.current.toggleMicrophone(); }); assert.equal(requested, false);
});
