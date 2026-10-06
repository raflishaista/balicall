import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useDeviceSettings } from '../src/useDeviceSettings.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const device = (kind, deviceId, label = '') => ({ kind, deviceId, label });
class Media extends EventTarget {
  devices = [device('audioinput', 'mic-1'), device('audioinput', 'mic-2'), device('videoinput', 'cam-1'), device('videoinput', 'cam-2'), device('audiooutput', 'speaker-1')];
  async enumerateDevices() { return this.devices; }
}
class Native extends EventTarget {
  readyState = 'live';
  constructor(id) { super(); this.id = id; }
  getSettings() { return { deviceId: this.id }; }
}
class LocalTrack extends EventEmitter {
  isMuted = false;
  constructor(id) { super(); this.mediaStreamTrack = new Native(id); }
}
class Room extends EventEmitter {
  calls = []; active = { audioinput: 'mic-1', videoinput: 'cam-1', audiooutput: 'default' };
  options = { audioCaptureDefaults: {}, videoCaptureDefaults: {} };
  mic = new LocalTrack('mic-1'); camera = new LocalTrack('cam-1');
  localParticipant = {
    isMicrophoneEnabled: true, isCameraEnabled: true,
    getTrackPublication: source => ({ track: source === 'microphone' ? this.mic : this.camera }),
    setMicrophoneEnabled: async value => { this.localParticipant.isMicrophoneEnabled = value; this.mic.isMuted = !value; },
    setCameraEnabled: async value => { this.localParticipant.isCameraEnabled = value; this.camera.isMuted = !value; },
  };
  getActiveDevice(kind) { return this.active[kind]; }
  async switchActiveDevice(kind, id) {
    this.calls.push([kind, id]); this.active[kind] = id;
    if (kind !== 'audiooutput') {
      const track = kind === 'audioinput' ? this.mic : this.camera;
      const old = track.mediaStreamTrack; old.readyState = 'ended';
      track.mediaStreamTrack = new Native(id);
      track.emit('restarted', track);
    }
    this.emit('activeDeviceChanged', kind, id);
    return true;
  }
}

async function mount(t, { room = new Room(), media = new Media(), output = true, before = async () => {}, after = () => {} } = {}) {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const element = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } });
  Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: class { } });
  if (output) HTMLMediaElement.prototype.setSinkId = async () => {};
  let state, root;
  function Harness({ connected, blocked }) {
    const value = useDeviceSettings(room, connected, blocked, before, after);
    React.useEffect(() => { state = value; });
    return null;
  }
  await act(async () => { root = create(React.createElement(Harness, { connected: true, blocked: false })); });
  t.after(async () => {
    await act(async () => root.unmount());
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    if (element) Object.defineProperty(globalThis, 'HTMLMediaElement', element); else delete globalThis.HTMLMediaElement;
  });
  return { room, media, get settings() { return state; }, async connection(connected, blocked = false) { await act(async () => root.update(React.createElement(Harness, { connected, blocked }))); } };
}

test('enumerates hidden-label devices without requesting capture permission', async t => {
  const h = await mount(t);
  assert.equal(h.settings.devices.length, 5);
  assert.equal(h.settings.active.audioinput, 'mic-1');
  assert.equal(h.settings.loading, false);
  assert.equal(h.room.calls.length, 0);
});

test('microphone switch flushes first, reads actual device, then resumes transcription', async t => {
  const order = [], room = new Room();
  const original = room.switchActiveDevice.bind(room);
  room.switchActiveDevice = async (...args) => { order.push('switch'); return original(...args); };
  const h = await mount(t, { room, before: async () => { order.push('flush'); }, after: () => order.push('resume') });
  await act(async () => { await h.settings.selectDevice('audioinput', 'mic-2'); });
  assert.deepEqual(order, ['flush', 'switch', 'resume']);
  assert.equal(h.settings.active.audioinput, 'mic-2');
  assert.equal(h.room.localParticipant.isMicrophoneEnabled, true);
  assert.equal(h.room.localParticipant.isCameraEnabled, true);
});

test('switching a muted camera preserves its off status', async t => {
  const room = new Room(); await room.localParticipant.setCameraEnabled(false);
  const h = await mount(t, { room });
  await act(async () => { await h.settings.selectDevice('videoinput', 'cam-2'); });
  assert.equal(h.settings.active.videoinput, 'cam-2');
  assert.equal(room.localParticipant.isCameraEnabled, false);
  assert.match(h.settings.notice, /tetap nonaktif/);
});

