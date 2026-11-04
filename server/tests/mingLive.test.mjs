import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MING_LIVE_MODEL,mingLiveCapabilities} from '../mingLiveConfig.js';
import {loadConfig,availableSttModels} from '../config.js';

test('Ming configuration requires a dedicated paired secret and same-origin URL',()=>{
 assert.throws(()=>loadConfig({MING_LIVE_STT_URL:'/ming-live-stt/asr'}),/Ming/);
 assert.throws(()=>loadConfig({MING_LIVE_STT_URL:'https://outside/asr',MING_LIVE_STT_SECRET:'m'.repeat(40)}),/Ming/);
 assert.equal(loadConfig({}).mingLiveSttUrl,'');
 assert.ok(!availableSttModels({sttModels:['small',MING_LIVE_MODEL]}).includes(MING_LIVE_MODEL));
});
test('Ming readiness needs configured worker identity, live capability and English',async()=>{
 const config=loadConfig({MING_LIVE_STT_URL:'/ming-live-stt/asr',MING_LIVE_STT_SECRET:'m'.repeat(40)});
 const healthy={model:MING_LIVE_MODEL,ready:true,streaming:true,languages:['en']};
 assert.equal((await mingLiveCapabilities(config,async()=>Response.json(healthy))).ready,true);
 for(const patch of [{model:'qwen3-asr-0.6b-live'},{ready:false},{streaming:false},{languages:['id']}])
  assert.equal((await mingLiveCapabilities(config,async()=>Response.json({...healthy,...patch}))).ready,false);
 assert.equal((await mingLiveCapabilities(config,async()=>{throw Error('offline');})).ready,false);
 assert.equal((await mingLiveCapabilities({},async()=>{throw Error('must not fetch');})).ready,false);
});
