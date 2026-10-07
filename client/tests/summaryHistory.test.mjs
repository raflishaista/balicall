import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_KEY, HISTORY_LIMIT, SESSION_KEY, readSummaryHistory, readSummarySession, saveSummaryHistory, saveSummarySession, summaryTokenFor, upsertSummary } from '../src/summaryHistory.ts';
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function fixture() { globalThis.window = { localStorage: storage(), sessionStorage: storage() }; }
function record(id = 'meeting-1') {
  return { meetingId: id, roomName: 'Evaluasi monitoring', savedAt: '2026-10-07T00:00:00Z', summary: { title: 'Evaluasi monitoring', executiveSummary: 'Periksa jaringan', keyDiscussionPoints: [], decisions: [], actionItems: [], attendanceSummary: [] }, transcripts: [{ id: 'line-1', speakerId: 'BT-10492', speakerName: 'Rafli', text: 'Periksa jaringan', timestamp: '2026-10-07T00:00:00Z' }] };
}
test('history roundtrip preserves summary and transcript while projecting out tokens', () => {
  fixture(); const value = record();
  assert.equal(saveSummaryHistory([{ ...value, token: 'private-token' }]), true);
  assert.deepEqual(readSummaryHistory(), [value]);
  assert.equal(window.localStorage.getItem(HISTORY_KEY).includes('private-token'), false);
});
test('upsert replaces the same meeting and retains at most 20 latest results', () => {
  let values = [];
  for (let i = 0; i < 25; i++) values = upsertSummary(values, record(String(i)));
  assert.equal(values.length, HISTORY_LIMIT); assert.equal(values[0].meetingId, '24');
  values = upsertSummary(values, { ...record('20'), roomName: 'Updated' });
  assert.equal(values[0].roomName, 'Updated'); assert.equal(values.filter(item => item.meetingId === '20').length, 1);
});
test('refresh session stores tab credentials separately and reopening an older result keeps its own token', () => {
  fixture();
  const first = { meetingId: 'one', roomName: 'One', token: 'token-one', transcripts: [], open: true };
  assert.equal(saveSummarySession(first), true); assert.deepEqual(readSummarySession(), first);
  saveSummarySession({ ...first, meetingId: 'two', token: 'token-two' });
  assert.equal(summaryTokenFor('one'), 'token-one'); assert.equal(summaryTokenFor('two'), 'token-two');
  assert.equal(summaryTokenFor('missing'), ''); assert.equal(window.localStorage.getItem(SESSION_KEY), null);
});
test('malformed, schema-mismatched and blocked storage does not crash recovery', () => {
  fixture(); window.localStorage.setItem(HISTORY_KEY, '{broken'); assert.deepEqual(readSummaryHistory(), []);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify([{ ...record(), summary: { title: 'Bad' } }])); assert.deepEqual(readSummaryHistory(), []);
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ open: true, token: 'fake' })); assert.equal(readSummarySession(), null);
  window.localStorage.setItem = () => { throw new Error('Quota'); }; assert.equal(saveSummaryHistory([record()]), false);
  Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Blocked'); } });
  assert.equal(readSummarySession(), null); assert.equal(saveSummarySession({ meetingId: 'x', roomName: 'x', token: 'x', open: true, transcripts: [] }), false);
});
