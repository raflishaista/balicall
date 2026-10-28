import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qwenDiarizationReady} from '../qwenCapabilities.js';
test('Qwen capability requires opt-in, ready ASR and ready diarizer',async()=>{
 const config={qwenDiarizationEnabled:true,qwenSttBaseUrl:'http://qwen/v1',qwenSttKey:'qwen-key'};
 for(const data of [{ready:true,diarization:true},{ready:true,diarization:false},{ready:false,diarization:true},{}]){
  assert.equal(await qwenDiarizationReady(config,async(url,options)=>{
   assert.equal(url,'http://qwen/health');assert.equal(options.headers.Authorization,'Bearer qwen-key');
   return new Response(JSON.stringify(data));
  }),data.ready===true&&data.diarization===true);
 }
 assert.equal(await qwenDiarizationReady({...config,qwenDiarizationEnabled:false},()=>{throw Error('must not call');}),false);
 assert.equal(await qwenDiarizationReady(config,async()=>{throw Error('offline');}),false);
});
