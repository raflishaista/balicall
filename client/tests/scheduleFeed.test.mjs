import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useScheduleFeed } from '../src/useScheduleFeed.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('guest mode disables schedule requests, timers and manual refresh', async () => {
  const originals = { window: globalThis.window, document: globalThis.document, fetch, setInterval };
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  let root, current, calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Guest must not fetch company schedules'); };
  globalThis.setInterval = () => { calls++; throw new Error('Guest must not poll company schedules'); };
  function Harness() { const feed = useScheduleFeed(false); React.useEffect(() => { current = feed; }); return null; }
  try {
    await act(async () => { root = create(React.createElement(Harness)); });
    await act(async () => { await current.refresh(); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(calls, 0); assert.deepEqual(current.schedules, []);
  } finally { if (root) act(() => root.unmount()); Object.assign(globalThis, originals); }
});
test('schedule feed refreshes on focus, suppresses failed data, ignores stale fetches after mutation and cleans up', async () => {
  const originals = { window: globalThis.window, document: globalThis.document, fetch, setInterval, clearInterval };
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  let tick, cleared = false, root, current;
  const pending = [];
  globalThis.setInterval = (callback, delay) => { assert.equal(delay, 30000); tick = callback; return 41; };
  globalThis.clearInterval = id => { assert.equal(id, 41); cleared = true; };
  globalThis.fetch = (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  function Harness() { const feed = useScheduleFeed(); React.useEffect(() => { current = feed; }); return null; }
  const finish = async (index, schedules, status = 200) => act(async () => { pending[index].resolve(new Response(JSON.stringify({ schedules }), { status, headers: { 'content-type': 'application/json' } })); });
  try {
    await act(async () => { root = create(React.createElement(Harness)); });
    await finish(0, [{ id: 'old' }]); assert.equal(current.available, true);
    await act(async () => window.dispatchEvent(new Event('focus')));
    act(() => current.update(() => [{ id: 'rescheduled' }]));
    assert.equal(pending[1].signal.aborted, true);
    await finish(1, [{ id: 'stale' }]); assert.equal(current.schedules[0].id, 'rescheduled');
    await act(async () => tick()); await finish(2, [], 503);
    assert.equal(current.available, false); assert.equal(current.error, true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await finish(3, []);
    assert.equal(current.available, true); assert.equal(current.error, false); assert.deepEqual(current.schedules, []);
    await act(async () => window.dispatchEvent(new Event('focus')));
    act(() => root.unmount()); root = null; assert.equal(cleared, true); assert.equal(pending[4].signal.aborted, true);
    const count = pending.length; window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(pending.length, count);
  } finally {
    if (root) act(() => root.unmount());
    Object.assign(globalThis, originals);
  }
});
