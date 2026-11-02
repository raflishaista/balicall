import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MeetingStore} from '../meetingStore.js';
import {createMcpReview} from '../mcpReview.js';
test('former host cannot approve while MCP preconditions are being read',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'host-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new MeetingStore(join(dir,'db.json'));const m=store.join('QC',{employeeId:'host',employeeName:'Host'});store.join('QC',{employeeId:'member',employeeName:'Member'});
 store.transact(()=>{m.summary={title:'QC',actionItems:[{task:'Tugas'}]};});
 let pause=false,release,started;const begun=new Promise(r=>started=r);let writes=0;
 const client={authenticated:true,projectId:'p',taskOptions:async()=>{if(pause){started();await new Promise(r=>release=r);}return {data:{version:1}};},createTask:async()=>{writes++;return {data:{data:{id:'task'}}};}};
 const engine=createMcpReview({store,client,plan:async(_m,_s,c)=>{await c.taskOptions('p');await c.createTask({title:'Tugas'});}});
 const review=await engine.review(m.id,'host');pause=true;
 const promise=engine.decide(m.id,'host',{decision:true,revision:review.revision,planDigest:review.planDigest});
 await begun;store.transferHost(m.id,'host','member');release();
 await assert.rejects(promise,e=>e.status===403 || e.status===409);assert.equal(writes,0);
});
