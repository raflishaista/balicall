import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { usePreJoinMedia } from '../src/usePreJoinMedia.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Native extends EventTarget {
  readyState = 'live'; label = 'Test device'; stopped = 0;
  constructor(kind, deviceId) { super(); this.kind = kind; this.deviceId = deviceId; }
  getSettings() { return { deviceId: this.deviceId }; }
  stop() { this.stopped++; this.readyState = 'ended'; }
}
function stream(kind, id) {
  const track = new Native(kind, id);
  return { id: `${id}-${Math.random()}`, track, getTracks: () => [track], getVideoTracks: () => kind === 'video' ? [track] : [], getAudioTracks: () => kind === 'audio' ? [track] : [] };
}
class Media extends EventTarget {
  devices = ['mic-a', 'mic-b', 'cam-a', 'cam-b'].map(deviceId => ({ deviceId, kind: deviceId.startsWith('mic') ? 'audioinput' : 'videoinput', label: '' }));
  calls = []; captures = [];
  async enumerateDevices() { return this.devices.slice(); }
  async getUserMedia(constraints) {
    this.calls.push(constraints);
    const kind = constraints.audio ? 'audio' : 'video';
    const option = constraints.audio || constraints.video;
    const id = option.deviceId?.exact || (kind === 'audio' ? 'mic-a' : 'cam-a');
    const capture = stream(kind, id); this.captures.push(capture); return capture;
  }
}
async function mount(t, media = new Media(), strict = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } });
  let state, root;
  function Harness({ lobby }) { const current = usePreJoinMedia(lobby); React.useEffect(() => { state = current; }); return null; }
  const element = lobby => strict ? React.createElement(React.StrictMode, null, React.createElement(Harness, { lobby })) : React.createElement(Harness, { lobby });
  await act(async () => { root = create(element(true)); });
  t.after(async () => { await act(async () => root.unmount()); if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; });
  return { media, get current() { return state; }, async lobby(value) { await act(async () => root.update(element(value))); }, async unmount() { await act(async () => root.unmount()); } };
}

