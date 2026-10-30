import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {attachSeaLiveProxy} from '../seaLiveProxy.js';

test('production SEA route forwards the signed ticket and relays WebSocket audio and events',{timeout:7000},async t=>{
 let forwardedPath;
 const upgradedSockets=new Set();
 const worker=createServer();
 worker.on('upgrade',(request,socket)=>{
  upgradedSockets.add(socket);
  socket.once('close',()=>upgradedSockets.delete(socket));
  forwardedPath=request.url;
  const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on('data',chunk=>{
   if((chunk[0]&0x0f)===0x08) {
    socket.write(Buffer.from([0x88,0x00]));
    socket.end();
   } else socket.write(Buffer.from([0x82,0x02,0x01,0x02]));
  });
 });
 worker.listen(0,'127.0.0.1');
 await once(worker,'listening');
 const server=createServer((_request,response)=>response.end('ok'));
 const detach=attachSeaLiveProxy(server,{
  seaLivePilotEnabled:true,
  seaLiveSttUrl:'/sea-live-stt/asr',
  seaLiveSttSecret:'s'.repeat(40),
  seaLiveUpstreamUrl:`ws://127.0.0.1:${worker.address().port}/asr`,
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 let client;
 t.after(async()=>{
  client?.close();
  for(const socket of upgradedSockets)socket.destroy();
  detach();
  await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>worker.close(resolve));
 });

 client=new WebSocket(`ws://127.0.0.1:${server.address().port}/sea-live-stt/asr?ticket=payload.signature`);
 await once(client,'open');
 assert.equal(forwardedPath,'/asr?ticket=payload.signature');
 const message=once(client,'message');
 client.send(new Uint8Array([0xaa,0xbb]));
 const [event]=await message;
 assert.deepEqual(Buffer.from(await event.data.arrayBuffer()),Buffer.from([0x01,0x02]));
});

test('production SEA route rejects upgrades when pilot opt-in is off',{timeout:5000},async t=>{
 const server=createServer();
 const detach=attachSeaLiveProxy(server,{seaLivePilotEnabled:false,seaLiveSttUrl:'/sea-live-stt/asr',seaLiveSttSecret:'s'.repeat(40)});
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(async()=>{detach();await new Promise(resolve=>server.close(resolve));});
 const request=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/sea-live-stt/asr?ticket=payload.signature',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version':'13'}});
 request.end();
 const [response]=await once(request,'response');
 assert.equal(response.statusCode,503);
});
