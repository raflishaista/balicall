import http from 'node:http';
import https from 'node:https';

const ROUTE='/sea-live-stt/asr';

function reject(socket,status,reason,message) {
  if(socket.destroyed)return;
  const body=Buffer.from(message);
  socket.end(Buffer.concat([
    Buffer.from(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`),
    body,
  ]));
}

export function attachSeaLiveProxy(server,config) {
  const onUpgrade=(request,clientSocket,clientHead)=>{
    let incoming;
    try { incoming=new URL(request.url || '/', 'http://localhost'); }
    catch { return reject(clientSocket,400,'Bad Request','Invalid WebSocket path'); }
    if(incoming.pathname!==ROUTE)return;
    if(!config.seaLivePilotEnabled || !config.seaLiveSttSecret || config.seaLiveSttUrl!==ROUTE) {
      return reject(clientSocket,503,'Service Unavailable','SEA Live pilot is not enabled');
    }
    if(!incoming.searchParams.get('ticket'))return reject(clientSocket,401,'Unauthorized','SEA Live ticket is required');

    const target=new URL(config.seaLiveUpstreamUrl);
    const secure=target.protocol==='wss:';
    const transport=secure?https:http;
    const upstreamPath=`${target.pathname}${incoming.search}`;
    const proxyRequest=transport.request({
      protocol:secure?'https:':'http:',
      hostname:target.hostname,
      port:target.port || (secure?443:80),
      path:upstreamPath,
      method:'GET',
      headers:{...request.headers,host:target.host,connection:'Upgrade',upgrade:'websocket'},
    });
    let upstreamSocket;
    const closeUpstream=()=>upstreamSocket?.destroy();
    clientSocket.once('close',closeUpstream);
    clientSocket.once('error',closeUpstream);
    proxyRequest.once('upgrade',(response,socket,head)=>{
      upstreamSocket=socket;
      if(clientSocket.destroyed)return closeUpstream();
      const lines=[`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage || 'Switching Protocols'}`];
      for(let i=0;i<response.rawHeaders.length;i+=2)lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i+1]}`);
      clientSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if(head.length)clientSocket.write(head);
      if(clientHead.length)socket.write(clientHead);
      socket.once('error',()=>clientSocket.destroy());
      clientSocket.pipe(socket).pipe(clientSocket);
    });
    proxyRequest.once('response',response=>{
      if(clientSocket.destroyed)return;
      const lines=[`HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'Bad Gateway'}`];
      for(let i=0;i<response.rawHeaders.length;i+=2) {
        const name=response.rawHeaders[i];
        if(!['connection','transfer-encoding','keep-alive'].includes(name.toLowerCase()))lines.push(`${name}: ${response.rawHeaders[i+1]}`);
      }
      lines.push('Connection: close');
      clientSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      response.once('error',()=>clientSocket.destroy());
      response.pipe(clientSocket);
    });
    proxyRequest.once('error',()=>reject(clientSocket,502,'Bad Gateway','SEA Live worker is unavailable'));
    proxyRequest.setTimeout(5000,()=>proxyRequest.destroy(new Error('SEA Live worker connection timed out')));
    proxyRequest.end();
  };
  server.on('upgrade',onUpgrade);
  return ()=>server.off('upgrade',onUpgrade);
}
