import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {validSourceEvidence} from '../src/summaryHistory.ts';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/SummaryEvidence.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={};new Function('exports','require',code)(module,name=>name==='./summaryHistory'?{validSourceEvidence}:require(name));
const summary={decisions:['Anggaran 13 juta.'],actionItems:[],sourceEvidence:{version:1,transcriptDigest:'a'.repeat(64),utteranceCount:1,items:[{field:'decisions',index:0,sources:[{utteranceId:'U0001',speaker:'Siti',quote:'Disepakati 13 juta.'}]}]}};
test('summary references show the claim, original quote and speaker without asserting audio correctness',()=>{
 const html=renderToStaticMarkup(React.createElement(module.SummaryEvidence,{summary}));
 for(const text of ['Anggaran 13 juta.','Disepakati 13 juta.','Siti','U0001'])assert.ok(html.includes(text));
 assert.ok(!html.includes('Akurasi terverifikasi'));
});
test('legacy summaries and malformed references do not crash or show invented citations',()=>{
 for(const value of [{...summary,sourceEvidence:undefined},{...summary,sourceEvidence:{items:'invalid'}}])assert.equal(renderToStaticMarkup(React.createElement(module.SummaryEvidence,{summary:value})), '');
});
