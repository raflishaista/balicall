import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
process.env.DATABASE_URL='';
const {WorkspaceStore,initWorkspaceDb}=await import('../workspaceStore.js');
const {normalizePhoto,validSubscription}=await import('../workspaceApi.js');
const {createNotifications}=await import('../notifications.js');
const {createApp}=await import('../app.js');
const {loadConfig}=await import('../config.js');
const {hashToken,PgAuthStore,publicUser}=await import('../authStore.js');

async function database(t){
  const db=new PGlite();await db.exec(`CREATE TABLE balicall_employees(employee_id VARCHAR(32) PRIMARY KEY,name TEXT,email TEXT,department TEXT,position TEXT,status TEXT);
    CREATE TABLE balicall_auth_accounts(employee_id VARCHAR(32) PRIMARY KEY,login_email TEXT,password_hash TEXT);
    INSERT INTO balicall_employees VALUES('BT-99001','Official One','one@test.local','IT','Staff','active'),('BT-99002','Official Two','two@test.local','NOC','Staff','active');
    INSERT INTO balicall_auth_accounts VALUES('BT-99001','one@test.local','hash'),('BT-99002','two@test.local','hash');`);
  const pool={query(sql,params){return params?.length?db.query(sql,params):db.exec(sql).then(results=>results.at(-1));}};
  await initWorkspaceDb(pool);await initWorkspaceDb(pool);
  t.after(()=>db.close());return {db,pool,workspace:new WorkspaceStore(pool)};
}
const subscription=(suffix='one')=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,keys:{p256dh:Buffer.alloc(65,4).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}});

test('profile SQL preserves company identity, stores normalized photo and detects stale revisions',async t=>{
  const {workspace,db}=await database(t);
  const initial=await workspace.profile('BT-99001');assert.equal(initial.revision,0);
  const png=await sharp({create:{width:640,height:480,channels:3,background:'#0077ff'}}).png().toBuffer();
  const photo=await normalizePhoto('data:image/png;base64,'+png.toString('base64'));
  const metadata=await sharp(photo).metadata();assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.format,'jpeg');
  const saved=await workspace.updateProfile('BT-99001',{displayName:'Display One',revision:0,photo,deletePhoto:false});
  assert.equal(saved.name,'Display One');assert.equal(saved.legalName,'Official One');assert.ok(saved.photoVersion);
  assert.equal((await db.query('SELECT name FROM balicall_employees WHERE employee_id=$1',['BT-99001'])).rows[0].name,'Official One');
  await assert.rejects(workspace.updateProfile('BT-99001',{displayName:'Stale',revision:0,deletePhoto:false}),e=>e.status===409);
  await assert.rejects(workspace.updateProfile('BT-99002',{displayName:'Missing stale',revision:4,deletePhoto:false}),e=>e.status===409);
  assert.deepEqual(Buffer.from(await workspace.photo('BT-99001')),photo);
  const removed=await workspace.updateProfile('BT-99001',{displayName:'Display One',revision:1,deletePhoto:true});assert.equal(removed.photoVersion,null);assert.equal(await workspace.photo('BT-99001'),null);
});

test('photo validation rejects SVG, corrupt data, animated/oversized images',async()=>{
  await assert.rejects(normalizePhoto('data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')),e=>e.status===400);
  await assert.rejects(normalizePhoto('data:image/png;base64,YmFk'),e=>e.status===400);
  const large=await sharp({create:{width:2100,height:2100,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(normalizePhoto('data:image/png;base64,'+large.toString('base64')),e=>e.status===400);
});

test('PostgreSQL login and cookie session expose updated profile without changing login email',async t=>{
  const {workspace,db,pool}=await database(t);
  await db.exec('CREATE TABLE balicall_auth_sessions(token_hash CHAR(64) PRIMARY KEY,employee_id VARCHAR(32),expires_at TIMESTAMPTZ)');
  const auth=new PgAuthStore(pool),tokenHash=hashToken('isolated-session');
  await auth.createSession(tokenHash,'BT-99001',8);
  assert.equal((await auth.session(tokenHash)).name,'Official One');
  await workspace.updateProfile('BT-99001',{displayName:'New Display',revision:0,deletePhoto:false});
  assert.equal((await auth.session(tokenHash)).name,'New Display');
  const account=publicUser(await auth.account('one@test.local'));
  assert.equal(account.name,'New Display');assert.equal(account.legalName,'Official One');assert.equal(account.email,'one@test.local');
});

test('push subscriptions reject local/unknown URLs and invalid keys',()=>{
  assert.ok(validSubscription(subscription()));
  for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user:password@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])assert.equal(validSubscription({...subscription(),endpoint}),null);
  assert.equal(validSubscription({...subscription(),keys:{p256dh:'bad',auth:'bad'}}),null);
});

test('inbox deduplication, scoped read and device reassignment use persistent PostgreSQL constraints',async t=>{
  const {workspace}=await database(t);
  const event={key:'invitation:test',kind:'invitation',roomName:'QA'};
  await workspace.notify('BT-99001',event);await workspace.notify('BT-99001',event);await workspace.notify('BT-99002',event);
  let one=await workspace.list('BT-99001');assert.equal(one.length,1);
  await workspace.read('BT-99002',one[0].id);assert.equal((await workspace.list('BT-99001'))[0].readAt,null);
  await workspace.read('BT-99001',one[0].id);assert.ok((await workspace.list('BT-99001'))[0].readAt);
  await workspace.subscribe('BT-99001',subscription());await workspace.subscribe('BT-99002',subscription());
  assert.equal((await workspace.subscriptions('BT-99001')).length,0);assert.equal((await workspace.subscriptions('BT-99002')).length,1);
  await workspace.unsubscribe('BT-99001',subscription().endpoint);assert.equal((await workspace.subscriptions('BT-99002')).length,1);
});

