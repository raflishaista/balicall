import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual App join handler without loading LiveKit or opening devices.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleJoin') handler = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(handler);
const code = ts.transpileModule(`exports.join = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(apiRequest = async () => ({ token:'qc-token', url:'ws://qc', meetingId:'new-room', sttProvider:'server' })) {
  const state = { isSummarizing: true, summary: {title:'Previous room'}, summaryMeetingId:'previous-room' };
  const scope = {
    joinPending:{current:false}, joinGeneration:{current:0}, summaryGeneration:{current:5}, endingMeeting:{current:false},
    department:'QC', employeeId:'qc-owner', employeeName:'QC', roomName:'New room',
    preJoinMedia:{prepareJoin:()=>({microphoneEnabled:false,cameraEnabled:false})}, apiRequest,
    navigateTo:route=>{state.view=route.view;},
    userPreferences:{preferences:{}}, transcriptDelivery:{beginMeeting:id=>{state.deliveryMeeting=id;}},
    backendHealth:{sttConfigured:true, sttModels:['sea-asr-id-live'], sttModel:'sea-asr-id-live'},
    getRecommendedProvider:()=> 'server', resolveTranscriptionPreferences:()=>({provider:'server'}),
  };
  for (const name of ['JoinError','CallError','SyncError','IsJoining','CallPreferences','JoinMedia','Token','MeetingId','ServerUrl',
    'SttProvider','Transcripts','CallDuration','MeetingStartTime','RecordingError','IsRecording','GuestInviteCode',
    'Summary','SummaryError','SummaryMeetingId','SummaryToken','SummaryRoomName','View','IsSummarizing','BatchDiarizing']) {
    scope['set'+name] = value => { state[name[0].toLowerCase()+name.slice(1)] = value; };
  }
  const exports = {};
  new Function('exports','scope',`with(scope) { ${code} }`)(exports, scope);
  return { state, scope, join:exports.join };
}

test('joining a new meeting clears previous summary loading so ASR and meeting controls can start', async () => {
  const f=fixture(); await f.join();
  assert.equal(f.state.view,'in-call');
  assert.equal(f.state.deliveryMeeting,'new-room');
  assert.equal(f.state.summary,null);
  assert.equal(f.state.isSummarizing,false, 'Old summary state must not mute the new ASR session or lock its controls');
  assert.equal(f.scope.summaryGeneration.current,6, 'Old summary responses must remain invalidated');
});

test('stale token responses cannot clear a newer summary job', async () => {
  let resolve;
  const f=fixture(()=>new Promise(done=>{resolve=done;}));
  const joining=f.join(); f.scope.joinGeneration.current++;
  resolve({token:'stale',meetingId:'stale-room'}); await joining;
  assert.equal(f.state.isSummarizing,true);
  assert.equal(f.state.deliveryMeeting,undefined);
});
