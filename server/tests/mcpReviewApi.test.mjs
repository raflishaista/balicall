import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.js';
import {loadConfig} from '../config.js';

test('minutes, cached retry and review load never write MCP; host decision is required',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'mcp-review-api-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const calls=[];
 const client={authenticated:true,projectId:'p',taskTypeId:'bNiTmH27qshwj46Fc8fi',taskStatusName:'To Do',
 taskOptions:async()=>({data:{data:{taskStatuses:[{id:'UJeeXo83zdG0pYJFV7r6',name:'To Do'}],taskPriorities:[{id:'1moX49HDcroSUIwOANWL',name:'Medium'}],taskTypes:[{id:'bNiTmH27qshwj46Fc8fi',name:'Task'}],assignableUsers:[],sprints:[]}}}),
 createTask:async args=>{calls.push(args);return {data:{data:{id:'created-task'}}};}};
 const ctx=createApp(loadConfig({LLM_PROVIDER:'demo',MEETING_DATA_FILE:join(folder,'meetings.json')}),{livekitProbe:async()=>[],mcpClient:client});
 const server=ctx.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{ctx.close();server.close();});
 const base='http://127.0.0.1:'+server.address().port+'/api';
 const request=async(path,token,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 const host=(await request('/token',null,{roomName:'Review QC',employeeId:'host',employeeName:'Host'})).data;
 const other=(await request('/token',null,{roomName:'Review QC',employeeId:'other',employeeName:'Other'})).data;
 assert.equal((await request('/mcp-reviews/'+host.meetingId)).status,401);
 const meeting=ctx.store.get(host.meetingId);
 ctx.store.transact(()=>{meeting.status='ended';meeting.summary={title:'QC',executiveSummary:'QC',decisions:[],actionItems:[{task:'Periksa jaringan',assignee:'Host',deadline:'',priority:'Medium',type:'Task'}],taskUpdates:[],taskEdits:[],projectCreations:[],projectUpdates:[],attendanceSummary:[],keyDiscussionPoints:[]};});
 const read=await request('/mcp-reviews/'+host.meetingId,host.token);assert.equal(read.status,200);assert.equal(calls.length,0);assert.equal(read.data.status,'ready');assert.equal(read.data.operations.length,1);
 assert.equal((await request('/mcp-reviews/'+host.meetingId,other.token)).data.canDecide,false);
 assert.equal((await request('/mcp-reviews/'+host.meetingId+'/decision',other.token,{decision:true,revision:read.data.revision,planDigest:read.data.planDigest})).status,403);
 const no=await request('/mcp-reviews/'+host.meetingId+'/decision',host.token,{decision:false,revision:read.data.revision,planDigest:read.data.planDigest});assert.equal(no.data.status,'rejected');assert.equal(calls.length,0);
 const yes=await request('/mcp-reviews/'+host.meetingId+'/decision',host.token,{decision:true,revision:read.data.revision,planDigest:read.data.planDigest});assert.equal(yes.data.status,'sent');assert.equal(calls.length,1);
 await request('/mcp-reviews/'+host.meetingId+'/decision',host.token,{decision:true,revision:read.data.revision,planDigest:read.data.planDigest});assert.equal(calls.length,1);
 // A different summary revision is never covered by the previous decision.
 ctx.store.transact(()=>{meeting.summary.title='Revisi';});
 assert.equal((await request('/mcp-reviews/'+host.meetingId+'/decision',host.token,{decision:true,revision:read.data.revision,planDigest:read.data.planDigest})).status,409);
 // Teammate's dynamic project lookup must also remain a read-only preview.
 client.projectId='';let projectReads=0;client.userProjects=async()=>{projectReads++;return {data:{data:[{id:'p-dynamic',title:'Proyek QC'}]}};};
 ctx.store.transact(()=>{meeting.summary.actionItems=[{task:'Periksa server',project:'Proyek QC',assignee:'Host',deadline:'',priority:'Medium',type:'Task'}];});
 const dynamic=await request('/mcp-reviews/'+host.meetingId,host.token);assert.equal(dynamic.data.status,'ready');assert.equal(projectReads,1);assert.equal(calls.length,1);assert.equal(dynamic.data.operations[0].args.project,'p-dynamic');
 const approved=await request('/mcp-reviews/'+host.meetingId+'/decision',host.token,{decision:true,revision:dynamic.data.revision,planDigest:dynamic.data.planDigest});assert.equal(approved.data.status,'sent');assert.equal(calls.length,2);assert.equal(projectReads,2);

});

test('account host review works without meeting JWT and POST enforces CSRF',async t=>{
 const {hashToken}=await import('../authStore.js');
 const folder=mkdtempSync(join(tmpdir(),'mcp-auth-api-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const authStore={session:async key=>key===hashToken('h'.repeat(43))?{employeeId:'host',name:'Host'}:key===hashToken('o'.repeat(43))?{employeeId:'other',name:'Other'}:null};
 const ctx=createApp(loadConfig({AUTH_ENABLED:'true',LLM_PROVIDER:'demo',MEETING_DATA_FILE:join(folder,'meetings.json')}),{authStore,livekitProbe:async()=>[],mcpClient:{authenticated:true}});
 const m=ctx.store.join('Archived QC',{employeeId:'host',employeeName:'Host'});ctx.store.join('Archived QC',{employeeId:'other',employeeName:'Other'});
 ctx.store.transact(()=>{m.status='ended';m.summary={title:'QC',actionItems:[]};});
 const server=ctx.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{ctx.close();server.close();});
 const url='http://127.0.0.1:'+server.address().port+'/api/mcp-reviews/'+m.id;
 const request=async(session,body,csrf)=>{const response=await fetch(url+(body?'/decision':''),{method:body?'POST':'GET',headers:{Cookie:'balicall_session='+session,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':hashToken('balicall-csrf:'+session)}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 assert.equal((await request('unknown')).status,401);
 const read=await request('h'.repeat(43));assert.equal(read.status,200);assert.equal(read.data.status,'ready');
 const body={decision:false,revision:read.data.revision,planDigest:read.data.planDigest};
 assert.equal((await request('h'.repeat(43),body)).status,403);
 assert.equal((await request('o'.repeat(43),body,true)).status,403);
 assert.equal((await request('h'.repeat(43),body,true)).data.status,'rejected');
});
