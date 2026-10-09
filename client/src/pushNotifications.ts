import { apiRequest } from './api';
export const pushSupported=()=>typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
function applicationKey(key:string){return Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));}
export async function enablePush(publicKey:string){
  if(!pushSupported())throw new Error('Web Push memerlukan HTTPS dan browser yang mendukung.');
  if(!publicKey)throw new Error('Web Push belum dikonfigurasi admin. Inbox tetap tersedia.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Izin notifikasi belum diberikan. Ubah izin situs di browser jika ingin mengaktifkan.');
  const registration=await navigator.serviceWorker.register('/notifications-sw.js',{scope:'/'});
  await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(publicKey)});
  await apiRequest('/notifications/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription.toJSON())});
}
export async function disablePush(){
  if(!pushSupported())return;
  const registration=await navigator.serviceWorker.getRegistration('/notifications-sw.js');
  const subscription=await registration?.pushManager.getSubscription();if(!subscription)return;
  await apiRequest('/notifications/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});
  await subscription.unsubscribe();
}
