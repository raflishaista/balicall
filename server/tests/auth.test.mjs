import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {attachAuth,hashPassword,verifyPassword} from '../auth.js';
import {hashToken} from '../authStore.js';
import {loadConfig} from '../config.js';

test('password hashing uses a random salt and verifies without storing plaintext', async()=>{
  const password='BaliCall pengujian aman 2026';
  const first=await hashPassword(password),second=await hashPassword(password);
  assert.notEqual(first,second);assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password,first),true);
  assert.equal(await verifyPassword('wrong',first),false);
  assert.equal(await verifyPassword(password,'scrypt$16$8$1$bad$bad'),false);
  await assert.rejects(hashPassword('short'),/15/);
});
test('login requires explicit opt-in and production cookies require HTTPS',()=>{
  assert.equal(loadConfig({DATABASE_URL:'postgresql://example'}).authEnabled,false);
  assert.equal(loadConfig({AUTH_ENABLED:'true'}).authEnabled,true);
  assert.throws(()=>loadConfig({AUTH_ENABLED:'true',AUTH_COOKIE_SECURE:'false',NODE_ENV:'production'}),/HTTPS/);
});
test('sessions, CSRF, activation replay, invalid login and logout are enforced',async t=>{
  const password='Akun pengujian aman 2026';
  let account={employee_id:'BT-99001',name:'Tester',department:'IT',position:'QA',login_email:'qa@example.test',status:'active',password_hash:await hashPassword(password)};
  const sessions=new Map(),counts=new Map();let activationUsed=false;
  const store={
    async account(){return account;},
    async session(hash){return sessions.get(hash)||null;},
    async createSession(hash){sessions.set(hash,{employeeId:account.employee_id,name:'Tester',email:account.login_email,department:'IT',position:'QA'});},
    async revoke(hash){sessions.delete(hash);},
    async consumeLimit(key,max){const count=(counts.get(key)||0)+1;counts.set(key,count);return count<=max;},
    async validInvite(email,hash){return !activationUsed&&email===account.login_email&&hash===hashToken('a'.repeat(43));},
    async activate(_email,_hash,encoded){if(activationUsed)return false;activationUsed=true;account.password_hash=encoded;sessions.clear();return true;},
  };
  const app=express();app.use(express.json());attachAuth(app,loadConfig({AUTH_ENABLED:'true'}),store);
  app.get('/api/private',(req,res)=>res.json({user:req.auth.user}));
  app.post('/api/private',(_req,res)=>res.json({success:true}));
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,body,cookie,csrf,origin)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/api/private')).status,401);
  assert.equal((await request('/api/auth/login',{email:account.login_email,password:'wrong'})).status,401);
  assert.equal((await request('/api/auth/login',{email:account.login_email,password},null,null,'https://evil.example')).status,403);
  const login=await request('/api/auth/login',{email:account.login_email,password});
  assert.equal(login.status,200);const data=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
  assert.equal(sessions.has(hashToken(cookie.split('=')[1])),true);
  assert.equal((await request('/api/private',undefined,cookie)).status,200);
  assert.equal((await request('/api/private',{},cookie)).status,403);
  assert.equal((await request('/api/private',{},cookie,'é'.repeat(64))).status,403);
  assert.equal((await request('/api/private',{},cookie,data.csrfToken)).status,200);
  assert.equal((await request('/api/auth/logout',{},cookie)).status,403);
  const logout=await request('/api/auth/logout',{},cookie,data.csrfToken);
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/api/private',undefined,cookie)).status,401);
  assert.equal((await request('/api/auth/activate',{email:account.login_email,activationCode:'a'.repeat(43),password})).status,200);
  assert.equal((await request('/api/auth/activate',{email:account.login_email,activationCode:'a'.repeat(43),password})).status,400);
  account.status='inactive';
  assert.equal((await request('/api/auth/login',{email:account.login_email,password})).status,401);
  for(let i=0;i<8;i++)await request('/api/auth/login',{email:account.login_email,password:''});
  assert.equal((await request('/api/auth/login',{email:account.login_email,password})).status,429);
});
test('unavailable session database fails closed',async t=>{
  const app=express();attachAuth(app,loadConfig({AUTH_ENABLED:'true'}),{async session(){throw new Error('unavailable');}});
  app.get('/api/private',(_req,res)=>res.json({secret:true}));
  app.use((_error,_req,res,_next)=>res.status(503).json({error:'Unavailable'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/private',{headers:{Cookie:'balicall_session='+'a'.repeat(43)}});
  assert.equal(response.status,503);
});

test('authenticated meeting identity and schedule ownership cannot be forged', async t=>{
  const {createApp}=await import('../app.js');
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join,resolve}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'balicall-auth-test-'));
  const user=id=>({employeeId:id,name:'User '+id,email:id+'@example.test',department:'IT Operations',position:'QA'});
  const tokens=new Map([[hashToken('a'.repeat(43)),user('BT-99001')],[hashToken('b'.repeat(43)),user('BT-99002')]]);
  const {app}=createApp({...loadConfig({AUTH_ENABLED:'true',LLM_PROVIDER:'demo',VERIFY_EMPLOYEE_ID:'false'}),dataFile:join(directory,'meetings.json')},{authStore:{async session(hash){return tokens.get(hash);}},livekitProbe:async()=>[]});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&directory.includes('balicall-auth-test-'));await rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,body,who='a',method='POST',bearer=null)=>{
    const token=who.repeat(43);
    return fetch(base+'/api'+path,{method,headers:{Cookie:'balicall_session='+token,'X-CSRF-Token':hashToken('balicall-csrf:'+token),...(body?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})},body:body?JSON.stringify(body):undefined});
  };
  const a=await (await request('/token',{roomName:'auth-test',employeeId:'BT-99002',employeeName:'Forged',department:'Forged'})).json();
  assert.equal(JSON.parse(Buffer.from(a.token.split('.')[1],'base64url')).sub,'BT-99001');
  const b=await (await request('/token',{roomName:'auth-test',employeeId:'BT-99001',employeeName:'Forged',department:'Forged'},'b')).json();
  assert.equal((await request('/meetings/'+a.meetingId+'/transcript',null,'a','GET',b.token)).status,403);
  const scheduleResponse=await request('/schedules',{roomName:'auth-owned',title:'Owned',hostId:'BT-99002',hostName:'Forged',department:'Forged',scheduledStart:new Date(Date.now()+3600000).toISOString(),scheduledEnd:new Date(Date.now()+7200000).toISOString()});
  assert.equal(scheduleResponse.status,201);const {schedule}=await scheduleResponse.json();assert.equal(schedule.hostId,'BT-99001');
  assert.equal((await request('/schedules/'+schedule.id,null,'b','DELETE')).status,403);
  assert.equal((await request('/schedules/'+schedule.id,null,'a','DELETE')).status,200);
});
