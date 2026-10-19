import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiarization } from '../src/diarization.ts';

const requested = { sharedRoomMic: true, liveDiarization: true, batchDiarization: true };
const context = { provider: 'server', model: 'small-id', configured: true, ...requested };

test('server upload permits live and batch requests without claiming model readiness', () => {
  const state = resolveDiarization(context);
  assert.equal(state.available, true);
  assert.equal(state.shared, true);
  assert.equal(state.live, true);
  assert.equal(state.batch, true);
  assert.match(state.notice, /belum.*diverifikasi/i);
});

for (const [name, patch, reason] of [
  ['Browser', { provider: 'browser' }, /Browser/],
  ['Qwen', { model: 'qwen3-asr-0.6b' }, /Qwen/],
  ['WhisperLiveKit', { model: 'whisperlivekit-small' }, /WhisperLiveKit/],
  ['unconfigured Server', { configured: false }, /belum dikonfigurasi/],
  ['unknown backend', { configured: null }, /belum.*diperiksa/],
  ['missing model', { model: '' }, /model transkripsi/],
]) {
  test(`${name} suspends effective diarization without deleting saved choices`, () => {
    const state = resolveDiarization({ ...context, ...patch });
    assert.equal(state.available, false);
    assert.deepEqual([state.shared, state.live, state.batch], [false, false, false]);
    assert.match(state.notice, reason);
    assert.deepEqual(requested, { sharedRoomMic: true, liveDiarization: true, batchDiarization: true });
  });
}

test('live and batch are independent and explicit false does not restore an old join choice', () => {
  assert.equal(resolveDiarization({ ...context, liveDiarization: false }).live, false);
  assert.equal(resolveDiarization({ ...context, liveDiarization: false }).batch, true);
  assert.equal(resolveDiarization({ ...context, batchDiarization: false }).batch, false);
  assert.deepEqual(['shared', 'live', 'batch'].map(k => resolveDiarization({ ...context, sharedRoomMic: false })[k]), [false, false, false]);
});

test('returning to supported Server restores requested options', () => {
  resolveDiarization({ ...context, provider: 'browser' });
  assert.equal(resolveDiarization(context).shared, true);
});
