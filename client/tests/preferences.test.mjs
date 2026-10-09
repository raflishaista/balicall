import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, normalizePreferences, readPreferences, writePreferences, mediaChoices, resolveTranscriptionPreferences } from '../src/preferences.ts';

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

test('older saved preferences gain AI defaults without losing existing device choices', () => {
  const saved = readPreferences({ getItem: () => JSON.stringify({ version: 1, preferences: { microphoneId: 'office-mic', cameraEnabled: false } }) });
  assert.equal(saved.notice, null);
  assert.equal(saved.preferences.microphoneId, 'office-mic');
  assert.equal(saved.preferences.cameraEnabled, false);
  assert.equal(saved.preferences.speechLanguage, 'id-ID');
  assert.equal(saved.preferences.transcriptionProvider, 'auto');
  assert.equal(saved.preferences.transcriptionModel, '');
});

test('AI choices survive storage round-trip and invalid inputs are rejected', () => {
  let raw;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const choices = { ...DEFAULT_PREFERENCES, speechLanguage: 'en-US', transcriptionProvider: 'server', transcriptionModel: 'whisperlivekit-small' };
  writePreferences(storage, choices);
  assert.deepEqual(readPreferences(storage).preferences, choices);
  assert.deepEqual(normalizePreferences({ speechLanguage: 'xx', transcriptionProvider: 'other', transcriptionModel: '../unsafe' }), DEFAULT_PREFERENCES);
});

test('AI defaults respect explicit Browser, automatic provider, and advertised models', () => {
  const models = ['small', 'small-id', 'whisperlivekit-small'];
  const preferences = { ...DEFAULT_PREFERENCES, transcriptionProvider: 'server', transcriptionModel: 'small-id' };
  assert.deepEqual(resolveTranscriptionPreferences(preferences, true, models, 'small', 'browser'), { provider: 'server', model: 'small-id', notice: null });
  assert.equal(resolveTranscriptionPreferences({ ...preferences, transcriptionProvider: 'browser' }, true, models, 'small', 'server').provider, 'browser');
  assert.equal(resolveTranscriptionPreferences(DEFAULT_PREFERENCES, true, models, 'small', 'server').provider, 'server');
  assert.equal(resolveTranscriptionPreferences(DEFAULT_PREFERENCES, true, models, 'small', 'browser').provider, 'browser');
});

test('unavailable services and models fall back with a notice instead of requesting unsupported models', () => {
  const preferences = { ...DEFAULT_PREFERENCES, transcriptionProvider: 'server', transcriptionModel: 'removed-model' };
  const offline = resolveTranscriptionPreferences(preferences, false, [], '', 'server');
  assert.equal(offline.provider, 'browser'); assert.ok(offline.notice);
  const removed = resolveTranscriptionPreferences(preferences, true, ['small'], 'missing-default', 'server');
  assert.equal(removed.model, 'small'); assert.ok(removed.notice);
});
