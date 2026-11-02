import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseSummary} from '../providers.js';import {buildSummaryInput} from '../summaryGrounding.js';
const base={title:'QC',executiveSummary:'QC',keyDiscussionPoints:[],decisions:[],actionItems:[],attendanceSummary:[]};
const op={operation:'delete',project:'Jaringan',sprint:'Sprint Alpha',name:'',goal:'',startDate:'',endDate:'',duration:'',retrospective:'',moveIncompleteTo:'',tasks:[],task:''};
const input=text=>buildSummaryInput({roomName:'QC',transcripts:[{text,speakerName:'QC'}]});
test('sprint collection is optional but malformed present values are rejected',()=>{assert.deepEqual(parseSummary(JSON.stringify(base)).sprintOperations,[]);for(const value of [null,{},'bad'])assert.throws(()=>parseSummary(JSON.stringify({...base,sprintOperations:value})),/schema/);});
test('sprint deletion requires relevant quoted instruction and targets',()=>{
 const text='Hapus sprint Sprint Alpha pada proyek Jaringan.';
 const value={...base,sprintOperations:[op]};assert.throws(()=>parseSummary(JSON.stringify(value),input(text)),e=>e.status===422);
 value.evidence={sprintOperations:[{index:0,sources:[{utteranceId:'U0001',quote:text}]}]};
 assert.equal(parseSummary(JSON.stringify(value),input(text)).sourceEvidence.items[0].field,'sprintOperations');
 assert.throws(()=>parseSummary(JSON.stringify({...value,sprintOperations:[{...op,sprint:'Sprint Beta'}]}),input(text)),e=>e.status===422);
 const negative='Jangan hapus sprint Sprint Alpha pada proyek Jaringan.';value.evidence.sprintOperations[0].sources[0].quote=negative;assert.throws(()=>parseSummary(JSON.stringify(value),input(negative)),e=>e.status===422);
 const greeting='Halo proyek Jaringan dan sprint Sprint Alpha.';value.evidence.sprintOperations[0].sources[0].quote=greeting;
 assert.throws(()=>parseSummary(JSON.stringify(value),input(greeting)),e=>e.status===422);
});