test('failed capture recovers old choice and never claims failed device is active', async t => {
  const room = new Room(), original = room.switchActiveDevice.bind(room);
  room.switchActiveDevice = async (kind, id) => {
    if (id === 'mic-2') { room.calls.push([kind, id]); room.mic.mediaStreamTrack.readyState = 'ended'; throw new DOMException('', 'NotAllowedError'); }
    return original(kind, id);
  };
  const h = await mount(t, { room });
  await act(async () => { await h.settings.selectDevice('audioinput', 'mic-2'); });
  assert.equal(h.settings.active.audioinput, 'mic-1');
  assert.equal(room.mic.mediaStreamTrack.readyState, 'live');
  assert.match(h.settings.error, /izin belum diberikan.*sebelumnya dipulihkan/);
  assert.equal(h.settings.pendingKind, null);
});

test('failed switch and rollback safely mute unavailable microphone', async t => {
  const room = new Room(); room.switchActiveDevice = async () => { throw new DOMException('', 'NotFoundError'); };
  const h = await mount(t, { room });
  await act(async () => { await h.settings.selectDevice('audioinput', 'mic-2'); });
  assert.equal(room.localParticipant.isMicrophoneEnabled, false);
  assert.match(h.settings.error, /dinonaktifkan/);
});

test('devicechange refreshes plugged devices without activating media', async t => {
  const h = await mount(t);
  h.media.devices = [device('audioinput', 'new-mic', 'New microphone')];
  await act(async () => { h.media.dispatchEvent(new Event('devicechange')); });
  assert.equal(h.settings.devices[0].deviceId, 'new-mic');
  assert.equal(h.settings.active.audioinput, 'mic-1');
  assert.equal(h.room.calls.length, 0);
});

test('switch requests are serialized and late disconnect completion cannot claim success', async t => {
  let resolve, operation, resumed = 0;
  const room = new Room(); room.switchActiveDevice = () => new Promise(done => { resolve = done; });
  const h = await mount(t, { room, after: () => resumed++ });
  await act(async () => { operation = h.settings.selectDevice('audioinput', 'mic-2'); });
  await act(async () => { await h.settings.selectDevice('videoinput', 'cam-2'); });
  assert.equal(h.settings.pendingKind, 'audioinput');
  await h.connection(false);
  await act(async () => { resolve(true); await operation; });
  assert.equal(h.settings.notice, null);
  assert.equal(h.settings.pendingKind, null);
  assert.equal(resumed, 1);
});

test('unsupported audio output and blocked connection never call switch', async t => {
  const h = await mount(t, { output: false });
  await act(async () => { await h.settings.selectDevice('audiooutput', 'speaker-1'); });
  await h.connection(true, true);
  await act(async () => { await h.settings.selectDevice('audioinput', 'mic-2'); });
  await h.connection(false);
  await act(async () => { await h.settings.selectDevice('videoinput', 'cam-2'); });
  assert.equal(h.room.calls.length, 0);
  assert.equal(h.settings.outputSupported, false);
});

test('output permission picker only changes room after permission succeeds', async t => {
  const media = new Media(); let denied = true;
  media.selectAudioOutput = async () => { if (denied) throw new DOMException('', 'NotAllowedError'); return device('audiooutput', 'speaker-1'); };
  const h = await mount(t, { media });
  await act(async () => { await h.settings.requestOutput(); });
  assert.equal(h.room.calls.length, 0);
  assert.match(h.settings.error, /izin belum diberikan/);
  denied = false;
  await act(async () => { await h.settings.requestOutput(); });
  assert.equal(h.settings.active.audiooutput, 'speaker-1');
  assert.equal(h.settings.error, null);
});

test('enumeration failure is visible and manual refresh recovers', async t => {
  const media = new Media(); let denied = true;
  media.enumerateDevices = async () => { if (denied) throw new Error('permission denied'); return [device('videoinput', 'cam-1')]; };
  const h = await mount(t, { media });
  assert.match(h.settings.listError, /belum dapat dibaca/);
  denied = false;
  await act(async () => { await h.settings.refreshDevices(); });
  assert.equal(h.settings.listError, null);
  assert.equal(h.settings.devices.length, 1);
});
