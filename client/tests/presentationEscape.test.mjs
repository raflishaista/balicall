import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {usePresentationEscape} from '../src/usePresentationEscape.ts';
import {usePresentationView} from '../src/usePresentationView.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

class TestDocument extends EventTarget {
  fullscreenElement=null;
  blockingOverlay=false;
  listeners=new Set();
  querySelector(){return this.blockingOverlay?{}:null;}
  addEventListener(type,listener,options){super.addEventListener(type,listener,options);if(type==='keydown')this.listeners.add(listener);}
  removeEventListener(type,listener,options){super.removeEventListener(type,listener,options);if(type==='keydown')this.listeners.delete(listener);}
}
function key(document,properties={}) {
  const event=new Event('keydown',{cancelable:true});
  Object.assign(event,{key:'Escape',repeat:false,isComposing:false,...properties});
  document.dispatchEvent(event);return event;
}

test('document Escape exits Focus once and releases its listener without entering Focus again',async t=>{
  const original=globalThis.document,document=new TestDocument();globalThis.document=document;
  let root,state;
  function Harness(){const value=usePresentationView(true,true);usePresentationEscape(value.focused,value.toggleFocus);React.useEffect(()=>{state=value;});return null;}
  t.after(async()=>{await act(async()=>root?.unmount());globalThis.document=original;});
  await act(async()=>{root=create(React.createElement(React.StrictMode,null,React.createElement(Harness)));});
  assert.equal(state.focused,true);assert.equal(document.listeners.size,1);
  let event;await act(async()=>{event=key(document);});
  assert.equal(event.defaultPrevented,true);assert.equal(state.focused,false);assert.equal(state.panelVisible,true);assert.equal(document.listeners.size,0);
  await act(async()=>key(document));assert.equal(state.focused,false,'a later Escape cannot toggle Focus back on');
});

test('Escape respects overlays, fullscreen, handled/repeated/composition events and latest callback; unmount cleans up',async t=>{
  const original=globalThis.document,document=new TestDocument();globalThis.document=document;
  let root,first=0,latest=0;
  function Harness({enabled,exit}){usePresentationEscape(enabled,exit);return null;}
  const render=async(enabled,exit)=>act(async()=>{const element=React.createElement(Harness,{enabled,exit});if(root)root.update(element);else root=create(element);});
  t.after(async()=>{await act(async()=>root?.unmount());globalThis.document=original;});
  await render(true,()=>first++);
  document.blockingOverlay=true;key(document);document.blockingOverlay=false;
  document.fullscreenElement={};key(document);document.fullscreenElement=null;
  key(document,{key:'Enter'});key(document,{repeat:true});key(document,{isComposing:true});
  const handled=new Event('keydown',{cancelable:true});Object.assign(handled,{key:'Escape'});handled.preventDefault();document.dispatchEvent(handled);
  assert.equal(first,0);
  await render(true,()=>latest++);const event=key(document);assert.equal(event.defaultPrevented,true);assert.equal(first,0);assert.equal(latest,1);
  await render(false,()=>latest++);key(document);assert.equal(latest,1);assert.equal(document.listeners.size,0);
  await render(true,()=>latest++);await act(async()=>root.unmount());key(document);assert.equal(latest,1);assert.equal(document.listeners.size,0);
});
