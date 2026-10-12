import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {act,create} from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const compiled=ts.transpileModule(readFileSync(new URL('../src/NotificationCenter.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(apiRequest){
 const exports={};const navigator={serviceWorker:{addEventListener(){},removeEventListener(){}}};
 const window={addEventListener(){},removeEventListener(){}};
 new Function('exports','require','navigator','window','location',compiled)(exports,name=>name==='react'?React:name==='react/jsx-runtime'?requireJSX:name==='lucide-react'?{Bell:()=>null}:name==='./api'?{apiRequest}:{pushSupported:()=>true,getPushDeviceStatus:async()=> 'inactive',enablePush:async()=>{},disablePush:async()=>{}},navigator,window,{search:''});
 return exports;
}
import * as requireJSX from 'react/jsx-runtime';
test('inbox retry recovers a failed request without losing available notifications',async()=>{
 let attempts=0,root;const {NotificationCenter}=load(async()=>{if(++attempts===1)throw new Error('offline');return{notifications:[]};});
 try{
  await act(async()=>{root=create(React.createElement(NotificationCenter,{onJoin(){},onSummary(){}}));});
  await act(async()=>root.root.findByProps({'aria-label':'Notifikasi akun'}).props.onClick());
  await act(async()=>root.root.findAllByType('button').find(b=>b.children.join('')==='Coba lagi').props.onClick());
  assert.equal(attempts,2);
  assert.ok(root.root.findAllByType('p').some(p=>p.children.join('')==='Belum ada notifikasi.'));
 }finally{await act(async()=>root?.unmount());}
});
test('failed push configuration can be retried instead of being reported as unconfigured',async()=>{
 let attempts=0,root;const {PushSettings}=load(async()=>{if(++attempts===1)throw new Error('offline');return{configured:true,publicKey:'key'};});
 try{
  await act(async()=>{root=create(React.createElement(PushSettings));});
  const retry=root.root.findAllByType('button').find(b=>b.children.join('').includes('Coba lagi'));
  assert.ok(retry,'configuration error must offer recovery');
  await act(async()=>retry.props.onClick());
  assert.equal(attempts,2);
  assert.equal(root.root.findAllByType('button').find(b=>b.children.join('').includes('Aktifkan')).props.disabled,false);
 }finally{await act(async()=>root?.unmount());}
});
test('opening a notice is locked while marking it read and recovers after failure',async()=>{
 let resolve,reject,reads=0,joins=0,root;
 const item={id:'one',kind:'invitation',roomName:'Room',meetingId:null,readAt:null,createdAt:new Date().toISOString()};
 const {NotificationCenter}=load(async path=>{if(path==='/notifications')return{notifications:[item]};reads++;return new Promise((yes,no)=>{resolve=yes;reject=no;});});
 try{
  await act(async()=>{root=create(React.createElement(NotificationCenter,{onJoin:()=>joins++,onSummary(){}}));});
  await act(async()=>root.root.findByProps({'aria-label':'Notifikasi akun'}).props.onClick());
  let choice=root.root.findByProps({className:'notification-item'});
  await act(async()=>{choice.props.onClick();choice.props.onClick();});
  assert.equal(reads,1,'double click must not submit twice');assert.equal(choice.props.disabled,true);
  await act(async()=>reject(new Error('offline')));
  choice=root.root.findByProps({className:'notification-item'});assert.equal(choice.props.disabled,false);
  await act(async()=>choice.props.onClick());await act(async()=>resolve({success:true}));
  assert.equal(joins,1);
 }finally{await act(async()=>root?.unmount());}
});
