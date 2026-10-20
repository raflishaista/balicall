import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const source=readFileSync(new URL('../src/SpeakerNameEditor.tsx',import.meta.url),'utf8');
const exports={};
new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>name==='react'?React:name==='react/jsx-runtime'?jsx:{});
const {SpeakerNameEditor}=exports;
test('manual name editor submits the source/session scope and permits clearing the alias',async()=>{
 let root;const saved=[];
 try{
  await act(async()=>{root=create(React.createElement(SpeakerNameEditor,{sourceId:'owner',sessionId:'session-a',speaker:'Pembicara 1',onSave:async value=>saved.push(value)}));});
  await act(async()=>root.root.findByType('button').props.onClick());
  assert.equal(root.root.findByType('input').props.maxLength,80);
  await act(async()=>root.root.findByType('input').props.onChange({target:{value:' Budi '}}));
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(saved[0],{sourceId:'owner',sessionId:'session-a',speaker:'Pembicara 1',name:'Budi'});
  await act(async()=>root.root.findByType('button').props.onClick());
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved[1].name,'');
 }finally{await act(async()=>root?.unmount());}
});
test('failed name saves keep the editor open and show a recoverable error',async()=>{
 let root;
 try{
  await act(async()=>{root=create(React.createElement(SpeakerNameEditor,{sourceId:'owner',sessionId:'session-a',speaker:'Pembicara 1',onSave:async()=>{throw Error('Belum tersimpan');}}));});
  await act(async()=>root.root.findByType('button').props.onClick());
  await act(async()=>root.root.findByType('input').props.onChange({target:{value:'Budi'}}));
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(root.root.findByProps({role:'alert'}).children.join(''),'Belum tersimpan');
  assert.equal(root.root.findByType('input').props.value,'Budi');
 }finally{await act(async()=>root?.unmount());}
});
