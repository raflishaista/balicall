import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function load(apiRequest) {
  const source=readFileSync(new URL('../src/usePostMeetingBatch.ts',import.meta.url),'utf8');
  const exports={};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,name=>name==='react'?React:{apiRequest});return exports;
}
test('completed automatic batch is delivered to the summary page without a second start request',async()=>{
  const calls=[],results=[];let root,state;
  const {usePostMeetingBatch}=load(async(path,options)=>{calls.push({path,options});return {requested:true,job:{id:'batch-1',status:'done',transcripts:[{id:'final-1'}],summary:{title:'Batch summary'}}};});
  const onResult=result=>results.push(result);
  function Harness(){state=usePostMeetingBatch({meetingId:'qc room',token:'qc-token',enabled:true,onResult});return null;}
  try {await act(async()=>{root=create(React.createElement(Harness));});
    assert.equal(calls.length,1);assert.equal(calls[0].path,'/meetings/qc%20room/post-meeting-batch');
    assert.equal(calls[0].options.method,undefined);assert.equal(results.length,1);assert.equal(state.status,'done');
  } finally {await act(async()=>root?.unmount());}
});
test('leaving the summary aborts polling and ignores a late batch response',async()=>{
  let finish,signal,root;const results=[];
  const {usePostMeetingBatch}=load(async(_path,options)=>{signal=options.signal;return new Promise(done=>{finish=done;});});
  const onResult=result=>results.push(result);
  function Harness(){usePostMeetingBatch({meetingId:'old',token:'qc-token',enabled:true,onResult});return null;}
  await act(async()=>{root=create(React.createElement(Harness));});
  await act(async()=>root.unmount());assert.equal(signal.aborted,true);
  await act(async()=>finish({requested:true,job:{id:'old',status:'done',summary:{},transcripts:[]}}));
  assert.equal(results.length,0);
});
test('meetings without batch opt-in do not keep polling',async()=>{
  let root,state,calls=0;const {usePostMeetingBatch}=load(async()=>{calls++;return {requested:false,job:null};});
  const onResult=()=>assert.fail('No batch result expected');
  function Harness(){state=usePostMeetingBatch({meetingId:'live-only',token:'qc-token',enabled:true,onResult});return null;}
  try{await act(async()=>{root=create(React.createElement(Harness));});assert.equal(state,null);assert.equal(calls,1);}
  finally{await act(async()=>root?.unmount());}
});

test('pending batch keeps polling and publishes the completed revision once',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let root,state,calls=0;const results=[];
  const {usePostMeetingBatch}=load(async()=>++calls===1?{requested:true,job:{id:'queued-1',status:'transcribing'}}:{requested:true,job:{id:'queued-1',status:'done',transcripts:[{}],summary:{}}});
  const onResult=job=>results.push(job);
  function Harness(){state=usePostMeetingBatch({meetingId:'pending',token:'qc-token',enabled:true,onResult});return null;}
  try{
    await act(async()=>{root=create(React.createElement(Harness));});
    assert.equal(state.status,'transcribing');assert.equal(results.length,0);
    await act(async()=>t.mock.timers.tick(5000));
    assert.equal(state.status,'done');assert.equal(results.length,1);
    await act(async()=>t.mock.timers.tick(5000));assert.equal(calls,2);
  }finally{await act(async()=>root?.unmount());}
});