test('opening lobby only enumerates devices, captures require user action', async t => {
  const h = await mount(t);
  assert.equal(h.media.calls.length, 0); assert.equal(h.current.devices.length, 4);
  assert.equal(h.current.choices.microphoneEnabled, true); assert.equal(h.current.choices.cameraEnabled, true);
  await act(async () => { h.current.select('videoinput', 'cam-b'); h.current.select('audioinput', 'mic-b'); });
  assert.equal(h.media.calls.length, 0);
  await act(async () => { await h.current.capture('videoinput'); await h.current.capture('audioinput'); });
  assert.deepEqual(h.media.calls, [{ audio: false, video: { deviceId: { exact: 'cam-b' } } }, { audio: { deviceId: { exact: 'mic-b' } }, video: false }]);
});
test('joining snapshots chosen input devices and stops both preview tracks', async t => {
  const h = await mount(t);
  await act(async () => { h.current.select('audioinput', 'mic-b'); h.current.select('videoinput', 'cam-b'); await h.current.capture('audioinput'); await h.current.capture('videoinput'); });
  let choices; await act(async () => { choices = h.current.prepareJoin(); });
  assert.deepEqual(choices, { microphoneEnabled: true, cameraEnabled: true, microphoneId: 'mic-b', cameraId: 'cam-b' });
  assert.ok(h.media.captures.every(capture => capture.track.readyState === 'ended'));
  assert.equal(h.current.streams.audioinput, null); assert.equal(h.current.streams.videoinput, null);
});
test('muted and camera-off preferences do not acquire input while joining', async t => {
  const h = await mount(t);
  await act(async () => { h.current.toggle('audioinput'); h.current.toggle('videoinput'); });
  let choices; await act(async () => { choices = h.current.prepareJoin(); });
  assert.equal(choices.microphoneEnabled, false); assert.equal(choices.cameraEnabled, false);
  assert.equal(h.media.calls.length, 0);
});
test('stopping microphone test preserves desired call mic state', async t => {
  const h = await mount(t);
  await act(async () => { await h.current.capture('audioinput'); });
  await act(async () => { h.current.stopMicrophone(); });
  assert.equal(h.current.choices.microphoneEnabled, true); assert.equal(h.media.captures[0].track.stopped, 1);
});
test('preview device replacement releases previous track without touching other input', async t => {
  const h = await mount(t);
  await act(async () => { await h.current.capture('videoinput'); await h.current.capture('audioinput'); });
  const mic = h.current.streams.audioinput;
  await act(async () => { h.current.select('videoinput', 'cam-b'); });
  assert.equal(h.media.captures[0].track.readyState, 'ended'); assert.equal(h.current.streams.videoinput.track.deviceId, 'cam-b');
  assert.equal(h.current.streams.audioinput, mic); assert.equal(mic.track.readyState, 'live');
});
test('late permission resolution after cancel stops the track and cannot enable preview', async t => {
  const media = new Media(), pending = deferred(), late = stream('video', 'cam-a'); media.getUserMedia = () => pending.promise;
  const h = await mount(t, media); let task;
  await act(async () => { task = h.current.capture('videoinput'); });
  await act(async () => { h.current.stopCamera(); });
  await act(async () => { pending.resolve(late); await task; });
  assert.equal(late.track.readyState, 'ended'); assert.equal(h.current.streams.videoinput, null); assert.equal(h.current.pending.videoinput, false);
});
test('late microphone permission after leaving lobby releases all tracks', async t => {
  const media = new Media(), pending = deferred(), late = stream('audio', 'mic-a'); media.getUserMedia = () => pending.promise;
  const h = await mount(t, media); let task;
  await act(async () => { task = h.current.capture('audioinput'); });
  await h.lobby(false);
  await act(async () => { pending.resolve(late); await task; });
  assert.equal(late.track.readyState, 'ended');
  await h.lobby(true); assert.equal(h.current.streams.audioinput, null); assert.equal(h.current.pending.audioinput, false);
});
test('capture failure disables only failed input and offers an explicit retry', async t => {
  const media = new Media(), original = media.getUserMedia.bind(media);
  media.getUserMedia = async constraints => { if (constraints.video) throw new DOMException('denied', 'NotAllowedError'); return original(constraints); };
  const h = await mount(t, media);
  await act(async () => { await h.current.capture('videoinput'); });
  assert.equal(h.current.choices.cameraEnabled, false); assert.equal(h.current.choices.microphoneEnabled, true); assert.match(h.current.errors.videoinput, /izin/);
  media.getUserMedia = original;
  await act(async () => { await h.current.capture('videoinput'); });
  assert.equal(h.current.choices.cameraEnabled, true); assert.equal(h.current.errors.videoinput, null);
});
test('removed selected device is stopped, remains selected, and is disabled until user changes it', async t => {
  const h = await mount(t);
  await act(async () => { h.current.select('videoinput', 'cam-b'); await h.current.capture('videoinput'); });
  h.media.devices = h.media.devices.filter(device => device.deviceId !== 'cam-b');
  await act(async () => { h.media.dispatchEvent(new Event('devicechange')); });
  assert.equal(h.current.streams.videoinput, null); assert.equal(h.current.choices.cameraEnabled, false);
  assert.equal(h.current.choices.cameraId, 'cam-b'); assert.match(h.current.errors.videoinput, /terputus/);
});
test('native track ended disables that input and clears preview', async t => {
  const h = await mount(t);
  await act(async () => { await h.current.capture('audioinput'); });
  const track = h.current.streams.audioinput.track; track.readyState = 'ended';
  await act(async () => { track.dispatchEvent(new Event('ended')); });
  assert.equal(h.current.streams.audioinput, null); assert.equal(h.current.choices.microphoneEnabled, false);
});
test('superseded permission request cannot replace latest device or preferences', async t => {
  const media = new Media(), pending = deferred(), original = media.getUserMedia.bind(media), late = stream('video', 'cam-a');
  media.getUserMedia = constraints => constraints.video === true ? pending.promise : original(constraints);
  const h = await mount(t, media); let task;
  await act(async () => { task = h.current.capture('videoinput'); });
  await act(async () => { h.current.select('videoinput', 'cam-b'); });
  await act(async () => { pending.resolve(late); await task; });
  assert.equal(late.track.readyState, 'ended'); assert.equal(h.current.streams.videoinput.track.deviceId, 'cam-b');
});
test('unmount and StrictMode cleanup release captures and remove device listeners', async t => {
  const h = await mount(t, new Media(), true);
  await act(async () => { await h.current.capture('audioinput'); await h.current.capture('videoinput'); });
  await h.unmount(); assert.ok(h.media.captures.every(capture => capture.track.readyState === 'ended'));
  const calls = h.media.calls.length; h.media.dispatchEvent(new Event('devicechange')); assert.equal(h.media.calls.length, calls);
});
test('fresh lobby clears stale errors while retaining explicit device and off preference', async t => {
  const media = new Media(); media.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
  const h = await mount(t, media);
  await act(async () => { h.current.select('videoinput', 'cam-b'); await h.current.capture('videoinput'); });
  assert.match(h.current.errors.videoinput, /izin/);
  await act(async () => { h.current.resetLobby(); });
  assert.equal(h.current.errors.videoinput, null); assert.equal(h.current.choices.cameraEnabled, false); assert.equal(h.current.choices.cameraId, 'cam-b');
});
