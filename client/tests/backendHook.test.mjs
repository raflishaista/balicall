import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useBackendTranscription } from '../src/useBackendTranscription.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('backend recording survives volume/callback rerenders and flushes the existing microphone track', async t => {
  const previousRecorder = globalThis.MediaRecorder, previousStream = globalThis.MediaStream;
  t.after(() => { globalThis.MediaRecorder = previousRecorder; globalThis.MediaStream = previousStream; });
  const recorders = [], streams = [], blobs = [];
  class FakeStream { constructor(tracks) { streams.push(tracks); } }
  class FakeRecorder {
    state = 'inactive'; mimeType = 'audio/webm';
    static isTypeSupported() { return true; }
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(new Event('stop')); });
    }
  }
  globalThis.MediaStream = FakeStream; globalThis.MediaRecorder = FakeRecorder;
  let state, root;
  function Harness(props) {
    const value = useBackendTranscription(props);
    React.useEffect(() => { state = value; });
    return null;
  }
  const track = { id: 'existing-livekit-track', stop() { throw new Error('Must not stop LiveKit track'); } };
  const options = { track, muted: false, language: 'id-ID', volume: 0.1, onAudio: blob => blobs.push(blob) };
  await act(async () => { root = create(React.createElement(Harness, options)); });
  t.after(async () => { await act(async () => root.unmount()); });
  for (let i = 0; i < 10; i++) {
    await act(async () => root.update(React.createElement(Harness, { ...options, volume: 0.1 + i / 100, onAudio: blob => blobs.push(blob) })));
  }
  assert.equal(recorders.length, 1); assert.equal(streams[0][0], track);
  await act(async () => { await Promise.all([state.prepareTrackChange(), state.finishTranscription()]); });
  assert.equal(blobs.length, 1); assert.equal(await blobs[0].text(), 'audio');
  assert.equal(state.isListeningSpeechApi, false);
});

test('microphone switch flushes old segment and starts exactly one recorder on the new track', async t => {
  const oldRecorder = globalThis.MediaRecorder, oldStream = globalThis.MediaStream;
  const recorders = [], streams = [], blobs = [];
  globalThis.MediaStream = class { constructor(tracks) { streams.push(tracks); } };
  globalThis.MediaRecorder = class {
    state = 'inactive'; mimeType = 'audio/webm';
    static isTypeSupported() { return true; }
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['segment']) }); this.onstop?.(new Event('stop')); }); }
  };
  let state, root;
  function Harness(props) { const hook = useBackendTranscription(props); React.useEffect(() => { state = hook; }); return null; }
  const oldTrack = { id: 'old', readyState: 'live' }, newTrack = { id: 'new', readyState: 'live' };
  const props = { track: oldTrack, muted: false, language: 'id-ID', volume: .1, onAudio: blob => blobs.push(blob) };
  await act(async () => { root = create(React.createElement(Harness, props)); });
  t.after(async () => { await act(async () => root.unmount()); globalThis.MediaRecorder = oldRecorder; globalThis.MediaStream = oldStream; });
  await act(async () => { await state.prepareTrackChange(); });
  assert.equal(blobs.length, 1);
  assert.equal(recorders.length, 1);
  assert.equal(state.isListeningSpeechApi, false);
  await act(async () => { root.update(React.createElement(Harness, { ...props, track: newTrack })); });
  assert.equal(recorders.length, 1);
  await act(async () => { state.resumeTrackChange(); });
  assert.equal(recorders.length, 2);
  assert.equal(streams[1][0], newTrack);
  await act(async () => { await state.finishTranscription(); });
  assert.equal(blobs.length, 2);
  assert.equal(recorders.filter(recorder => recorder.state === 'recording').length, 0);
});
