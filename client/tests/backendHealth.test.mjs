import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function load(apiRequest){
 let source='';try{source=readFileSync(new URL('../src/useBackendHealth.ts',import.meta.url),'utf8');}catch{}
 const exports={};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports','require',code)(exports,name=>name==='react'?React:{apiRequest});return exports;
}
test('health failure is distinguishable from unconfigured AI and manual retry recovers',async()=>{
 let calls=0,state,root;const {useBackendHealth}=load(async()=>{if(++calls===1)throw new Error('offline');return{status:'ok',llmEffectiveProvider:'demo'};});
 function Harness(){const current=useBackendHealth();React.useEffect(()=>{state=current;});return null;}
 try{await act(async()=>{root=create(React.createElement(Harness));});assert.equal(state.health,null);assert.equal(state.checked,true);assert.ok(state.error);await act(async()=>state.refresh());assert.equal(calls,2);assert.equal(state.health.llmEffectiveProvider,'demo');assert.equal(state.error,null);assert.ok(state.checkedAt);}
 finally{await act(async()=>root?.unmount());}
});
test('concurrent health checks are coalesced and unmount aborts the request',async()=>{
 let calls=0,signal,state,root;const {useBackendHealth}=load(async(_path,options)=>{calls++;signal=options.signal;return new Promise(()=>{});});
 function Harness(){const current=useBackendHealth();React.useEffect(()=>{state=current;});return null;}
 try{await act(async()=>{root=create(React.createElement(Harness));});await act(async()=>{state.refresh();state.refresh();});assert.equal(calls,1);assert.equal(state.checking,true);await act(async()=>root.unmount());root=null;assert.equal(signal.aborted,true);}
 finally{await act(async()=>root?.unmount());}
});

test('retired batch Qwen is absent while native Qwen Live stays selectable',async()=>{
 let state,root;
 const {useBackendHealth}=load(async()=>({status:'ok',sttModel:'qwen3-asr-0.6b',sttModels:['qwen3-asr-0.6b','small','qwen3-asr-0.6b-live'],qwenLiveReady:true}));
 function Harness(){const current=useBackendHealth();React.useEffect(()=>{state=current;});return null;}
 try{await act(async()=>{root=create(React.createElement(Harness));});assert.deepEqual(state.health.sttModels,['small','qwen3-asr-0.6b-live']);assert.equal(state.health.sttModel,'small');assert.equal(state.health.qwenLiveReady,true);}
 finally{await act(async()=>root?.unmount());}
});


test('background tabs skip health polling and refresh when visible again',async t=>{
 const previous=globalThis.document;let poll,listener,calls=0,removed=false,root;
 globalThis.document={visibilityState:'visible',addEventListener:(_event,callback)=>{listener=callback;},removeEventListener:(_event,callback)=>{removed=callback===listener;}};
 t.mock.method(globalThis,'setInterval',callback=>{poll=callback;return 1;});
 t.mock.method(globalThis,'clearInterval',()=>{});
 const {useBackendHealth}=load(async()=>{calls++;return{status:'ok'};});
 function Harness(){useBackendHealth();return null;}
 try{
  await act(async()=>{root=create(React.createElement(Harness));});assert.equal(calls,1);
  document.visibilityState='hidden';await act(async()=>poll());assert.equal(calls,1);
  document.visibilityState='visible';await act(async()=>listener());assert.equal(calls,2);
  await act(async()=>root.unmount());root=null;assert.equal(removed,true);
 }finally{await act(async()=>root?.unmount());globalThis.document=previous;}
});
