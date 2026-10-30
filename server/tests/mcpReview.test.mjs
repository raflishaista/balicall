import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MeetingStore} from '../meetingStore.js';
import {createMcpReview} from '../mcpReview.js';
function fixture(t,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'mcp-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new MeetingStore(join(dir,'meetings.json'));
 const m=store.join('QC',{employeeId:'host',employeeName:'Host',department:'QC'});
 store.transact(()=>{store.get(m.id).status='ended';store.get(m.id).summary={title:'QC',generatedAt:'2026-10-30T01:00:00Z',actionItems:[{task:'Periksa jaringan'}]};});
 const writes=[];let option='one';
 const client={authenticated:true,projectId:'project',taskOptions:async()=>({data:{option}}),createTask:async args=>{writes.push(args);if(extra.fail)throw Error('timeout');return {data:{data:{id:'created'}}};}};
 const plan=async(meeting,summary,c,s)=>{await c.taskOptions('project');const r=await c.createTask({project:'project',title:summary.actionItems[0].task});s.transact(()=>{s.get(meeting.id).itProjectTaskDispatch={one:{status:'created',taskId:r.data.data.id}}});};
 const engine=createMcpReview({store,client,plan,destination:'mock'});
 return {store,m,writes,engine,client,plan,destination:'mock',changeOptions:()=>option='two'};
}
test('planning never writes; only host approves exact plan and repeated approval is idempotent',async t=>{
 const f=fixture(t);f.engine.register(f.store.get(f.m.id),f.store.get(f.m.id).summary);
 assert.equal(f.writes.length,0);
 const r=await f.engine.review(f.m.id,'host');assert.equal(r.operations.length,1);assert.equal(f.writes.length,0);
 await assert.rejects(f.engine.decide(f.m.id,'other',{decision:true,revision:r.revision,planDigest:r.planDigest}),e=>e.status===403);
 const result=await f.engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest});
 assert.equal(result.status,'sent');assert.equal(f.writes.length,1);
 await f.engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest});assert.equal(f.writes.length,1);
 assert.equal(f.store.get(f.m.id).itProjectTaskDispatch.one.taskId,'created');
});
test('No preserves minutes and denies all writes; unknown actors cannot read review',async t=>{
 const f=fixture(t);const r=await f.engine.review(f.m.id,'host');
 await f.engine.decide(f.m.id,'host',{decision:false,revision:r.revision,planDigest:r.planDigest});
 assert.equal((await f.engine.review(f.m.id,'host')).status,'rejected');assert.equal(f.writes.length,0);assert.ok(f.store.get(f.m.id).summary);
});
test('changed summary or remote target options invalidates previous consent',async t=>{
 const f=fixture(t);const r=await f.engine.review(f.m.id,'host');f.changeOptions();
 await assert.rejects(f.engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest}),e=>e.status===409);assert.equal(f.writes.length,0);
 const second=await f.engine.review(f.m.id,'host');f.store.transact(()=>{f.store.get(f.m.id).summary.title='Revised';});
 await assert.rejects(f.engine.decide(f.m.id,'host',{decision:true,revision:second.revision,planDigest:second.planDigest}),e=>e.status===409);
});
test('uncertain MCP outcome is durable and never automatically resent after restart',async t=>{
 const f=fixture(t,{fail:true});const r=await f.engine.review(f.m.id,'host');
 const result=await f.engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest});assert.equal(result.status,'needs_check');
 const restored=new MeetingStore(f.store.filename);const engine=createMcpReview({...f,store:restored});
 await assert.rejects(engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest}),e=>e.status===409);assert.equal(f.writes.length,1);
});

test('concurrent duplicate approvals cannot send twice',async t=>{
 const f=fixture(t);const r=await f.engine.review(f.m.id,'host');let release;
 f.client.createTask=async args=>{f.writes.push(args);await new Promise(resolve=>release=resolve);return {data:{data:{id:'created'}}};};
 const body={decision:true,revision:r.revision,planDigest:r.planDigest};
 const first=f.engine.decide(f.m.id,'host',body);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.engine.decide(f.m.id,'host',body),e=>e.status===409);release();await first;assert.equal(f.writes.length,1);
});

test('new project and dependent tasks require two separate explicit approvals',async t=>{
 const f=fixture(t);let projectId;
 f.client.createProject=async()=>{f.writes.push('project');return {data:{data:{id:'p-new'}}};};
 const plan=async(m,s,c,shadow)=>{
  const existing=shadow.get(m.id).itProjectProjectDispatch?.one?.projectId;
  if(!existing){const result=await c.createProject({title:'Proyek QC'});projectId=result.data.data.id;shadow.get(m.id).itProjectProjectDispatch={one:{projectId}};}
  else projectId=existing;
  await c.taskOptions(projectId);await c.createTask({project:projectId,title:'Periksa jaringan'});
 };
 const engine=createMcpReview({...f,plan});
 const r=await engine.review(f.m.id,'host');assert.equal(r.operations.length,1);assert.equal(r.operations[0].method,'createProject');assert.equal(f.writes.length,0);
 const result=await engine.decide(f.m.id,'host',{decision:true,revision:r.revision,planDigest:r.planDigest});assert.equal(result.status,'pending');assert.deepEqual(f.writes,['project']);
 const next=await engine.review(f.m.id,'host');assert.equal(next.operations[0].method,'createTask');assert.notEqual(next.planDigest,r.planDigest);assert.equal(f.writes.length,1);
 await engine.decide(f.m.id,'host',{decision:true,revision:next.revision,planDigest:next.planDigest});assert.equal(f.writes.length,2);
});
