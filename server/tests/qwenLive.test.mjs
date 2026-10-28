import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qwenLiveCapabilities,validateLiveFinal,QWEN_LIVE_MODEL,attributedSpeakerName} from '../qwenLiveConfig.js';
import {loadConfig} from '../config.js';
import {summarize} from '../providers.js';

test('live Qwen config requires a private secret and native ready probe',async()=>{
 assert.throws(()=>loadConfig({QWEN_LIVE_STT_URL:'/qwen-live-stt/asr'}),/Qwen streaming/);
 const config=loadConfig({QWEN_LIVE_STT_URL:'/qwen-live-stt/asr',QWEN_LIVE_STT_SECRET:'s'.repeat(40)});
 for(const state of [{ready:true,native:true,streaming:true,diarization:true},{ready:true,streaming:true},{ready:false,native:true,streaming:true}]){
  const result=await qwenLiveCapabilities(config,async()=>new Response(JSON.stringify({...state,model:QWEN_LIVE_MODEL})));
  assert.equal(result.ready,state.ready===true&&state.native===true&&state.streaming===true);
  assert.equal(result.diarization,result.ready&&state.diarization===true);
 }
});

test('live final rejects forged source and invalid ranges; keeps speaker namespace',()=>{
 const final={segmentId:'session-1',sessionId:'session',sourceId:'owner',text:'hello',start:0,end:1,speakerLabel:'Pembicara 1',attribution:'assigned'};
 const result=validateLiveFinal(final,'owner');
 assert.equal(result.segments[0].speaker,'Pembicara 1');assert.equal(result.segments[0].sourceId,'owner');
 for(const change of [{sourceId:'other'},{start:-1},{end:NaN},{attribution:'real-name'},{sessionId:''},{text:''}]){
  assert.throws(()=>validateLiveFinal({...final,...change},'owner'));
 }
});

test('flattened database speaker names distinguish anonymous session namespaces',()=>{
 const segment={speaker:'Pembicara 1',sessionId:'11111111-aaaa'};
 assert.notEqual(attributedSpeakerName('Room account',segment),attributedSpeakerName('Room account',{...segment,sessionId:'22222222-bbbb'}));
 assert.equal(attributedSpeakerName('Room account',{speaker:'Pembicara 1'}),'Room account (Pembicara 1)');
});

test('summary dialogue keeps session-scoped anonymous speakers distinct in demo and office modes',async()=>{
 const meeting={roomName:'Synthetic room',participants:new Map(),transcripts:['11111111-aaaa','22222222-bbbb'].map(sessionId=>({speakerName:'Room',text:'Rapat',segments:[{speaker:'Pembicara 1',sessionId,text:'Rapat',start:0,end:1}]}))};
 const demo=await summarize(meeting,loadConfig({LLM_PROVIDER:'demo'}));
 assert.notEqual(demo.keyDiscussionPoints[0],demo.keyDiscussionPoints[1]);
 let prompt;
 await summarize(meeting,loadConfig({LLM_PROVIDER:'office',LLM_KEY:'synthetic',LLM_RETRY_COUNT:'0'}),async(_url,options)=>{
  prompt=JSON.parse(options.body).messages[1].content;
  return Response.json({choices:[{message:{content:JSON.stringify({title:'QA',executiveSummary:'QA',keyDiscussionPoints:[],decisions:[],attendanceSummary:[],actionItems:[]})}}]});
 });
 assert.ok(prompt.includes('sesi 11111111'));
 assert.ok(prompt.includes('sesi 22222222'));
});
