import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSummary,summarize} from '../providers.js';
import {SUMMARY_INSTRUCTIONS,buildSummaryInput} from '../summaryGrounding.js';
import {loadConfig} from '../config.js';
const base=()=>({title:'QC',executiveSummary:'QC',keyDiscussionPoints:[],decisions:[],actionItems:[],attendanceSummary:[]});
const action=()=>({task:'Periksa jaringan',assignee:'',deadline:'',priority:'Medium',project:'',parent:''});
const parse=value=>parseSummary(JSON.stringify(value));

test('absent MCP extensions normalize to empty lists, malformed supplied extensions are rejected',()=>{
 const value=parse(base());for(const field of ['taskUpdates','taskEdits','projectCreations','projectUpdates'])assert.deepEqual(value[field],[]);
 for(const field of ['taskUpdates','taskEdits','projectCreations','projectUpdates'])for(const bad of [null,{},'invalid',1])assert.throws(()=>parse({...base(),[field]:bad}),/schema/);
});
test('action contract preserves explicit project/parent and rejects missing or mistyped routing fields',()=>{
 const value={...base(),actionItems:[action()]};assert.deepEqual(parse(value).actionItems,value.actionItems);
 for(const field of ['project','parent'])for(const bad of [undefined,null,42,{}])assert.throws(()=>parse({...base(),actionItems:[{...action(),[field]:bad}]}),/schema/);
});
test('task edit contract accepts only supported typed changes and nonempty task references',()=>{
 const valid={task:'Periksa jaringan',changes:{title:'Periksa router',assignUsers:['Rafli'],removeTags:['Urgent']}};
 assert.deepEqual(parse({...base(),taskEdits:[valid]}).taskEdits,[valid]);
 for(const bad of [{task:'',changes:{title:'A'}},{task:'A',changes:{}},{task:'A',changes:[]},{task:'A',changes:{owner:42}},{task:'A',changes:{assignUsers:'Rafli'}},{task:'A',changes:{tags:[42]}},{task:'A',changes:{delete:true}}])assert.throws(()=>parse({...base(),taskEdits:[bad]}),/schema/);
});
test('prompt JSON example is syntactically valid and describes routing fields required by parser',()=>{
 const start=SUMMARY_INSTRUCTIONS.indexOf('{'),end=SUMMARY_INSTRUCTIONS.lastIndexOf('}');
 const example=JSON.parse(SUMMARY_INSTRUCTIONS.slice(start,end+1));
 assert.equal(typeof example.actionItems[0].project,'string');assert.equal(typeof example.actionItems[0].parent,'string');
});
test('unsupported evidence never becomes an accepted summary or silently loses source evidence',()=>{
 const meeting={roomName:'QC',participants:new Map(),transcripts:[{speakerName:'Ketua',text:'Belum disepakati migrasi.'}]};
 assert.throws(()=>parseSummary(JSON.stringify({...base(),decisions:['Migrasi disepakati.']}),buildSummaryInput(meeting)),error=>error.status===422 && /rujukan/i.test(error.message));
});
test('demo and model summaries expose the same empty MCP collections',async()=>{
 const result=await summarize({roomName:'QC',participants:new Map(),transcripts:[]},loadConfig({LLM_PROVIDER:'demo'}));
 for(const field of ['taskUpdates','taskEdits','projectCreations','projectUpdates'])assert.deepEqual(result[field],[]);
});
