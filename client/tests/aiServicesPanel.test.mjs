import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function component(){let source='';try{source=readFileSync(new URL('../src/AIServicesPanel.tsx',import.meta.url),'utf8');}catch{}const exports={};new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>name==='react'?React:jsx);return exports.AIServicesPanel;}
const content=root=>JSON.stringify(root.toJSON());
test('demo configuration is clearly labeled and does not claim model readiness',async()=>{
 let root;try{await act(async()=>{root=create(React.createElement(component(),{health:{status:'ok',llmProvider:'office',llmEffectiveProvider:'demo'},checking:false,error:null,checkedAt:null,onRefresh(){}}));});const text=content(root);assert.match(text,/Mode demo/);assert.match(text,/tidak membuat ringkasan AI/);assert.doesNotMatch(text,/Siap digunakan/);}
 finally{await act(async()=>root?.unmount());}
});
test('unavailable health does not masquerade as demo and retry is accessible',async()=>{
 let attempts=0,root;try{await act(async()=>{root=create(React.createElement(component(),{health:null,checking:false,error:'Tidak tersambung',checkedAt:null,onRefresh:()=>attempts++}));});assert.doesNotMatch(content(root),/Mode demo aktif/);const retry=root.root.findByType('button');assert.equal(retry.props.disabled,false);retry.props.onClick();assert.equal(attempts,1);}
 finally{await act(async()=>root?.unmount());}
});
