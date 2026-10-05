import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useScreenShareControl } from '../src/useScreenShareControl.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function screenTrack() {
  return { kind: 'video', mediaStreamTrack: { readyState: 'live' }, stop() { this.mediaStreamTrack.readyState = 'ended'; } };
}

async function mount(t, participant, supported = true) {
  let state, root;
  function Harness({ connected }) {
    const share = useScreenShareControl(participant, connected, supported);
    React.useEffect(() => { state = share; });
    return null;
  }
  await act(async () => { root = create(React.createElement(Harness, { connected: true })); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    get share() { return state; },
    async connect(connected) { await act(async () => root.update(React.createElement(Harness, { connected }))); },
    async unmount() { await act(async () => root.unmount()); },
  };
}

test('share starts only on click; start/stop preserve camera and microphone', async t => {
  const video = screenTrack();
  let captures = 0;
  const p = {
    isScreenShareEnabled: false, isCameraEnabled: true, isMicrophoneEnabled: true,
    async createScreenTracks(options) { captures++; assert.equal(options.audio, false); return [video]; },
    async publishTrack(track, options) { assert.equal(track, video); assert.equal(options.source, 'screen_share'); this.isScreenShareEnabled = true; },
    async setScreenShareEnabled(enabled) { assert.equal(enabled, false); video.stop(); this.isScreenShareEnabled = false; },
  };
  const h = await mount(t, p);
  assert.equal(captures, 0);
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.equal(p.isScreenShareEnabled, true);
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.equal(video.mediaStreamTrack.readyState, 'ended');
  assert.equal(p.isCameraEnabled, true);
  assert.equal(p.isMicrophoneEnabled, true);
});

test('picker cancellation clears busy state and permits retry', async t => {
  let cancelled = true;
  const p = {
    isScreenShareEnabled: false,
    async createScreenTracks() { if (cancelled) throw new DOMException('', 'NotAllowedError'); return [screenTrack()]; },
    async publishTrack() { this.isScreenShareEnabled = true; },
  };
  const h = await mount(t, p);
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.match(h.share.error, /dibatalkan/);
  assert.equal(h.share.pending, false);
  cancelled = false;
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.equal(h.share.error, null);
  assert.equal(p.isScreenShareEnabled, true);
});

test('unsupported browsers never request screen capture', async t => {
  const h = await mount(t, { isScreenShareEnabled: false, createScreenTracks() { throw new Error('Must not capture'); } }, false);
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.match(h.share.error, /belum mendukung/);
  assert.equal(h.share.pending, false);
});

test('repeated clicks do not open concurrent pickers', async t => {
  let resume, operation, calls = 0;
  const h = await mount(t, {
    isScreenShareEnabled: false,
    createScreenTracks() { calls++; return new Promise(resolve => { resume = resolve; }); },
    async publishTrack() {},
  });
  await act(async () => { operation = h.share.toggleScreenShare(); await h.share.toggleScreenShare(); });
  assert.equal(calls, 1);
  assert.equal(h.share.pending, true);
  await act(async () => { resume([screenTrack()]); await operation; });
  assert.equal(h.share.pending, false);
});

test('leaving with picker open stops late tracks before publishing', async t => {
  let resume, operation, published = false;
  const track = screenTrack();
  const h = await mount(t, {
    isScreenShareEnabled: false,
    createScreenTracks() { return new Promise(resolve => { resume = resolve; }); },
    async publishTrack() { published = true; },
  });
  await act(async () => { operation = h.share.toggleScreenShare(); });
  await h.unmount();
  await act(async () => { resume([track]); await operation; });
  assert.equal(track.mediaStreamTrack.readyState, 'ended');
  assert.equal(published, false);
});

test('disconnect during publish immediately stops capture and unpublishes late result', async t => {
  let resume, operation, unpublished = false;
  const track = screenTrack();
  const h = await mount(t, {
    isScreenShareEnabled: false,
    async createScreenTracks() { return [track]; },
    publishTrack() { return new Promise(resolve => { resume = resolve; }); },
    async unpublishTrack(value) { assert.equal(value, track); unpublished = true; },
  });
  await act(async () => { operation = h.share.toggleScreenShare(); });
  await h.connect(false);
  assert.equal(track.mediaStreamTrack.readyState, 'ended');
  await act(async () => { resume(); await operation; });
  assert.equal(unpublished, true);
  assert.equal(h.share.pending, false);
});

test('a picker opened before disconnect is invalid after reconnect', async t => {
  let resume, operation, published = false;
  const track = screenTrack();
  const h = await mount(t, {
    isScreenShareEnabled: false,
    createScreenTracks() { return new Promise(resolve => { resume = resolve; }); },
    async publishTrack() { published = true; },
  });
  await act(async () => { operation = h.share.toggleScreenShare(); });
  await h.connect(false);
  await h.connect(true);
  await act(async () => { resume([track]); await operation; });
  assert.equal(published, false);
  assert.equal(track.mediaStreamTrack.readyState, 'ended');
});

test('failed publication releases captured screen and allows retry', async t => {
  const track = screenTrack();
  const h = await mount(t, {
    isScreenShareEnabled: false,
    async createScreenTracks() { return [track]; },
    async publishTrack() { throw new Error('connection closed'); },
  });
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.equal(track.mediaStreamTrack.readyState, 'ended');
  assert.match(h.share.error, /Gagal membagikan/);
  assert.equal(h.share.pending, false);
});

test('browser stop during publication removes the ended screen publication', async t => {
  let resume, operation, unpublished = false;
  const track = screenTrack();
  const h = await mount(t, {
    isScreenShareEnabled: false,
    async createScreenTracks() { return [track]; },
    publishTrack() { return new Promise(resolve => { resume = resolve; }); },
    async unpublishTrack() { unpublished = true; },
  });
  await act(async () => { operation = h.share.toggleScreenShare(); });
  track.stop();
  await act(async () => { resume(); await operation; });
  assert.equal(unpublished, true);
});
