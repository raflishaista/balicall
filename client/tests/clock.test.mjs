import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useClock } from '../src/useClock.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('clock refreshes on timer/focus/visibility and releases timer/listeners on unmount', () => {
  const originals = { window: globalThis.window, document: globalThis.document, setInterval, clearInterval, now: Date.now };
  let now = 1000, tick, cleared = false, root;
  const observations = [];
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  globalThis.setInterval = (callback, delay) => { assert.equal(delay, 1000); tick = callback; return 71; };
  globalThis.clearInterval = id => { assert.equal(id, 71); cleared = true; };
  Date.now = () => now;
  function Harness() {
    const epoch = useClock();
    React.useEffect(() => { observations.push(epoch); }, [epoch]);
    return null;
  }
  try {
    act(() => { root = create(React.createElement(Harness)); });
    now = 2000; act(() => tick()); assert.equal(observations.at(-1), 2000);
    now = 9000; act(() => window.dispatchEvent(new Event('focus'))); assert.equal(observations.at(-1), 9000);
    now = 15000; act(() => document.dispatchEvent(new Event('visibilitychange'))); assert.equal(observations.at(-1), 15000);
    act(() => root.unmount()); root = null; assert.equal(cleared, true);
    const count = observations.length;
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(observations.length, count);
  } finally {
    if (root) act(() => root.unmount());
    Object.assign(globalThis, { window: originals.window, document: originals.document, setInterval: originals.setInterval, clearInterval: originals.clearInterval });
    Date.now = originals.now;
  }
});
