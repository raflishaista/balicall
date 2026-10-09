import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { hashToken } from '../authStore.js';
process.env.DATABASE_URL = '';
const { createApp } = await import('../app.js');
const { loadConfig } = await import('../config.js');

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'balicall-guest-'));
  const hostToken = 'h'.repeat(43), host = { employeeId: 'BT-99001', name: 'Host', email: 'qa@example.test', department: 'IT', position: 'QA' };
  const config = { ...loadConfig({ AUTH_ENABLED: 'true', VERIFY_EMPLOYEE_ID: 'false', LLM_PROVIDER: 'demo' }), dataFile: join(directory, 'meetings.json') };
  const authStore = { async session(hash) { return hash === hashToken(hostToken) ? host : null; }, async revoke() {} };
  let context, server, base;
  const start = async () => { context = createApp(config, { authStore, livekitProbe: async () => true }); server = context.app.listen(0, '127.0.0.1'); await new Promise(r=>server.once('listening',r)); base = 'http://127.0.0.1:'+server.address().port; };
  const stop = async () => { context.close(); await new Promise(r=>server.close(r)); };
  await start();
  t.after(async () => { await stop(); assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('balicall-guest-')); rmSync(directory, { recursive: true, force: true }); });
  const hostSession = { cookie: 'balicall_session='+hostToken, csrfToken: hashToken('balicall-csrf:'+hostToken) };
  async function request(path, body, session, bearer, method = body === undefined ? 'GET' : 'POST', extra = {}) {
    const response = await fetch(base+'/api'+path, { method, headers: { ...(body!==undefined?{'Content-Type':'application/json'}:{}), ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}), ...(bearer?{Authorization:'Bearer '+bearer}:{}), ...extra }, body: body===undefined?undefined:JSON.stringify(body) });
    return { response, status: response.status, data: await response.json() };
  }
  const created = await request('/token', { roomName: 'Guest QC' }, hostSession); assert.equal(created.status,200);
  const { token, meetingId } = created.data;
  const invitation = await request(`/meetings/${meetingId}/guest-invite`, {}, hostSession, token); assert.equal(invitation.status,200);
  async function admit(name = 'External tester') {
    const joined = await request('/auth/guest', { name, inviteCode: invitation.data.inviteCode }); assert.equal(joined.status,200);
    return { ...joined.data, cookie: joined.response.headers.getSetCookie().find(c=>c.startsWith('balicall_guest=')).split(';')[0] };
  }
  return { request, admit, hostSession, token, meetingId, invitation, get store(){return context.store;}, async restart(){await stop();await start();} };
}

test('guest invitation is random, requires active employee meeting and validates input', async t => {
  const f = await fixture(t);
  assert.match(f.invitation.data.inviteCode,/^[\w-]{22}$/);
  assert.equal((await f.request('/auth/guest',{name:'Tester',inviteCode:'Guest QC'})).status,400);
  assert.equal((await f.request('/auth/guest',{name:'Tester',inviteCode:'a'.repeat(22)})).status,404);
  assert.equal((await f.request('/auth/guest',{name:'  ',inviteCode:f.invitation.data.inviteCode})).status,400);
  assert.equal((await f.request('/auth/guest',{name:'Tester',inviteCode:f.invitation.data.inviteCode},undefined,undefined,'POST',{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request('/auth/guest',{name:'Tester',inviteCode:f.invitation.data.inviteCode},f.hostSession)).status,409);
});

test('guest joins existing room with generated identity and cannot impersonate employees', async t => {
  const f = await fixture(t), guest = await f.admit('Partner');
  assert.equal(guest.user.isGuest,true); assert.match(guest.user.employeeId,/^GUEST-/); assert.equal(guest.user.name,'Partner (Tamu)');
  const joined = await f.request('/token',{roomName:'Guest QC',employeeId:'BT-99001',employeeName:'Forged',department:'CEO'},guest);
  assert.equal(joined.status,200); const claims = JSON.parse(Buffer.from(joined.data.token.split('.')[1],'base64url'));
  assert.equal(claims.sub,guest.user.employeeId); assert.equal(joined.data.meetingId,f.meetingId);
  assert.equal((await f.request('/token',{roomName:'New room'},guest)).status,403);
  assert.equal(f.store.meetings.size,1);
  assert.equal((await f.request(`/meetings/${f.meetingId}/transcript`,{},guest,f.token)).status,403);
  assert.equal((await f.request(`/meetings/${f.meetingId}/transcript`,{text:'Guest speech'},guest,joined.data.token)).status,200);
  const history = await f.request(`/meetings/${f.meetingId}/transcript`,undefined,guest,joined.data.token);
  assert.equal(history.status,200); assert.equal(history.data.transcripts[0].speakerId,guest.user.employeeId);
  assert.ok(!JSON.stringify(history.data).includes('guestSessionHash'));
});

test('guest cannot access company data, recording, invitations, summaries or other meetings', async t => {
  const f = await fixture(t), guest = await f.admit();
  const joined = await f.request('/token',{roomName:'Guest QC'},guest), bearer = joined.data.token;
  for (const path of ['/employees','/schedules','/meetings/db-summaries','/meetings/db-details/'+f.meetingId,'/livekit/webhooks','/meetings/other/transcript']) assert.equal((await f.request(path,undefined,guest,bearer)).status,403,path);
  for (const endpoint of ['recording/start','recording/stop','summarize','guest-invite']) assert.equal((await f.request(`/meetings/${f.meetingId}/${endpoint}`,{},guest,bearer)).status,403,endpoint);
  assert.equal((await f.request('/schedules',{},guest)).status,403);
});

test('guest session survives backend restart and enforces CSRF, expiry and logout revocation', async t => {
  const f = await fixture(t), guest = await f.admit();
  await f.restart();
  const session = await f.request('/auth/session',undefined,guest); assert.equal(session.data.user.employeeId,guest.user.employeeId);
  const noCsrf = {...guest,csrfToken:''};
  assert.equal((await f.request('/token',{roomName:'Guest QC'},noCsrf)).status,403);
  assert.equal((await f.request('/auth/logout',{},noCsrf)).status,403);
  assert.equal((await f.request('/auth/logout',{},guest)).status,200);
  assert.equal((await f.request('/auth/session',undefined,guest)).data.user,null);
  const expired = await f.admit(); f.store.transact(()=>{f.store.get(f.meetingId).participants.get(expired.user.employeeId).guestSessionExpiresAt=Date.now()-1;});
  assert.equal((await f.request('/auth/session',undefined,expired)).data.user,null);
});

test('ended or finalizing rooms reject new guest admission and token issuance', async t => {
  const f = await fixture(t), guest = await f.admit();
  f.store.transact(()=>{ f.store.get(f.meetingId).status='ended'; });
  assert.equal((await f.request('/auth/guest',{name:'Too late',inviteCode:f.invitation.data.inviteCode})).status,404);
  assert.equal((await f.request('/token',{roomName:'Guest QC'},guest)).status,403);
});

test('guest admission has a bounded attempt limit', async t => {
  const f = await fixture(t); let last;
  for(let i=0;i<31;i++)last=await f.request('/auth/guest',{name:'Tester',inviteCode:'a'.repeat(22)});
  assert.equal(last.status,429);
});
