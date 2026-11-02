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

test('host leaving or disconnecting automatically transfers host role to the earliest joining participant',t=>{
 const dir=mkdtempSync(join(tmpdir(),'balicall-host-auto-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json'),store=new MeetingStore(path);
 const m=store.join('QC',{employeeId:'host',employeeName:'Host'});
 store.join('QC',{employeeId:'first-joiner',employeeName:'First'});
 store.join('QC',{employeeId:'second-joiner',employeeName:'Second'});
 store.transact(()=>{
  m.participants.get('host').joinedAt='2026-11-02T10:00:00.000Z';
  m.participants.get('first-joiner').joinedAt='2026-11-02T10:01:00.000Z';
  m.participants.get('second-joiner').joinedAt='2026-11-02T10:05:00.000Z';
 });
 store.leave(m.id,'host');
 assert.equal(m.hostId,'first-joiner');
 assert.equal(m.participants.get('first-joiner').role,'host');
 assert.equal(m.participants.get('host').role,'participant');

 store.applyLivekitEvent({
  id:'evt-1',
  event:'participant_left',
  createdAt:Math.floor(Date.now()/1000),
  room:{name:m.livekitRoom,sid:'room-sid-1'},
  participant:{identity:'first-joiner',sid:'p-sid-1'},
 },10000);
 assert.equal(m.hostId,'second-joiner');
 assert.equal(m.participants.get('second-joiner').role,'host');
});

test('host leaving promotes co-host to host before regular participants',t=>{
 const dir=mkdtempSync(join(tmpdir(),'balicall-cohost-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json'),store=new MeetingStore(path);
 const m=store.join('QC',{employeeId:'host',employeeName:'Host'});
 store.join('QC',{employeeId:'early-participant',employeeName:'Early'});
 store.join('QC',{employeeId:'cohost-1',employeeName:'CoHost 1'});
 store.join('QC',{employeeId:'cohost-2',employeeName:'CoHost 2'});
 store.setCoHost(m.id,'host','cohost-1',true);
 store.setCoHost(m.id,'host','cohost-2',true);
 store.transact(()=>{
  m.participants.get('host').joinedAt='2026-11-02T10:00:00.000Z';
  m.participants.get('early-participant').joinedAt='2026-11-02T10:01:00.000Z';
  m.participants.get('cohost-1').joinedAt='2026-11-02T10:03:00.000Z';
  m.participants.get('cohost-2').joinedAt='2026-11-02T10:05:00.000Z';
 });
 // When host leaves, cohost-1 (earliest co-host) becomes host over early-participant
 store.leave(m.id,'host');
 assert.equal(m.hostId,'cohost-1');
 assert.equal(m.participants.get('cohost-1').role,'host');
 assert.equal(m.coHostIds.includes('cohost-1'),false);
 assert.equal(m.coHostIds.includes('cohost-2'),true);

 // When cohost-1 disconnects, cohost-2 becomes host
 store.applyLivekitEvent({
  id:'evt-cohost-left',
  event:'participant_left',
  createdAt:Math.floor(Date.now()/1000),
  room:{name:m.livekitRoom,sid:'room-sid-2'},
  participant:{identity:'cohost-1',sid:'p-sid-cohost-1'},
 },10000);
 assert.equal(m.hostId,'cohost-2');
 assert.equal(m.participants.get('cohost-2').role,'host');
 assert.equal(m.coHostIds.includes('cohost-2'),false);

 // When cohost-2 leaves and no co-hosts remain, early-participant becomes host
 store.leave(m.id,'cohost-2');
 assert.equal(m.hostId,'early-participant');
 assert.equal(m.participants.get('early-participant').role,'host');
});

test('when host explicitly ends meeting to summarize, host identity is preserved and meeting ends',t=>{
 const dir=mkdtempSync(join(tmpdir(),'balicall-end-meeting-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json'),store=new MeetingStore(path);
 const m=store.join('QC',{employeeId:'host',employeeName:'Host'});
 store.join('QC',{employeeId:'member',employeeName:'Member'});
 store.leave(m.id,'host',true);
 assert.equal(m.status,'ended');
 assert.equal(m.hostId,'host');
 assert.equal(store.get('meeting-'+m.id).hostId,'host');
});
