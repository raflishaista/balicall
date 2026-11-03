import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableSttModels, loadConfig } from '../config.js';
import { transcribeAudio } from '../providers.js';
import { createApp } from '../app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qwenGgufReady } from '../qwenCapabilities.js';

const model = 'qwen3-asr-0.6b-gguf-q8';
test('GGUF readiness requires a reachable Qwen worker',async()=>{
  const config=loadConfig({QWEN_GGUF_STT_BASE_URL:'http://127.0.0.1:8012/v1'});
  assert.equal(await qwenGgufReady(config,async url=>url.endsWith('/health')?Response.json({status:'ok',backend:'qwen3'}):Response.json({data:[{id:'C:\\models\\qwen3-asr-0.6b-q8_0.gguf',backend:'qwen3'}]})),true);
  assert.equal(await qwenGgufReady(config,async url=>url.endsWith('/health')?Response.json({status:'ok',backend:'qwen3'}):Response.json({data:[{id:'other.gguf',backend:'qwen3'}]})),false);
  assert.equal(await qwenGgufReady(config,async()=>Response.json({status:'ok',backend:'whisper'})),false);
  assert.equal(await qwenGgufReady(config,async()=>{throw new Error('offline');}),false);
  assert.equal(await qwenGgufReady(loadConfig({}),async()=>{throw new Error('must not probe');}),false);
});
test('GGUF is opt-in and routes only to its own worker', async () => {
  assert.ok(!availableSttModels(loadConfig({ STT_MODEL:'small' })).includes(model));
  const config = loadConfig({ STT_MODEL:'small', STT_BASE_URL:'http://whisper/v1', QWEN_GGUF_STT_BASE_URL:'http://127.0.0.1:8012/v1' });
  assert.ok(availableSttModels(config).includes(model));
  const result = await transcribeAudio(Buffer.from('clip'),'audio/wav','id',{...config,sttModel:model,sttDiarization:false},async (url, options) => {
    assert.equal(url,'http://127.0.0.1:8012/v1/audio/transcriptions');
    assert.equal(options.body.get('language'),'id');
    return new Response(JSON.stringify({text:'Rapat dimulai.'}));
  });
  assert.equal(result.text,'Rapat dimulai.');
});
test('GGUF does not claim diarization',async()=>{
  const config=loadConfig({STT_MODEL:'small',STT_BASE_URL:'http://whisper/v1',QWEN_GGUF_STT_BASE_URL:'http://127.0.0.1:8012/v1'});
  await assert.rejects(transcribeAudio(Buffer.from('clip'),'audio/wav','id',{...config,sttModel:model,sttDiarization:true},async()=>{throw new Error('unexpected request');}),/diarization/i);
});
test('health exposes GGUF only while its exact model worker is ready',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'balicall-gguf-health-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let online=true;
  const config=loadConfig({LLM_PROVIDER:'demo',STT_MODEL:'small',STT_BASE_URL:'http://whisper/v1',QWEN_GGUF_STT_BASE_URL:'http://127.0.0.1:8012/v1',MEETING_DATA_FILE:join(dir,'meetings.json')});
  const ctx=createApp(config,{livekitProbe:async()=>[],fetchImpl:async url=>{
    if(!online) throw new Error('worker offline');
    if(String(url).endsWith('/health')) return Response.json({status:'ok',backend:'qwen3'});
    if(String(url).endsWith('/v1/models')) return Response.json({data:[{id:'qwen3-asr-0.6b-q8_0.gguf',backend:'qwen3'}]});
    throw new Error('unexpected request');
  }});
  const server=ctx.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{ctx.close();server.close();});
  const health=async()=>await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
  const first=await health();assert.equal(first.qwenGgufReady,true);assert.ok(first.sttModels.includes(model));
  online=false;const second=await health();assert.equal(second.qwenGgufReady,false);assert.ok(!second.sttModels.includes(model));
});
test('meeting audio is routed and saved under the selected GGUF model',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'balicall-gguf-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let workerCalls=0;
  const config=loadConfig({LLM_PROVIDER:'demo',STT_PROVIDER:'server',STT_MODEL:'small',STT_BASE_URL:'http://whisper/v1',STT_DIARIZATION:'true',QWEN_GGUF_STT_BASE_URL:'http://127.0.0.1:8012/v1',MEETING_DATA_FILE:join(dir,'meetings.json')});
  const ctx=createApp(config,{livekitProbe:async()=>[],fetchImpl:async(url,options)=>{
    if(String(url)==='http://127.0.0.1:8012/v1/audio/transcriptions'){workerCalls++;assert.equal(options.body.get('diarize'),null);return Response.json({text:'Rapat dimulai.'});}
    throw new Error('unexpected worker');
  }});
  const server=ctx.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{ctx.close();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const tokenResponse=await fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomName:'GGUF QC',employeeId:'host',employeeName:'Host'})});
  const session=await tokenResponse.json();assert.equal(tokenResponse.status,200);
  const audioResponse=await fetch(`${base}/meetings/${session.meetingId}/audio`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'audio/wav','X-Request-Id':'gguf-qc-1','X-Speech-Model':model},body:Buffer.from('clip')});
  const result=await audioResponse.json();assert.equal(audioResponse.status,200);assert.equal(result.text,'Rapat dimulai.');assert.equal(result.entry.sttModel,model);assert.equal(workerCalls,1);
});
