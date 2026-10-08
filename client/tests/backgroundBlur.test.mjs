import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useBackgroundBlur } from '../src/useBackgroundBlur.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mountBlur(t, participant, isCameraEnabled = true, connected = true) {
  let blurState, root;
  function Harness({ participant, isCameraEnabled, connected }) {
    const state = useBackgroundBlur(participant, isCameraEnabled, connected);
    React.useEffect(() => { blurState = state; });
    return null;
  }
  await act(async () => {
    root = create(React.createElement(Harness, { participant, isCameraEnabled, connected }));
  });
  t.after(async () => {
    await act(async () => { root.unmount(); });
  });
  return {
    get blur() { return blurState; },
    async update(props) {
      await act(async () => {
        root.update(React.createElement(Harness, { participant, isCameraEnabled, connected, ...props }));
      });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
    },
  };
}

test('background blur reports unsupported in non-browser environment and explains gracefully', async t => {
  const track = {
    setProcessor: async () => {},
    stopProcessor: async () => {},
    getProcessor: () => null,
  };
  const participant = {
    getTrackPublication: () => ({ track }),
  };

  const h = await mountBlur(t, participant, true, true);
  assert.equal(h.blur.isBlurEnabled, false);
  assert.equal(h.blur.blurPending, false);
  assert.equal(h.blur.blurSupported, false);

  await act(async () => {
    await h.blur.toggleBlur();
  });

  assert.match(h.blur.blurError, /belum mendukung/);
  assert.equal(h.blur.isBlurEnabled, false);

  act(() => {
    h.blur.clearBlurError();
  });
  assert.equal(h.blur.blurError, null);
});

test('toggle blur does nothing when camera is not enabled', async t => {
  const participant = {
    getTrackPublication: () => null,
  };

  const h = await mountBlur(t, participant, false, true);
  await act(async () => {
    await h.blur.toggleBlur();
  });

  assert.equal(h.blur.isBlurEnabled, false);
});
