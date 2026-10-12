import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('push worker shows generic notification and focuses an existing call without navigating it',async()=>{
 const events={},shown=[],messages=[],opened=[];let focused=0;
 const self={location:{origin:'https://balicall.test'},addEventListener(name,fn){events[name]=fn;},registration:{async showNotification(title,options){shown.push({title,...options});}},clients:{async matchAll(){return[{url:'https://balicall.test/',postMessage:message=>messages.push(message),async focus(){focused++;},async navigate(){throw new Error('Must preserve active call');}}];},async openWindow(url){opened.push(url);}}};
 vm.runInNewContext(readFileSync(new URL('../public/notifications-sw.js',import.meta.url),'utf8'),{self,URL});
 let work;events.push({data:{json:()=>({id:'notice-1',body:'Notulen rapat Anda sudah tersedia.'})},waitUntil:p=>{work=p;}});await work;
 assert.equal(shown.length,1);assert.equal(shown[0].tag,'balicall-notice-1');
 events.notificationclick({notification:{close(){},data:shown[0].data},waitUntil:p=>{work=p;}});await work;
 assert.equal(focused,1);assert.equal(messages[0].type,'balicall:open-notifications');assert.equal(opened.length,0);
 events.notificationclick({notification:{close(){},data:{url:'https://evil.test/'}},waitUntil(){throw new Error('External navigation');}});
});
