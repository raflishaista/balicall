import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const exports={};new Function('exports','require',ts.transpileModule(readFileSync(new URL('../src/McpReviewPanel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>name==='./api'?{apiRequest(){throw Error('Must inject fake client')}}:name.endsWith('.css')?{}:require(name));
const ready={revision:'rev',planDigest:'digest',status:'ready',canDecide:true,operations:[{method:'createTask',args:{title:'Periksa jaringan',project:'p'}}]};
for(const decision of [true,false])test(`host ${decision?'Yes':'No'} requires explicit consent and exact revision`,async()=>{
 const calls=[];let root;
 const request=async(path,options)=>{if(options.method==='POST'){calls.push(JSON.parse(options.body));return {...ready,status:decision?'sent':'rejected',canDecide:!decision};}return ready;};
 try{await act(async()=>{root=create(React.createElement(exports.McpReviewPanel,{meetingId:'m',token:'token',request}));});assert.equal(calls.length,0);assert.match(JSON.stringify(root.toJSON()),/Periksa jaringan/);
 const buttons=root.root.findAllByType('button');await act(async()=>buttons[decision?0:1].props.onClick());
 assert.deepEqual(calls,[{decision,revision:'rev',planDigest:'digest'}]);assert.match(JSON.stringify(root.toJSON()),decision?/Perubahan telah dikirim/:/Host memilih tidak mengirim/);
 }finally{await act(async()=>root?.unmount());}
});
test('participants have no approval controls; failed load never enables sending',async()=>{
 for(const result of [{...ready,canDecide:false,operations:[]},null]){let root;try{
 await act(async()=>{root=create(React.createElement(exports.McpReviewPanel,{meetingId:'m',token:'t',request:async()=>{if(!result)throw Error('Offline');return result;}}));});
 assert.equal(root.root.findAllByType('button').length,1);
 if(!result)assert.match(JSON.stringify(root.toJSON()),/Offline/);
 }finally{await act(async()=>root?.unmount());}}
});
