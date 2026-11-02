import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MeetingStore} from '../meetingStore.js';
test('only active host can transfer to an active non-guest and persisted roles follow',t=>{
 const dir=mkdtempSync(join(tmpdir(),'balicall-host-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json'),store=new MeetingStore(path);
 const m=store.join('QC',{employeeId:'host',employeeName:'Host'});
 store.join('QC',{employeeId:'member',employeeName:'Member'});
 store.join('QC',{employeeId:'GUEST-test',employeeName:'Guest'});
 assert.throws(()=>store.transferHost(m.id,'member','host'),e=>e.status===403);
 assert.throws(()=>store.transferHost(m.id,'host','GUEST-test'),e=>e.status===403);
 assert.throws(()=>store.transferHost(m.id,'host','missing'),e=>e.status===404);
 store.transferHost(m.id,'host','member');
 const saved=new MeetingStore(path).get(m.id);
 assert.equal(saved.hostId,'member');assert.equal(saved.participants.get('host').role,'participant');assert.equal(saved.participants.get('member').role,'host');
 assert.throws(()=>store.transferHost(m.id,'host','member'),e=>e.status===403);
});

test('HTTP transfer requires host and revokes old host management rights',async t=>{
 const {createApp}=await import('../app.js');const {loadConfig}=await import('../config.js');
 const dir=mkdtempSync(join(tmpdir(),'balicall-host-api-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const ctx=createApp(loadConfig({LLM_PROVIDER:'demo',MEETING_DATA_FILE:join(dir,'meetings.json')}),{livekitProbe:async()=>[]});
 const server=ctx.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{ctx.close();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api';
 const call=async(path,method,token,body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const h=(await call('/token','POST',null,{roomName:'Host QC',employeeId:'host',employeeName:'Host'})).data;
 const p=(await call('/token','POST',null,{roomName:'Host QC',employeeId:'member',employeeName:'Member'})).data;
 const path='/meetings/'+h.meetingId+'/participants/';
 assert.equal((await call(path+'host/role','PATCH',p.token,{role:'host'})).status,403);
 assert.equal((await call(path+'member/role','PATCH',h.token,{role:'host'})).status,200);
 assert.equal(ctx.store.get(h.meetingId).hostId,'member');
 assert.equal((await call(path+'member/role','PATCH',h.token,{role:'co-host'})).status,403);
 assert.equal((await call(path+'host/role','PATCH',p.token,{role:'co-host'})).status,200);
});
