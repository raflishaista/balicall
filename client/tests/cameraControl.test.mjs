import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useCameraControl } from '../src/useCameraControl.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mountCamera(t, participant, connected = true, startWithCamera = false) {
  participant.getTrackPublication ??= () => ({ track: { stop() {} } });
  let camera, root;
  function Harness({ connected }) {
    const state = useCameraControl(participant, connected, startWithCamera);
    React.useEffect(() => { camera = state; });
    return null;
  }
  await act(async () => { root = create(React.createElement(Harness, { connected })); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    get camera() { return camera; },
    async connect(value) { await act(async () => root.update(React.createElement(Harness, { connected: value }))); },
    async unmount() { await act(async () => root.unmount()); },
  };
}

test('camera toggles do not change microphone state', async t => {
  const requests = [];
  const participant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    setMicrophoneEnabled() { throw new Error('Camera must not modify microphone'); },
    async setCameraEnabled(enabled) { requests.push(enabled); this.isCameraEnabled = enabled; },
  };
  const h = await mountCamera(t, participant);
  await act(async () => { await h.camera.toggleCamera(); });
  await act(async () => { await h.camera.toggleCamera(); });
  assert.deepEqual(requests, [true, false]);
  assert.equal(participant.isMicrophoneEnabled, true);
  assert.equal(h.camera.pending, false);
});

test('permission denial keeps camera off and allows a successful retry', async t => {
  let denied = true;
  const participant = {
    isCameraEnabled: false,
    async setCameraEnabled(enabled) {
      if (denied) throw new DOMException('denied', 'NotAllowedError');
      this.isCameraEnabled = enabled;
    },
  };
  const h = await mountCamera(t, participant);
  await act(async () => { await h.camera.toggleCamera(); });
  assert.match(h.camera.error, /Izin kamera/);
  assert.equal(participant.isCameraEnabled, false);
  assert.equal(h.camera.pending, false);
  denied = false;
  await act(async () => { await h.camera.toggleCamera(); });
  assert.equal(participant.isCameraEnabled, true);
  assert.equal(h.camera.error, null);
});

test('rapid repeated clicks cannot create concurrent camera requests', async t => {
  let resolve, calls = 0, operation;
  const participant = {
    isCameraEnabled: false,
    setCameraEnabled() { calls++; return new Promise(done => { resolve = done; }); },
  };
  const h = await mountCamera(t, participant);
  await act(async () => { operation = h.camera.toggleCamera(); await h.camera.toggleCamera(); });
  assert.equal(calls, 1);
  assert.equal(h.camera.pending, true);
  await act(async () => { resolve(); await operation; });
  assert.equal(h.camera.pending, false);
});

test('camera permission resolving after leaving releases the late track', async t => {
  let resolve, operation, stopped = false, unpublished = false;
  const track = { stop() { stopped = true; } };
  const participant = {
    isCameraEnabled: false,
    setCameraEnabled() { return new Promise(done => { resolve = done; }); },
    async unpublishTrack(value) { assert.equal(value, track); unpublished = true; },
  };
  const h = await mountCamera(t, participant);
  await act(async () => { operation = h.camera.toggleCamera(); });
  await h.unmount();
  await act(async () => { resolve({ track }); await operation; });
  assert.equal(stopped, true);
  assert.equal(unpublished, true);
});

test('disconnect during a pending request cleans the track without leaving retry stuck', async t => {
  let resolve, operation, calls = 0;
  const participant = {
    isCameraEnabled: false,
    setCameraEnabled() { calls++; return new Promise(done => { resolve = done; }); },
    async unpublishTrack() {},
  };
  const h = await mountCamera(t, participant, false);
  await act(async () => { await h.camera.toggleCamera(); });
  assert.equal(calls, 0);
  await h.connect(true);
  await act(async () => { operation = h.camera.toggleCamera(); });
  await h.connect(false);
  let stopped = false;
  await act(async () => { resolve({ track: { stop() { stopped = true; } } }); await operation; });
  await h.connect(true);
  assert.equal(stopped, true);
  assert.equal(h.camera.pending, false);
});

test('initial camera capture resolving after leaving stops before publication', async t => {
  let resolve, stopped = false;
  const participant = {
    isCameraEnabled: false,
    getTrackPublication() {},
    createTracks() { return new Promise(done => { resolve = done; }); },
    publishTrack() { throw new Error('Must not publish after leaving'); },
  };
  const h = await mountCamera(t, participant, true, true);
  assert.equal(h.camera.pending, true);
  await h.unmount();
  await act(async () => { resolve([{ kind: 'video', stop() { stopped = true; } }]); });
  assert.equal(stopped, true);
});

test('leaving during initial publication releases capture before publish finishes', async t => {
  let resolve, stopped = false, unpublished = false;
  const track = { kind: 'video', stop() { stopped = true; } };
  const participant = {
    isCameraEnabled: false,
    getTrackPublication() {},
    async createTracks() { return [track]; },
    publishTrack() { return new Promise(done => { resolve = done; }); },
    async unpublishTrack(value) { assert.equal(value, track); unpublished = true; },
  };
  const h = await mountCamera(t, participant, true, true);
  await h.unmount();
  assert.equal(stopped, true);
  await act(async () => { resolve({ track }); });
  assert.equal(unpublished, true);
});
test('permission from before disconnect cannot publish after reconnect', async t => {
  let resolve, task, stopped = false, published = 0;
  const participant = { isCameraEnabled: false, getTrackPublication: () => undefined,
    createTracks: () => new Promise(done => { resolve = done; }), async publishTrack() { published++; } };
  const h = await mountCamera(t, participant);
  await act(async () => { task = h.camera.toggleCamera(); });
  await h.connect(false); await h.connect(true);
  await act(async () => { resolve([{ kind: 'video', stop() { stopped = true; } }]); await task; });
  assert.equal(stopped, true); assert.equal(published, 0); assert.equal(h.camera.pending, false);
});
