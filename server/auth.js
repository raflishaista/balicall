import { Router } from 'express';
import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { hashToken, publicUser, PgAuthStore } from './authStore.js';

const derive = promisify(scrypt);
const KDF = { N: 131072, r: 8, p: 1, maxmem: 192*1024*1024 };
const COOKIE='balicall_session';
const invalidLogin='Email atau kata sandi tidak sesuai.';
const invalidActivation='Kode aktivasi tidak valid atau sudah kedaluwarsa.';
let passwordJobs=0;
async function passwordWork(fn) {
  if(passwordJobs>=2) throw Object.assign(new Error('Layanan login sedang sibuk. Coba lagi sebentar.'),{status:503});
  passwordJobs++;
  try{return await fn();}finally{passwordJobs--;}
}
export function validatePassword(password) {
  if(typeof password!=='string' || [...password].length<15 || [...password].length>128) throw Object.assign(new Error('Kata sandi harus terdiri dari 15–128 karakter.'),{status:400});
}
export async function hashPassword(password) {
  validatePassword(password);
  return passwordWork(async()=>{
    const salt=randomBytes(16).toString('hex'), hash=await derive(password,salt,64,KDF);
    return 'scrypt$131072$8$1$'+salt+'$'+hash.toString('hex');
  });
}
export async function verifyPassword(password, encoded) {
  const parts=typeof encoded==='string'?encoded.split('$'):[];
  const valid=parts.length===6 && parts.slice(0,4).join('$')==='scrypt$131072$8$1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  return passwordWork(async()=>{
    const hash=await derive(typeof password==='string'?password.slice(0,1024):'',valid?parts[4]:'0'.repeat(32),64,KDF);
    return valid && timingSafeEqual(hash,Buffer.from(parts[5],'hex'));
  });
}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const emailOf=body=>typeof body?.email==='string'?body.email.trim().toLowerCase().slice(0,254):'';
function cookieToken(req, name = COOKIE) {
  const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  return typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
const csrfFor=token=>hashToken('balicall-csrf:'+token);
function csrfValid(req,token) {
  const supplied=req.get('X-CSRF-Token')||'', expected=csrfFor(token);
  return /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}
export function attachAuth(app,config,injectedStore,guestAccess) {
  const store=injectedStore||new PgAuthStore();
  const enabled=config.authEnabled;
  const cookieOptions={httpOnly:true,sameSite:'lax',secure:config.authCookieSecure,path:'/',maxAge:8*3600000};
  const clearOptions={httpOnly:true,sameSite:'lax',secure:config.authCookieSecure,path:'/'};
  const guestCookie='balicall_guest';
  const guestLimits=new Map();
  const originAllowed=req=>{
    const origin=req.get('Origin');
    if(!origin) return req.get('Sec-Fetch-Site')!=='cross-site';
    return config.corsOrigins.includes(origin) || origin===req.protocol+'://'+req.get('host');
  };
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/session',wrap(async(req,res)=>{
    if(!enabled) return res.json({enabled:false,user:null});
    const token=cookieToken(req),user=token?await store.session(hashToken(token)):null;
    if(token&&!user) res.clearCookie(COOKIE,clearOptions);
    const guestToken=cookieToken(req,guestCookie), guest=!user?guestAccess?.session(guestToken):null;
    res.json({enabled:true,user:user||guest||null,csrfToken:user?csrfFor(token):guest?csrfFor(guestToken):null});
  }));
  async function limit(req,res,kind,email) {
    const ip=req.socket.remoteAddress||'unknown';
    const ipOK=await store.consumeLimit(kind+':ip:'+ip,30,15);
    const accountOK=email?await store.consumeLimit(kind+':account:'+email,10,15):true;
    if(ipOK&&accountOK)return true;
    res.set('Retry-After','900').status(429).json({error:'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.'});return false;
  }
  router.use((req,res,next)=>{
    if(!enabled)return res.status(503).json({error:'Login belum dikonfigurasi.'});
    if(!originAllowed(req))return res.status(403).json({error:'Asal permintaan tidak diizinkan.'});
    next();
  });
  router.post('/login',wrap(async(req,res)=>{
    const email=emailOf(req.body),password=req.body?.password;
    if(!await limit(req,res,'login',email))return;
    if(!email.includes('@')||typeof password!=='string'||!password.length||password.length>1024)return res.status(400).json({error:'Isi email dan kata sandi dengan benar.'});
    const account=await store.account(email);
    const verified=await verifyPassword(password,account?.password_hash);
    if(!verified||account?.status!=='active')return res.status(401).json({error:invalidLogin});
    const previous=cookieToken(req);
    if(previous)await store.revoke(hashToken(previous));
    const token=randomBytes(32).toString('base64url');
    await store.createSession(hashToken(token),account.employee_id,8);
    const guestToken=cookieToken(req,guestCookie);
    if(guestToken){guestAccess?.revoke(guestToken);res.clearCookie(guestCookie,clearOptions);}
    res.cookie(COOKIE,token,cookieOptions).json({enabled:true,user:publicUser(account),csrfToken:csrfFor(token)});
  }));
  router.post('/guest',wrap(async(req,res)=>{
    if(!guestAccess)return res.status(503).json({error:'Akses tamu belum tersedia.'});
    // Bounded per-process admission limit; random invitation codes are never enumerable.
    const now=Date.now();
    for(const [key,value] of guestLimits)if(value.until<=now)guestLimits.delete(key);
    const ip=req.socket.remoteAddress||'unknown';
    const bucket=guestLimits.get(ip)||{count:0,until:now+15*60000};
    if((guestLimits.size>=1000&&!guestLimits.has(ip))||++bucket.count>30)return res.set('Retry-After','900').status(429).json({error:'Terlalu banyak percobaan. Coba lagi nanti.'});
    guestLimits.set(ip,bucket);
    const employeeToken=cookieToken(req);
    if(employeeToken&&await store.session(hashToken(employeeToken)))return res.status(409).json({error:'Keluar dari akun karyawan sebelum masuk sebagai tamu.'});
    const joined=guestAccess.join(req.body);
    const previous=cookieToken(req,guestCookie);if(previous)guestAccess.revoke(previous);
    res.clearCookie(COOKIE,clearOptions);
    res.cookie(guestCookie,joined.token,cookieOptions).json({enabled:true,user:joined.user,csrfToken:csrfFor(joined.token)});
  }));
  router.post('/activate',wrap(async(req,res)=>{
    const email=emailOf(req.body),code=req.body?.activationCode,password=req.body?.password;
    if(!await limit(req,res,'activate',email))return;
    validatePassword(password);
    if(typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code)||!await store.validInvite(email,hashToken(code)))return res.status(400).json({error:invalidActivation});
    const encoded=await hashPassword(password);
    if(!await store.activate(email,hashToken(code),encoded))return res.status(400).json({error:invalidActivation});
    res.clearCookie(COOKIE,clearOptions).json({success:true,message:'Kata sandi tersimpan. Silakan masuk.'});
  }));
  router.post('/logout',wrap(async(req,res)=>{
    const token=cookieToken(req);
    const guestToken=cookieToken(req,guestCookie);
    if(guestToken&&!csrfValid(req,guestToken))return res.status(403).json({error:'Permintaan tidak valid. Muat ulang halaman.'});
    if(token&&!csrfValid(req,token))return res.status(403).json({error:'Permintaan tidak valid. Muat ulang halaman.'});
    if(token)await store.revoke(hashToken(token));
    if(guestToken)guestAccess?.revoke(guestToken);
    res.clearCookie(guestCookie,clearOptions);
    res.clearCookie(COOKIE,clearOptions).json({success:true});
  }));
  app.use('/api/auth',router);
  app.use('/api',wrap(async(req,res,next)=>{
    if(!enabled)return next();
    if(req.path==='/health'||(req.path==='/livekit/webhook'&&req.method==='POST'))return next();
    res.set('Cache-Control','no-store');
    const employeeToken=cookieToken(req),employee=employeeToken?await store.session(hashToken(employeeToken)):null;
    const guestToken=cookieToken(req,guestCookie),guest=!employee?guestAccess?.session(guestToken):null;
    const token=employee?employeeToken:guestToken,user=employee||guest;
    if(!user)return res.status(401).json({error:'Silakan masuk untuk melanjutkan.',code:'AUTH_REQUIRED'});
    if(guest) {
      const endpoint=req.path.match(/^\/meetings\/([^/]+)\/(transcript|presence|leave|audio|live-session)$/);
      const allowed=(req.method==='POST'&&req.path==='/token')||(endpoint&&endpoint[1]===guest.guestMeetingId&&
        (req.method==='POST'||(req.method==='GET'&&endpoint[2]==='transcript')));
      if(!allowed)return res.status(403).json({error:'Akses tamu hanya untuk rapat yang diundang.'});
    }
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!originAllowed(req)||!csrfValid(req,token)))return res.status(403).json({error:'Permintaan tidak valid. Muat ulang halaman.',code:'CSRF_INVALID'});
    req.auth={user};
    next();
  }));
}
