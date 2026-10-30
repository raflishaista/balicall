import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SEA_LIVE_MODEL,seaLiveCapabilities} from '../seaLiveConfig.js';
import {loadConfig,availableSttModels} from '../config.js';

test('SEA is opt-in with a dedicated same-origin URL and secret',()=>{
 assert.throws(()=>loadConfig({SEA_LIVE_STT_URL:'/sea-live-stt/asr'}),/SEA/);
 assert.throws(()=>loadConfig({SEA_LIVE_STT_URL:'https://outside/asr',SEA_LIVE_STT_SECRET:'s'.repeat(40)}),/SEA/);
 assert.throws(()=>loadConfig({STT_MODEL:SEA_LIVE_MODEL}),/SEA/);
 assert.ok(!availableSttModels({sttModels:['small',SEA_LIVE_MODEL]}).includes(SEA_LIVE_MODEL));
 assert.equal(loadConfig({}).seaLivePilotEnabled,false);
 assert.equal(loadConfig({SEA_LIVE_PILOT_ENABLED:'true'}).seaLivePilotEnabled,true);
 assert.throws(()=>loadConfig({SEA_LIVE_UPSTREAM_URL:'https://outside/asr'}),/SEA upstream/);
});

test('SEA requires Indonesian live capability and matching model identity',async()=>{
 const config=loadConfig({SEA_LIVE_STT_URL:'/sea-live-stt/asr',SEA_LIVE_STT_SECRET:'s'.repeat(40)});
 const healthy={model:SEA_LIVE_MODEL,ready:true,streaming:true,languages:['id']};
 assert.equal((await seaLiveCapabilities(config,async()=>Response.json(healthy))).ready,true);
 for(const patch of [{model:'small'},{ready:false},{streaming:false},{languages:['en']}])
  assert.equal((await seaLiveCapabilities(config,async()=>Response.json({...healthy,...patch}))).ready,false);
 assert.equal((await seaLiveCapabilities(config,async()=>{throw Error('offline');})).ready,false);
});
import {createHmac} from 'node:crypto';
import {seaSessionDiarized} from '../seaLiveConfig.js';

test('SEA mode proof binds owner, meeting, nonce and model without expiring long sessions',()=>{
 const config={seaLiveSttSecret:'s'.repeat(40)};
 const base={meetingId:'meeting',speakerId:'owner',nonce:'original',model:SEA_LIVE_MODEL,language:'id',diarize:true,exp:100};
 const sign=claims=>{const p=Buffer.from(JSON.stringify(claims)).toString('base64url');return p+'.'+createHmac('sha256',config.seaLiveSttSecret).update(p).digest('base64url');};
 const check=proof=>seaSessionDiarized({sessionId:'original',sessionProof:proof},config,'meeting','owner');
 assert.equal(check(undefined),false);
 assert.equal(check(sign(base)),true);
 assert.equal(check(sign({...base,diarize:false})),false);
 for(const patch of [{meetingId:'other'},{speakerId:'other'},{nonce:'new'},{model:'small'},{diarize:'true'},{language:'en'},{exp:null}]) assert.throws(()=>check(sign({...base,...patch})));
 assert.throws(()=>check(sign(base)+'tampered'));
});

test('SEA diarization readiness requires a ready worker advertising the capability',async()=>{
 const config={seaLiveSttUrl:'/sea-live-stt/asr',seaLiveSttSecret:'s'.repeat(40)};
 const health={model:SEA_LIVE_MODEL,ready:true,streaming:true,languages:['id'],diarization:true};
 assert.equal((await seaLiveCapabilities(config,async()=>Response.json(health))).diarization,true);
 assert.equal((await seaLiveCapabilities(config,async()=>Response.json({...health,ready:false}))).diarization,false);
});
