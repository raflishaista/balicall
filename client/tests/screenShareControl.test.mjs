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

test('screen share enforces detail contentHint, 1080p resolution, simulcast layers, and maintain-resolution degradation preference', async t => {
  const video = screenTrack();
  video.mediaStreamTrack.contentHint = '';
  let capturedOptions = null;
  let publishedOptions = null;
  const p = {
    isScreenShareEnabled: false,
    async createScreenTracks(options) {
      capturedOptions = options;
      return [video];
    },
    async publishTrack(track, options) {
      publishedOptions = options;
      this.isScreenShareEnabled = true;
    },
    async setScreenShareEnabled(enabled) {
      this.isScreenShareEnabled = enabled;
    },
  };
  const h = await mount(t, p);
  await act(async () => { await h.share.toggleScreenShare(); });
  assert.equal(capturedOptions.audio, false);
  assert.equal(capturedOptions.contentHint, 'detail');
  assert.equal(capturedOptions.resolution.width, 1920);
  assert.equal(capturedOptions.resolution.height, 1080);
  assert.equal(video.mediaStreamTrack.contentHint, 'detail');
  assert.equal(publishedOptions.source, 'screen_share');
  assert.equal(publishedOptions.simulcast, true);
  assert.ok(Array.isArray(publishedOptions.screenShareSimulcastLayers));
  assert.ok(publishedOptions.screenShareSimulcastLayers.length > 0);
  assert.equal(publishedOptions.degradationPreference, 'maintain-resolution');
  assert.ok(publishedOptions.screenShareEncoding.maxBitrate >= 2000000);
});

test('screen share allows selecting resolution and updates active track constraints dynamically', async t => {
  const video = screenTrack();
  let appliedConstraints = null;
  let senderParameters = null;
  video.mediaStreamTrack.applyConstraints = async (c) => { appliedConstraints = c; };
  video.sender = {
    getParameters: () => ({ encodings: [{ maxBitrate: 2500000, maxFramerate: 15 }] }),
    setParameters: async (p) => { senderParameters = p; },
  };
  let captured = null;
  let published = null;
  const p = {
    isScreenShareEnabled: false,
    async createScreenTracks(options) {
      captured = options;
      return [video];
    },
    async publishTrack(track, options) {
      published = options;
      this.isScreenShareEnabled = true;
    },
    async setScreenShareEnabled(enabled) {
      this.isScreenShareEnabled = enabled;
    },
    getTrackPublication(source) {
      if (source === 'screen_share') return { track: video };
      return null;
    },
  };

  let shareRef = null;
  function Harness({ res }) {
    const share = useScreenShareControl(p, true, true, res);
    React.useEffect(() => { shareRef = share; });
    return null;
  }

  let root;
  await act(async () => { root = create(React.createElement(Harness, { res: '720p' })); });
  t.after(async () => { await act(async () => root.unmount()); });

  assert.equal(shareRef.resolution, '720p');

  // Test 720p capture
  await act(async () => { await shareRef.toggleScreenShare(); });
  assert.equal(captured.resolution.width, 1280);
  assert.equal(captured.resolution.height, 720);
  assert.equal(published.screenShareEncoding.maxBitrate, 1500000);
  assert.equal(published.simulcast, true);

  // In-flight resolution switch to 540p while sharing is active
  await act(async () => { await shareRef.setResolution('540p'); });
  assert.equal(shareRef.resolution, '540p');
  assert.equal(appliedConstraints.width.ideal, 960);
  assert.equal(appliedConstraints.height.ideal, 540);
  assert.equal(senderParameters.encodings[0].scaleResolutionDownBy, 2);
  assert.equal(senderParameters.encodings[0].maxBitrate, 800000);

  // Stop share
  await act(async () => { await shareRef.toggleScreenShare(); });

  // Test original (uncapped)
  await act(async () => { await shareRef.toggleScreenShare('original'); });
  assert.equal(shareRef.resolution, 'original');
  assert.equal(captured.resolution, undefined);
  assert.equal(published.screenShareEncoding.maxBitrate, 7000000);
  assert.equal(published.simulcast, true);
});
