import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDbSummary, HISTORY_KEY, HISTORY_LIMIT, SESSION_KEY, readSummaryHistory, readSummarySession, saveSummaryHistory, saveSummarySession, summaryTokenFor, upsertSummary } from '../src/summaryHistory.ts';
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, removeItem: key => data.delete(key), setItem: (key, value) => data.set(key, value) };
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
test('summary history and normalizeDbSummary preserve recording metadata', async () => {
  fixture();
  const { normalizeDbSummary } = await import('../src/summaryHistory.ts');
  const normalizedWithRec = normalizeDbSummary({
    id: 42,
    meeting_id: 'meeting-rec-1',
    room_name: 'Evaluasi Jaringan',
    created_at: '2026-10-23T07:46:19.108Z',
    hasRecording: true,
    recordingSize: 1048576,
    summary: { title: 'Notulen', executive_summary: 'Ringkasan' },
  });
  assert.equal(normalizedWithRec.hasRecording, true);
  assert.equal(normalizedWithRec.recordingSize, 1048576);

  const normalizedWithoutRec = normalizeDbSummary({
    id: 43,
    meeting_id: 'meeting-no-rec',
    room_name: 'Evaluasi Harian',
    created_at: '2026-10-23T07:46:19.108Z',
    hasRecording: false,
    summary: { title: 'Notulen', executive_summary: 'Ringkasan' },
  });
  assert.equal(normalizedWithoutRec.hasRecording, false);

  // Test roundtrip in localStorage
  saveSummaryHistory([normalizedWithRec, normalizedWithoutRec]);
  const retrieved = readSummaryHistory();
  assert.equal(retrieved.length, 2);
  assert.equal(retrieved[0].hasRecording, true);
  assert.equal(retrieved[0].recordingSize, 1048576);
  assert.equal(retrieved[1].hasRecording, false);
});

test('logout clears this account session tokens while preserving archives and other accounts',async()=>{
  const {clearSummarySession}=await import('../src/summaryHistory.ts');
  const {setAccountScope}=await import('../src/accountScope.ts');
  fixture();
  try{
    setAccountScope('account-a');saveSummaryHistory([record()]);saveSummarySession({meetingId:'meeting-1',roomName:'QC',token:'account-a-token',transcripts:[],open:true});
    setAccountScope('account-b');saveSummarySession({meetingId:'meeting-2',roomName:'QC',token:'account-b-token',transcripts:[],open:true});
    setAccountScope('account-a');clearSummarySession();
    assert.equal(readSummarySession(),null);assert.equal(summaryTokenFor('meeting-1'),'');assert.equal(readSummaryHistory().length,1);
    setAccountScope('account-b');assert.equal(summaryTokenFor('meeting-2'),'account-b-token');
  }finally{setAccountScope(null);}
});

test('source evidence roundtrips through browser archive and database normalization',()=>{
 fixture();const item=record();item.summary.sourceEvidence={version:1,transcriptDigest:'a'.repeat(64),utteranceCount:1,checkedFields:['decisions','actionItems'],items:[{field:'decisions',index:0,sources:[{utteranceId:'U0001',speaker:'QC',quote:'Disepakati 13 juta.'}]}]};
 saveSummaryHistory([item]);assert.deepEqual(readSummaryHistory()[0].summary.sourceEvidence,item.summary.sourceEvidence);
 const normalized=normalizeDbSummary({meeting_id:'qc',title:'QC',executive_summary:'QC',key_discussion_points:[],decisions:[],action_items:[],attendance_summary:[],source_evidence:item.summary.sourceEvidence});
 assert.deepEqual(normalized.summary.sourceEvidence,item.summary.sourceEvidence);
});