test('notification worker emits summary/reminder once, fans out and removes expired subscriptions',async t=>{
  const {workspace}=await database(t);
  await workspace.subscribe('BT-99001',subscription('one'));await workspace.subscribe('BT-99001',subscription('two'));
  const calls=[];
  const meeting={id:randomUUID(),roomName:'Summary QA',summary:{generatedAt:new Date().toISOString()},participants:new Map([['a',{employeeId:'BT-99001',joinedAt:new Date().toISOString()}],['g',{employeeId:'GUEST-x',isGuest:true,joinedAt:new Date().toISOString()}]])};
  const schedules=[{id:'schedule',hostId:'BT-99001',roomName:'Reminder QA',scheduledStart:new Date(Date.now()+5*60000).toISOString()}];
  const worker=createNotifications({workspace,meetings:new Map([[meeting.id,meeting]]),schedules:async()=>schedules,config:{vapidPublicKey:'test',vapidPrivateKey:'test',vapidSubject:'mailto:test@example.test'},sendPush:async(sub,payload)=>{calls.push(JSON.parse(payload));if(sub.endpoint.endsWith('two'))throw Object.assign(new Error('expired'),{statusCode:410});}});
  t.after(()=>worker.close());await worker.tick();await worker.tick();
  assert.equal((await workspace.list('BT-99001')).length,2);assert.equal((await workspace.subscriptions('BT-99001')).length,1);
  assert.equal(calls.length,3);assert.ok(calls.every(item=>!item.body.includes('QA')));assert.ok(calls.every(item=>item.url.startsWith('/?notification=')));
  assert.equal((await workspace.claim()).length,0);
});

test('profile/inbox endpoints enforce employee session, CSRF and payload ownership',async t=>{
  const {workspace}=await database(t);
  const directory=mkdtempSync(join(tmpdir(),'balicall-workspace-'));
  const cookie='s'.repeat(43),user={employeeId:'BT-99001',name:'Official One',email:'one@test.local',department:'IT',position:'Staff'};
  const context=createApp({...loadConfig({AUTH_ENABLED:'true',VERIFY_EMPLOYEE_ID:'false',LLM_PROVIDER:'demo'}),dataFile:join(directory,'meetings.json')},{workspaceStore:workspace,authStore:{async session(hash){return hash===hashToken(cookie)?user:null;}},livekitProbe:async()=>true});
  const server=context.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{context.close();await new Promise(r=>server.close(r));assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&directory.includes('balicall-workspace-'));rmSync(directory,{recursive:true,force:true});});
  const request=(path,body,csrf=true)=>fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:body===undefined?'GET':'PATCH',headers:{Cookie:'balicall_session='+cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...(csrf?{'X-CSRF-Token':hashToken('balicall-csrf:'+cookie)}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/profile')).status,200);
  assert.equal((await request('/profile',{displayName:'Display One',revision:0},false)).status,403);
  assert.equal((await request('/profile',{displayName:'Display One',revision:0,employeeId:'BT-99002'})).status,400);
  assert.equal((await request('/profile',{displayName:'Display One',revision:0})).status,200);
  assert.equal((await request('/notifications')).status,200);
  assert.equal((await request('/profile/photo')).status,404);
});

test('temporary push failure retries from durable queue without duplicating inbox entries',async t=>{
  const {workspace,db}=await database(t);
  await workspace.subscribe('BT-99001',subscription());
  await workspace.notify('BT-99001',{key:'retry-test',kind:'invitation',roomName:'Private room'});
  let calls=0;
  const worker=createNotifications({workspace,meetings:new Map(),schedules:async()=>[],config:{vapidPublicKey:'test',vapidPrivateKey:'test',vapidSubject:'mailto:test@example.test'},sendPush:async()=>{if(++calls===1)throw Object.assign(new Error('temporary'),{statusCode:503});}});
  t.after(()=>worker.close());await worker.tick();
  let row=(await db.query('SELECT push_state,attempts FROM balicall_notifications')).rows[0];
  assert.equal(row.push_state,'pending');assert.equal(row.attempts,1);
  await worker.tick();assert.equal(calls,1);
  await db.exec("UPDATE balicall_notifications SET next_attempt_at=NOW()-interval '1 second'");
  await worker.tick();row=(await db.query('SELECT push_state,attempts FROM balicall_notifications')).rows[0];
  assert.equal(row.push_state,'sent');assert.equal(row.attempts,2);assert.equal((await workspace.list('BT-99001')).length,1);
});

test('inbox reminders work without VAPID; canceled pending reminders are not pushed',async t=>{
  const {workspace}=await database(t);
  const schedules=[{id:'cancel-test',hostId:'BT-99001',roomName:'Canceled room',scheduledStart:new Date(Date.now()+5*60000).toISOString()}];
  const inboxOnly=createNotifications({workspace,meetings:new Map(),schedules:async()=>schedules,config:{},sendPush:async()=>{throw new Error('Must not send unconfigured push');}});
  t.after(()=>inboxOnly.close());await inboxOnly.tick();assert.equal((await workspace.list('BT-99001')).length,1);inboxOnly.close();
  let calls=0;const enabled=createNotifications({workspace,meetings:new Map(),schedules:async()=>[],config:{vapidPublicKey:'test',vapidPrivateKey:'test',vapidSubject:'mailto:test@example.test'},sendPush:async()=>{calls++;}});
  t.after(()=>enabled.close());await workspace.subscribe('BT-99001',subscription());await enabled.tick();assert.equal(calls,0);assert.equal((await workspace.claim()).length,0);
});
