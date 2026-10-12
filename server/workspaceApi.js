import express from 'express';
import sharp from 'sharp';

let photoJobs = 0;
export async function normalizePhoto(value) {
  if (typeof value !== 'string' || value.length > 1500000 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw Object.assign(new Error('Gunakan foto JPG/PNG yang valid (maksimal 1 MB setelah diproses).'),{status:400});
  if (photoJobs >= 2) throw Object.assign(new Error('Pemrosesan foto sibuk. Coba lagi.'),{status:503});
  photoJobs++;
  try {
    const bytes=Buffer.from(value.split(',')[1],'base64');
    const image=sharp(bytes,{limitInputPixels:4000000,animated:false});
    const info=await image.metadata();
    if (!['jpeg','png'].includes(info.format) || (info.pages||1)>1) throw new Error('Invalid image');
    return await image.rotate().resize(256,256,{fit:'cover'}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
  } catch { throw Object.assign(new Error('Foto tidak dapat dibaca. Gunakan JPG/PNG maksimal 4 megapiksel.'),{status:400}); }
  finally { photoJobs--; }
}
export function validSubscription(value) {
  try {
    const url=new URL(value?.endpoint);
    const host=url.hostname;
    const trusted=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.notify.windows.com');
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!trusted||value.endpoint.length>2048) return null;
    const key=value.keys?.p256dh,auth=value.keys?.auth;
    if(typeof key!=='string'||typeof auth!=='string'||!/^[\w-]{87}=?$/.test(key)||!/^[\w-]{22}={0,2}$/.test(auth))return null;
    if(Buffer.from(key,'base64url').length!==65||Buffer.from(auth,'base64url').length!==16)return null;
    return {endpoint:value.endpoint,keys:{p256dh:key,auth}};
  }catch{return null;}
}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export function attachWorkspaceApi(app,config,workspace) {
  const router=express.Router();
  router.use(['/profile','/notifications'],(req,res,next)=>{
    if(!req.auth?.user||req.auth.user.isGuest)return res.status(403).json({error:'Fitur ini memerlukan akun karyawan.'});
    res.set('Cache-Control','private, no-store');next();
  });
  router.get('/profile',wrap(async(req,res)=>res.json({user:await workspace.profile(req.auth.user.employeeId)})));
  router.patch('/profile',wrap(async(req,res)=>{
    const body=req.body||{};
    if(Object.keys(body).some(key=>!['displayName','photo','deletePhoto','revision'].includes(key))||typeof body.displayName!=='string'||!body.displayName.trim()||body.displayName.length>80||/[\x00-\x1f\x7f]/.test(body.displayName)||!Number.isInteger(body.revision)||body.revision<0||body.deletePhoto!==undefined&&typeof body.deletePhoto!=='boolean'||body.photo&&body.deletePhoto)return res.status(400).json({error:'Nama tampilan, foto, atau versi profil tidak valid.'});
    const photo=body.photo!==undefined?await normalizePhoto(body.photo):undefined;
    const user=await workspace.updateProfile(req.auth.user.employeeId,{displayName:body.displayName.trim(),revision:body.revision,photo,deletePhoto:body.deletePhoto===true});
    res.json({user});
  }));
  router.get('/profile/photo',wrap(async(req,res)=>{
    const photo=await workspace.photo(req.auth.user.employeeId);
    if(!photo)return res.sendStatus(404);
    res.set('Content-Type','image/jpeg').set('X-Content-Type-Options','nosniff').send(Buffer.from(photo));
  }));
  router.get('/notifications',wrap(async(req,res)=>res.json({notifications:await workspace.list(req.auth.user.employeeId)})));
  router.post('/notifications/:id/read',wrap(async(req,res)=>{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))return res.status(400).json({error:'ID notifikasi tidak valid.'});
    await workspace.read(req.auth.user.employeeId,req.params.id);res.json({success:true});
  }));
  router.get('/notifications/push-config',(_req,res)=>res.json({configured:Boolean(config.vapidPublicKey&&config.vapidPrivateKey&&config.vapidSubject),publicKey:config.vapidPublicKey||null}));
  router.post('/notifications/subscribe',wrap(async(req,res)=>{
    if(!config.vapidPublicKey||!config.vapidPrivateKey||!config.vapidSubject)return res.status(503).json({error:'Web Push belum dikonfigurasi admin.'});
    const subscription=validSubscription(req.body);
    if(!subscription)return res.status(400).json({error:'Subscription push tidak valid atau layanan browser belum didukung.'});
    await workspace.subscribe(req.auth.user.employeeId,subscription);res.json({success:true});
  }));
  router.post('/notifications/unsubscribe',wrap(async(req,res)=>{
    if(typeof req.body?.endpoint!=='string'||req.body.endpoint.length>2048)return res.sendStatus(400);
    await workspace.unsubscribe(req.auth.user.employeeId,req.body.endpoint);res.json({success:true});
  }));
  app.use('/api',router);
}
