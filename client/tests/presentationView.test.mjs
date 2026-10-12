import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {usePresentationView} from '../src/usePresentationView.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('sharing enters focus, preserves base panel, and restores view after share ends',async t=>{
 let state,root;
 function Harness({sharing,basePanel}){const value=usePresentationView(sharing,basePanel);React.useEffect(()=>{state=value;});return null;}
 const update=async(sharing,basePanel=true)=>act(async()=>{const element=React.createElement(Harness,{sharing,basePanel});if(root)root.update(element);else root=create(element);});
 t.after(()=>act(async()=>root?.unmount()));
 await update(false);assert.equal(state.panelVisible,true);assert.equal(state.focused,false);
 await update(true);assert.equal(state.focused,true);assert.equal(state.panelVisible,false);assert.equal(state.showThumbnails,false);
 await act(async()=>state.toggleThumbnails());assert.equal(state.showThumbnails,true);assert.equal(state.focused,true);
 await act(async()=>state.setPanelVisible(true));assert.equal(state.panelVisible,true);
 await act(async()=>state.toggleFocus());assert.equal(state.focused,false);assert.equal(state.panelVisible,true);
 await update(false);assert.equal(state.panelVisible,true);assert.equal(state.focused,false);
 await update(true,false);assert.equal(state.focused,true);assert.equal(state.panelVisible,false);assert.equal(state.showThumbnails,false);
 await update(false,false);assert.equal(state.panelVisible,false);
});
