import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useTrackUnavailable } from '../src/useTrackUnavailable.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Native extends EventTarget { readyState = 'live'; muted = false; }
test('track lifecycle switches fallback on mute/ended, recovers on unmute and rebinds replacement', async () => {
  let unavailable, root;
  const track = new Native(), next = new Native();
  function Harness({ track }) {
    const value = useTrackUnavailable(track);
    React.useEffect(() => { unavailable = value; }, [value]);
    return null;
  }
  await act(async () => { root = create(React.createElement(Harness, { track })); });
  try {
    assert.equal(unavailable, false);
    await act(async () => { track.muted = true; track.dispatchEvent(new Event('mute')); }); assert.equal(unavailable, true);
    await act(async () => { track.muted = false; track.dispatchEvent(new Event('unmute')); }); assert.equal(unavailable, false);
    await act(async () => { track.readyState = 'ended'; track.dispatchEvent(new Event('ended')); }); assert.equal(unavailable, true);
    await act(async () => { root.update(React.createElement(Harness, { track: next })); }); assert.equal(unavailable, false);
    await act(async () => { track.dispatchEvent(new Event('ended')); }); assert.equal(unavailable, false);
    await act(async () => { root.update(React.createElement(Harness)); }); assert.equal(unavailable, true);
  } finally { await act(async () => root.unmount()); }
});
