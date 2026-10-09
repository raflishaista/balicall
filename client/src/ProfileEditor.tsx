import { useEffect, useRef, useState } from 'react';
import { apiRequest, API_BASE } from './api';
import type { AuthUser } from './AuthGate';
import { initials } from './presentation';

import { prepareProfilePhoto } from './profilePhoto';
export function UserAvatar({user}:{user:AuthUser}) {
  const [failed,setFailed]=useState<string|null>(null);
  return user.photoVersion&&failed!==user.photoVersion?<img className="profile-photo" src={`${API_BASE}/profile/photo?v=${encodeURIComponent(user.photoVersion)}`} alt="" onError={()=>setFailed(user.photoVersion||null)}/>:<>{initials(user.name)}</>;
}
export function ProfileEditor({user,onUpdated}:{user:AuthUser;onUpdated?:(user:AuthUser)=>void}) {
  const [profile,setProfile]=useState<AuthUser&{revision:number}|null>(null);
  const [name,setName]=useState(''),[photo,setPhoto]=useState<string|null>(null),[remove,setRemove]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const [reload,setReload]=useState(0);const alive=useRef(true),lock=useRef(false);
  useEffect(()=>{alive.current=true;const controller=new AbortController();void apiRequest<{user:AuthUser&{revision:number}}>('/profile',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setProfile(data.user);setName(data.user.name);setPhoto(null);setRemove(false);setError(null);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>{alive.current=false;controller.abort();};},[reload]);
  const submit=async()=>{
    if(lock.current||!profile)return;lock.current=true;setBusy(true);setError(null);setNotice(null);
    try{const data=await apiRequest<{user:AuthUser&{revision:number}}>('/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:name.trim(),revision:profile.revision,...(photo?{photo}:{}),...(remove?{deletePhoto:true}:{})})});if(alive.current){setProfile(data.user);setPhoto(null);setRemove(false);onUpdated?.(data.user);setNotice('Profil tersimpan dan tersedia di perangkat lain.');}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Profil belum tersimpan.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  return <section className="settings-profile-detail surface-card" aria-labelledby="profile-detail-heading">
    <h2 id="profile-detail-heading">Profil pengguna</h2><p>Nama tampilan dan foto untuk workspace BaliCall.</p>
    {error&&<p role="alert" className="settings-notice">{error}</p>}{notice&&<p role="status" className="settings-notice">{notice}</p>}
    <button type="button" className="text-button" disabled={busy} onClick={()=>setReload(v=>v+1)}>Muat ulang profil</button>
    <form onSubmit={e=>{e.preventDefault();void submit();}}>
      <div className="settings-profile-avatar">{photo?<img className="profile-photo" src={photo} alt="Preview foto profil"/>:remove?initials(name):<UserAvatar user={profile||user}/>}</div>
      <label className="settings-device-field">Foto profil<input type="file" accept="image/jpeg,image/png" disabled={!profile||busy} onChange={e=>{
        const file=e.target.files?.[0];e.target.value='';if(!file||lock.current)return;lock.current=true;setBusy(true);setError(null);
        void prepareProfilePhoto(file).then(data=>{if(alive.current){setPhoto(data);setRemove(false);setNotice(null);}}).catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{lock.current=false;if(alive.current)setBusy(false);});
      }}/></label><small>JPG/PNG maksimal 2 MB dan 4 megapiksel. Foto dipotong persegi.</small>
      <button type="button" className="text-button" disabled={!profile||busy} onClick={()=>{setPhoto(null);setRemove(true);setNotice(null);}}>Hapus foto</button>
      <label className="settings-device-field">Nama tampilan<input required maxLength={80} value={name} disabled={!profile||busy} onChange={e=>{setName(e.target.value);setNotice(null);}}/></label>
      <dl className="settings-profile-data">{[['Nama resmi',profile?.legalName||user.legalName||user.name],['NIK',user.employeeId],['Email perusahaan',user.email],['Departemen',user.department],['Jabatan',user.position]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Belum tersedia'}</dd></div>)}</dl>
      <p>Identitas resmi dan email login dikelola admin perusahaan.</p>
      <button type="submit" className="button-primary" disabled={!profile||busy||!name.trim()}>{busy?'Memproses…':'Simpan profil'}</button>
    </form>
  </section>;
}
