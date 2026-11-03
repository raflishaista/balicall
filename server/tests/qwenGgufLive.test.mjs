import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { QWEN_GGUF_LIVE_MODEL, qwenGgufLiveCapabilities, ggufSessionDiarized } from '../qwenGgufLiveConfig.js';
import {createApp} from '../app.js';
import {loadConfig} from '../config.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const secret='q'.repeat(40), config={qwenGgufLiveUrl:'/qwen-gguf-live/asr',qwenGgufLiveSecret:secret,qwenGgufLiveHealthUrl:'http://127.0.0.1:8013/health'};
const proof=(changes={})=>{const payload=Buffer.from(JSON.stringify({model:QWEN_GGUF_LIVE_MODEL,meetingId:'meeting',speakerId:'speaker',nonce:'session',language:'id',diarize:true,exp:100,...changes})).toString('base64url');return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;};
test('Q8 live capability requires separate healthy worker and real diarization readiness',async()=>{
 const good=await qwenGgufLiveCapabilities(config,async()=>Response.json({ready:true,streaming:true,native:false,model:QWEN_GGUF_LIVE_MODEL,diarization:true}));
 assert.equal(good.ready,true);assert.equal(good.diarization,true);
 assert.equal((await qwenGgufLiveCapabilities(config,async()=>Response.json({ready:true,streaming:true,native:true,model:QWEN_GGUF_LIVE_MODEL}))).ready,false);
 assert.equal((await qwenGgufLiveCapabilities(config,async()=>{throw Error('offline')})).ready,false);
});
test('Q8 diarization proof binds model, meeting, speaker and session',()=>{
 assert.equal(ggufSessionDiarized({sessionId:'session',sessionProof:proof()},config,'meeting','speaker'),true);
 assert.equal(ggufSessionDiarized({sessionId:'session',sessionProof:proof({diarize:false})},config,'meeting','speaker'),false);
 for(const bad of [proof({model:'qwen3-asr-0.6b-live'}),proof({meetingId:'other'}),proof({speakerId:'other'}),proof({nonce:'other'}),'bad']) assert.throws(()=>ggufSessionDiarized({sessionId:'session',sessionProof:bad},config,'meeting','speaker'));
});
test('Q8 live tickets and finals are isolated and require the signed session proof',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'q8-live-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const c=loadConfig({LLM_PROVIDER:'demo',MEETING_DATA_FILE:join(dir,'meetings.json'),QWEN_GGUF_LIVE_URL:'/qwen-gguf-live/asr',QWEN_GGUF_LIVE_SECRET:secret});
 const ctx=createApp(c,{livekitProbe:async()=>[],fetchImpl:async()=>Response.json({ready:true,streaming:true,native:false,model:QWEN_GGUF_LIVE_MODEL,diarization:true})});
 const server=ctx.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{ctx.close();server.close();});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const post=async(path,body,token)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const host=await post('/token',{roomName:'QC Q8',employeeId:'speaker',employeeName:'Tester'});assert.equal(host.status,200);
 const route=`/meetings/${host.data.meetingId}`;
 const session=await post(route+'/live-session',{model:QWEN_GGUF_LIVE_MODEL,language:'id',diarize:true,streamId:'microphone-session-123'},host.data.token);
 assert.equal(session.status,200);const raw=new URL(session.data.url,'http://localhost').searchParams.get('ticket');const claims=JSON.parse(Buffer.from(raw.split('.')[0],'base64url'));
 const final={segmentId:claims.nonce+'-1',sessionId:claims.nonce,sourceId:'speaker',text:'Uji audio',start:0,end:1,speakerLabel:'Pembicara 1',attribution:'assigned',sessionProof:raw};
 assert.equal((await post(route+'/transcript',{sttModel:QWEN_GGUF_LIVE_MODEL,final:{...final,sessionProof:'bad'}},host.data.token)).status,400);
 assert.equal((await post(route+'/transcript',{sttModel:QWEN_GGUF_LIVE_MODEL,final},host.data.token)).status,200);
});
