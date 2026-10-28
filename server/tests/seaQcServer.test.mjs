import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('SEA QC API never opens the inherited database and stores only isolated meeting data',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sea-qc-isolation-'));
 const secretFile=join(directory,'worker.env');
 writeFileSync(secretFile,'SEA_LIVE_STT_SECRET='+ 's'.repeat(40));
 const guardFile=join(directory,'forbid-database.mjs');
 writeFileSync(guardFile,`import pg from ${JSON.stringify(import.meta.resolve('pg'))};
 pg.Pool=class { constructor(){throw Error('QC must not initialize an inherited database pool');} };`);
 let connections=0;
 const canary=createServer(socket=>{connections++;socket.destroy();});
 await new Promise(resolve=>canary.listen(0,'127.0.0.1',resolve));
 let livekitProbes=0;
 const unavailableLivekit=createHttpServer((_request,response)=>{
  livekitProbes++;response.writeHead(401);response.end('Unavailable test SFU');
 });
 await new Promise(resolve=>unavailableLivekit.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['--import',pathToFileURL(guardFile).href,'scripts/serve-sea-qc.mjs'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),
  env:{...process.env,DATABASE_URL:`postgresql://synthetic:synthetic@127.0.0.1:${canary.address().port}/canary`,
   SEA_QC_SECRET_FILE:secretFile,SEA_QC_PORT:'0',AUTH_ENABLED:'false',VERIFY_EMPLOYEE_ID:'false',
   LIVEKIT_URL:`ws://127.0.0.1:${unavailableLivekit.address().port}`,
   LIVEKIT_INTERNAL_URL:`ws://127.0.0.1:${unavailableLivekit.address().port}`,
   LIVEKIT_API_KEY:'qc-fixture-key',LIVEKIT_API_SECRET:'k'.repeat(40),
   SEA_QC_HEALTH_URL:`http://127.0.0.1:${unavailableLivekit.address().port}/health`},
  stdio:['ignore','pipe','pipe'],
 });
 t.after(async()=>{
  if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
  await new Promise(resolve=>canary.close(resolve));
  await new Promise(resolve=>unavailableLivekit.close(resolve));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&directory.includes('sea-qc-isolation-'));
  rmSync(directory,{recursive:true,force:true});
 });
 let output='',errors='';child.stderr.on('data',data=>{errors+=data;});
 const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('QC API did not become ready')),15000);
  child.stdout.on('data',data=>{output+=data;const match=output.match(/SEA QC API ready on (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('QC API exited '+code+': '+errors));});
 });
 const base=`http://127.0.0.1:${port}/api`;
 const health=await (await fetch(base+'/health')).json();
 assert.equal(health.livekitStatus,'unavailable','QC must not report a rejected SFU as reachable');
 assert.ok(livekitProbes>=2,'Health must probe LiveKit as well as the SEA health endpoint');
 const joined=await fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:'qc-owner',employeeName:'QC Owner',roomName:'qc-isolation',department:'QC'})});
 assert.equal(joined.status,200);
 const session=await joined.json();
 const saved=await fetch(`${base}/meetings/${session.meetingId}/transcript`,{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},
  body:JSON.stringify({sttModel:'sea-asr-id-live',final:{segmentId:'qc-session-1',sessionId:'qc-session',sourceId:'qc-owner',text:'Tes isolasi.',speakerLabel:'Peserta',attribution:'unknown',start:0,end:1}})});
 assert.equal(saved.status,200);
 assert.equal((await saved.json()).entry.speakerName,'QC Owner');
 assert.equal(connections,0,'QC must not contact the inherited DATABASE_URL');
});
