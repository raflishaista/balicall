self.addEventListener('push',event=>{
  let message;try{message=event.data.json();}catch{return;}
  if(!message||typeof message.id!=='string')return;
  event.waitUntil(self.registration.showNotification('BaliCall',{body:typeof message.body==='string'?message.body:'Ada pembaruan rapat.',tag:'balicall-'+message.id,icon:'/brand/balitower-logo.png',data:{url:'/?notification='+encodeURIComponent(message.id)}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/',self.location.origin);
  if(url.origin!==self.location.origin)return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
    if(client){client.postMessage({type:'balicall:open-notifications'});await client.focus();}else await self.clients.openWindow(url.href);
  }));
});
