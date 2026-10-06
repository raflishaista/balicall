import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, normalizePreferences, readPreferences, writePreferences, mediaChoices } from '../src/preferences.ts';

test('preferences round-trip restores media and display choices without identity data', () => {
  let raw;
  const storage = { getItem: key => { assert.equal(key, PREFERENCES_KEY); return raw; }, setItem: (key, value) => { assert.equal(key, PREFERENCES_KEY); raw = value; } };
  const choices = { ...DEFAULT_PREFERENCES, microphoneEnabled: false, cameraEnabled: false, microphoneId: 'mic-2', cameraId: 'cam-2', outputId: 'speaker-2', mirrorLocalVideo: false, autoSpotlight: false, reduceMotion: true, employeeId: 'DO-NOT-STORE', token: 'DO-NOT-STORE' };
  const written = writePreferences(storage, choices);
  assert.deepEqual(readPreferences(storage).preferences, written);
  assert.ok(!raw.includes('DO-NOT-STORE'));
  assert.deepEqual(mediaChoices(written), { microphoneEnabled: false, cameraEnabled: false, microphoneId: 'mic-2', cameraId: 'cam-2' });
});
test('invalid preference types and device identifiers cannot become capture constraints', () => {
  assert.deepEqual(normalizePreferences({ microphoneEnabled: 'false', cameraEnabled: 0, microphoneId: {}, cameraId: '', outputId: 'a'.repeat(257), autoSpotlight: null }), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences([]), DEFAULT_PREFERENCES);
});
test('corrupt, unsupported and inaccessible storage return defaults with a notice', () => {
  for (const raw of ['{broken', 'null', '{"version":2}', '[]']) {
    const result = readPreferences({ getItem: () => raw });
    assert.deepEqual(result.preferences, DEFAULT_PREFERENCES); assert.ok(result.notice);
  }
  assert.ok(readPreferences({ getItem: () => { throw new Error('blocked'); } }).notice);
});
test('failed storage write throws instead of reporting success', () => {
  assert.throws(() => writePreferences({ setItem: () => { throw new Error('quota'); } }, DEFAULT_PREFERENCES), /quota/);
});
