import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {usePresentationFullscreen} from '../src/usePresentationFullscreen.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('fullscreen follows browser exit, rejects safely, and exits when sharing ends including a pending request',async t=>{
 const originals={document:globalThis.document,Element:globalThis.Element};
 const listeners=new Set();let exitCount=0,request=async()=>{doc.fullscreenElement=target.current;changed();};
 const changed=()=>{for(const listener of listeners)listener();};
 const doc={fullscreenEnabled:true,fullscreenElement:null,addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn),exitFullscreen:async()=>{exitCount++;doc.fullscreenElement=null;changed();}};
 globalThis.document=doc;globalThis.Element=class{requestFullscreen(){}};
 const target={current:{requestFullscreen:()=>request()}};let state,root;
 function Harness({sharing}){const value=usePresentationFullscreen(target,sharing);React.useEffect(()=>{state=value;});return null;}
 const update=async sharing=>act(async()=>{const element=React.createElement(Harness,{sharing});if(root)root.update(element);else root=create(element);});
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,originals);});
 await update(true);await act(async()=>state.toggle());assert.equal(state.fullscreen,true);
 await act(async()=>{doc.fullscreenElement=null;changed();});assert.equal(state.fullscreen,false,'native Esc/exit is observed');
 request=async()=>{throw new Error('Denied');};await act(async()=>state.toggle());assert.match(state.error,/Fokus Presentasi/);assert.equal(state.pending,false);
 request=async()=>{doc.fullscreenElement=target.current;changed();};await act(async()=>state.toggle());await update(false);assert.equal(state.fullscreen,false);assert.equal(exitCount,1);
 await update(true);let resolve,promise;request=()=>new Promise(r=>{resolve=()=>{doc.fullscreenElement=target.current;changed();r();};});
 await act(async()=>{promise=state.toggle();});assert.equal(state.pending,true);await update(false);await act(async()=>{resolve();await promise;});assert.equal(doc.fullscreenElement,null);assert.equal(exitCount,2);assert.equal(state.pending,false);
 doc.fullscreenElement={other:true};await update(true);await update(false);assert.equal(exitCount,2,'never exits another fullscreen element');
});
