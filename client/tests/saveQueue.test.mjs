import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from '../src/saveQueue.ts';

test('transient failure retries the same ID and preserves sentence order', async () => {
  const saved = [], ids = [], states = [];
  const queue = createSaveQueue({ retryDelayMs: 1, onSaved: value => saved.push(value), onChange: (...value) => states.push(value) });
  queue.enqueue(async id => { ids.push(id); if (ids.length === 1) throw new Error('network disconnected'); return 'first'; }, 'stable-id');
  queue.enqueue(async () => 'second', 'second-id');
  await queue.flush();
  assert.deepEqual(ids, ['stable-id', 'stable-id']);
  assert.deepEqual(saved, ['first', 'second']);
  assert.equal(queue.pending, 0);
  assert.deepEqual(states.at(-1), [0, null]);
});

test('failed sentences stay queued; manual retry saves them without replacing IDs', async () => {
  let online = false, attempts = 0; const saved = [], ids = [];
  const queue = createSaveQueue({ retryDelayMs: 1, onSaved: value => saved.push(value), onChange() {} });
  queue.enqueue(async id => { attempts++; ids.push(id); if (!online) throw new Error('offline'); return 'kept'; }, 'keep-id');
  await assert.rejects(queue.flush(), /offline/);
  assert.equal(attempts, 3); assert.equal(queue.pending, 1); assert.deepEqual(saved, []);
  online = true; queue.retry(); await queue.flush();
  assert.deepEqual(saved, ['kept']); assert.equal(queue.pending, 0);
  assert.equal(new Set(ids).size, 1);
});

test('non-retryable errors do not create an automatic retry storm', async () => {
  let attempts = 0;
  const queue = createSaveQueue({ retryDelayMs: 1, onSaved() {}, onChange() {} });
  queue.enqueue(async () => { attempts++; throw Object.assign(new Error('forbidden'), { retryable: false }); });
  await assert.rejects(queue.flush(), /forbidden/);
  assert.equal(attempts, 1); assert.equal(queue.pending, 1);
});

test('flush waits for saves already running and for the last speech enqueued during a save', async () => {
  const saved = [];
  const queue = createSaveQueue({ onSaved: value => saved.push(value), onChange() {} });
  queue.enqueue(async () => {
    await new Promise(resolve => setTimeout(resolve, 15));
    queue.enqueue(async () => 'last words');
    return 'first words';
  });
  await queue.flush();
  assert.deepEqual(saved, ['first words', 'last words']);
});
