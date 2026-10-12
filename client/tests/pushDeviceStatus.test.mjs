import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/pushNotifications.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function load({secure=true,permission='granted',subscription=null}={}){
 const exports={};let registered=0;
 const window={isSecureContext:secure,PushManager:{},Notification:{}};
 const navigator={serviceWorker:{async getRegistration(){return {pushManager:{async getSubscription(){return subscription;}}};},register(){registered++;}}};
 new Function('exports','require','window','navigator','Notification',compiled)(exports,()=>({apiRequest:async()=>({})}),window,navigator,{permission});
 return {...exports,registered:()=>registered};
}
test('device status reads existing subscription without registering or prompting permission',async()=>{
 const api=load({subscription:{endpoint:'https://push.test'}});
 assert.equal(await api.getPushDeviceStatus(),'active');assert.equal(api.registered(),0);
 assert.equal(await load().getPushDeviceStatus(),'inactive');
});
test('denied and unsupported status are distinguishable from inactive',async()=>{
 assert.equal(await load({permission:'denied'}).getPushDeviceStatus(),'denied');
 assert.equal(await load({secure:false}).getPushDeviceStatus(),'unsupported');
 assert.equal(await load({permission:'default'}).getPushDeviceStatus(),'inactive');
});
