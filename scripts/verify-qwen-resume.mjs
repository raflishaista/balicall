// Synthetic-only real-worker check. All meetings/names are in an isolated API store.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server/app.js';
import {loadConfig} from '../server/config.js';

const [configPath,voiceA,voiceB,output]=process.argv.slice(2);
assert.ok(output,'Usage: node scripts/verify-qwen-resume.mjs CONFIG SYNTHETIC_A_16K_WAV SYNTHETIC_B_16K_WAV OUTPUT');
const secret=readFileSync(configPath,'utf8').match(/^QWEN_LIVE_STT_SECRET=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'');
assert.ok(secret);
const context=createApp({...loadConfig({LLM_PROVIDER:'demo',QWEN_LIVE_STT_SECRET:secret,QWEN_LIVE_STT_URL:'/qwen-live-stt/asr'}),
 dataFile:join(mkdtempSync(join(tmpdir(),'balicall-resume-qa-')),'meetings.json')},{livekitProbe:async()=>[]});
const server=context.app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api`;
let token,meetingId,socket;
const request=async(path,body,method='POST')=>{
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,error:data.error}));return data;
};
const route=suffix=>`/meetings/${meetingId}/${suffix}`;
const pcm=path=>{
 const wav=readFileSync(path);assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);
 for(let n=12;n+8<=wav.length;){const size=wav.readUInt32LE(n+4);if(wav.toString('ascii',n,n+4)==='data')return wav.subarray(n+8,n+8+size);n+=8+size+(size%2);}
 throw Error('No PCM data');
};
const streamId=randomUUID(),configs=[],entries=new Map(),seen=new Map();let saving=Promise.resolve(),saveError;
async function run(audio,mode){
 const ticket=await request(route('live-session'),{model:'qwen3-asr-0.6b-live',language:'en',diarize:true,streamId});
 const url=new URL(ticket.url,'http://127.0.0.1:5187');url.protocol='ws:';
 socket=new WebSocket(url);let configured,completed,failed,closed,deliberate=false;
 const ready=new Promise((resolve,reject)=>{configured=resolve;failed=reject;});
 const done=new Promise((resolve,reject)=>{completed=resolve;closed=reject;});
 ready.catch(()=>{});done.catch(()=>{});
 const timer=setTimeout(()=>{failed(Error('Configure timeout'));closed(Error('Drain timeout'));},60000);
 socket.addEventListener('error',()=>{failed(Error('Websocket failed'));closed(Error('Websocket failed'));});
 socket.addEventListener('close',()=>{if(deliberate)completed();else closed(Error('Unexpected close'));});
 socket.addEventListener('message',event=>{
  const frame=JSON.parse(event.data);
  if(frame.type==='config'){configs.push(frame);configured();}
  if(frame.type==='error')closed(Error(frame.error));
  for(const final of frame.final || []){
   saving=saving.then(async()=>{
    const saved=await request(route('transcript'),{sttModel:'qwen3-asr-0.6b-live',final});
    if(seen.has(final.segmentId))assert.equal(saved.entry.id,seen.get(final.segmentId));
    seen.set(final.segmentId,saved.entry.id);entries.set(final.segmentId,saved.entry);
   }).catch(error=>{saveError ||= error;});
  }
  if(frame.type==='ready_to_stop'){deliberate=true;completed();}
 });
 try{
  await ready;
  const started=performance.now();
  for(let offset=0;offset<audio.length;offset+=6400){socket.send(audio.subarray(offset,offset+6400));await delay(Math.max(0,started+Math.min(offset+6400,audio.length)/32-performance.now()));}
  if(mode==='drop'){deliberate=true;socket.close();await done;await delay(300);}
  else{socket.send(mode==='pause'?JSON.stringify({type:'pause'}):new Uint8Array());await done;}
  await saving;if(saveError)throw saveError;
 }finally{clearTimeout(timer);socket.close();}
}
try{
 const joined=await request('/token',{roomName:'synthetic-speaker-resume',employeeId:'synthetic-qa',employeeName:'Synthetic QA',department:'Test'});
 token=joined.token;meetingId=joined.meetingId;
 await run(pcm(voiceA),'pause');
 const first=[...entries.values()].find(entry=>entry.segments?.[0].attribution==='assigned');assert.ok(first,'No assigned speaker in synthetic A');
 const segment=first.segments[0];
 await request(route('speaker-name'),{sourceId:segment.sourceId,sessionId:segment.sessionId,speaker:segment.speaker,name:'Budi QA'});
 await run(pcm(voiceB),'drop');const beforeReturn=new Set(entries.keys());
 await run(pcm(voiceA),'finish');
 assert.deepEqual(configs.map(config=>config.resumed),[false,true,true]);
 assert.equal(new Set(configs.map(config=>config.sessionId)).size,1);
 const stored=await request(route('transcript'),undefined,'GET');
 assert.equal(stored.transcripts.length,seen.size,'Replayed finals must not duplicate stored speech');
 const returned=stored.transcripts.filter(entry=>!beforeReturn.has(entry.requestId) && entry.segments?.[0].speaker===segment.speaker);
 assert.ok(returned.length,'Returning synthetic voice was not assigned to its original speaker');
 assert.ok(returned.every(entry=>entry.segments[0].speakerName==='Budi QA'),'Manual name did not survive reconnect');
 const report={passed:true,fixture:'Synthetic A → pause → B → network drop → A',sameSpeakerSession:true,reconnects:2,
  storedFinals:stored.transcripts.length,replayDeduplicated:true,manualNameOnReturningVoice:true,returningSegments:returned.length,
  labels:[...new Set(stored.transcripts.flatMap(entry=>entry.segments?.map(segment=>segment.speaker) || []))]};
 writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await request(route('leave'),{});
}finally{socket?.close();context.close();await new Promise(resolve=>server.close(resolve));}
