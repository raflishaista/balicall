import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

function load(startLiveTranscription){
 const exports={};
 const source=readFileSync(new URL('../src/useWhisperLiveTranscription.ts',import.meta.url),'utf8');
 new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports,name=>name==='react'?React:{startLiveTranscription});
 return exports.useWhisperLiveTranscription;
}
const track=device=>({id:'track-'+device,readyState:'live',getSettings:()=>({deviceId:device})});
async function fixture(t){
 const runs=[],calls=[],finishes=[];let state,root;
 const useHook=load(options=>{
  runs.push(options);
  void options.createSession();
  queueMicrotask(()=>{options.onSession?.({sessionId:'stable-speaker-session',resumed:runs.length>1});options.onReady(true);});
  return{finish:async mode=>{finishes.push(mode);}};
 });
 let props={muted:false,track:track('mic1'),language:'id-ID',model:'qwen3-asr-0.6b-live',diarize:true,createSession:async(...args)=>{calls.push(args);return{url:'/synthetic'};},onFinal(){}};
 function Harness(){const value=useHook(props);React.useEffect(()=>{state=value;});return null;}
 await act(async()=>{root=create(React.createElement(Harness));});
 t.after(async()=>{await act(async()=>root.unmount());});
 return{runs,calls,finishes,get state(){return state;},async update(patch){props={...props,...patch};await act(async()=>root.update(React.createElement(Harness)));}};
}
test('mute resumes the same signed microphone; explicit device changes start a separate source',async t=>{
 const f=await fixture(t);const id=f.calls[0][3];assert.ok(id.length>=16);
 await f.update({muted:true});assert.deepEqual(f.finishes.at(-1),{pause:true});
 await f.update({muted:false,track:track('mic1')});assert.equal(f.calls[1][3],id);
 await act(async()=>f.state.prepareTrackChange());
 await f.update({track:track('mic2')});
 await act(async()=>f.state.resumeTrackChange());
 assert.notEqual(f.calls.at(-1)[3],id);
});
test('device change and meeting end explicitly finalize a previously paused controller',async t=>{
 const f=await fixture(t);
 await f.update({muted:true});let count=f.finishes.length;
 await act(async()=>f.state.prepareTrackChange());
 assert.equal(f.finishes.length,count+1);assert.equal(f.finishes.at(-1),undefined);
 await act(async()=>f.state.resumeTrackChange());
 await f.update({muted:false});await f.update({muted:true});count=f.finishes.length;
 await act(async()=>f.state.finishTranscription());
 assert.equal(f.finishes.length,count+1);assert.equal(f.finishes.at(-1),undefined);
});
test('retrying a session-expiry warning keeps transcription enabled',async t=>{
 const f=await fixture(t);
 await act(async()=>f.runs[0].onSession({sessionId:'expired-session-replacement',resumed:false}));
 assert.match(f.state.speechError,/sesi baru/i);
 await act(async()=>f.state.toggleSpeechRecognition());
 assert.equal(f.state.speechEnabled,true);
});
test('expired speaker state is visible and automatic reconnect stops after three attempts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture(t);
 await act(async()=>f.runs[0].onSession({sessionId:'new-speaker-session',resumed:false}));
 assert.match(f.state.speechError,/sesi baru/i);
 for(const wait of [1000,2000,4000]){
  await act(async()=>f.runs.at(-1).onError('Network unavailable'));
  await act(async()=>t.mock.timers.tick(wait));
 }
 assert.equal(f.runs.length,4);
 await act(async()=>f.runs.at(-1).onError('Network unavailable'));
 await act(async()=>t.mock.timers.tick(60000));
 assert.equal(f.runs.length,4);assert.equal(f.state.speechError,'Network unavailable');
});
