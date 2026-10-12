import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {usePageFocus} from '../src/usePageFocus.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('page navigation focuses main once without stealing focus on unrelated updates or from an open dialog',async t=>{
 const original=globalThis.document;let modal=false,count=0,root;
 globalThis.document={querySelector:()=>modal?{}:null};
 const target={current:{focus(){count++;}}};
 function Harness({page}){usePageFocus(page,target);return null;}
 const render=async page=>act(async()=>{const element=React.createElement(Harness,{page});if(root)root.update(element);else root=create(element);});
 t.after(async()=>{await act(async()=>root?.unmount());globalThis.document=original;});
 await render('home');assert.equal(count,1);
 await render('home');assert.equal(count,1,'clock/profile updates must not steal focus');
 await render('lobby:create');assert.equal(count,2);
 await render('lobby:join');assert.equal(count,3,'changing lobby intent is navigation');
 modal=true;await render('settings');assert.equal(count,3,'open dialog owns focus');
 modal=false;await render('in-call');assert.equal(count,4);
 target.current=null;await render('summary');assert.equal(count,4,'missing target is safe');
});
