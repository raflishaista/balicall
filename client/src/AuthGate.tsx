import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';
import App from './App';
import { apiRequest, setAuthCsrfToken, AUTH_EXPIRED_EVENT } from './api';
import { setAccountScope } from './accountScope';
import devices from './assets/login/balicall-connected-devices.png';
import logo from './assets/login/balitower-balicall-logo-white.png';
import './Login.css';
import { disablePush } from './pushNotifications';

export interface AuthUser { employeeId: string; name: string; email: string; department: string; position: string; isGuest?: boolean; guestMeetingId?: string; guestRoomName?: string; legalName?: string; photoVersion?: string|null }
interface Session { enabled: boolean; user: AuthUser | null; csrfToken?: string | null }
export function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  const generation = useRef({ value: 0 });
  const accept = useCallback((next: Session) => {
    setAuthCsrfToken(next.csrfToken || null); setAccountScope(next.user?.employeeId || null);
    setSession(next); setError(null);
  }, []);
  const check = useCallback(() => {
    const own = ++generation.current.value;
    return apiRequest<Session>('/auth/session')
      .then(next => { if (generation.current.value === own) accept(next); })
      .catch(err => { if (generation.current.value === own) setError(err instanceof Error ? err.message : 'Layanan login tidak tersambung.'); })
      .finally(() => { if (generation.current.value === own) setChecking(false); });
  }, [accept]);
  useEffect(() => {
    const lifecycle = generation.current;
    void check();
    const expired = () => { lifecycle.value++; setAuthCsrfToken(null); setAccountScope(null); setSession({ enabled: true, user: null }); setChecking(false); setError('Sesi sudah berakhir. Silakan masuk kembali.'); };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => { lifecycle.value++; window.removeEventListener(AUTH_EXPIRED_EVENT, expired); };
  }, [check]);
  const logout = async () => {
    if(logoutPending)return;
    setLogoutPending(true);setError(null);
    try { if(session?.user&&!session.user.isGuest)await disablePush(); await apiRequest('/auth/logout', {method:'POST'}); accept({enabled:true,user:null}); }
    catch(err) {setError(err instanceof Error?err.message:'Gagal keluar. Coba lagi.');}
    finally {setLogoutPending(false);}
  };
  if (!checking && session && (!session.enabled || session.user)) return <><App key={session.user?.employeeId || 'legacy'} authUser={session.user} onProfileUpdated={user=>setSession(current=>current?{...current,user}:current)} onLogout={session.enabled ? logout : undefined} logoutPending={logoutPending} />{error && <div className="login-session-error" role="alert">{error}</div>}</>;
  return <LoginPage checking={checking} serviceError={error} unavailable={!session && !checking} onRetry={async () => { setChecking(true); await check(); }} onAuthenticated={accept} />;
}
function LoginPage({checking,serviceError,unavailable,onRetry,onAuthenticated}:{
  checking:boolean;serviceError:string|null;unavailable:boolean;onRetry:()=>Promise<void>;onAuthenticated:(session:Session)=>void;
}) {
  const [mode,setMode]=useState<'login'|'activate'|'guest'>('login');
  const [guestName,setGuestName]=useState(''),[inviteCode,setInviteCode]=useState('');
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [code,setCode]=useState('');
  const [show,setShow]=useState(false), [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null), [notice,setNotice]=useState<string|null>(null);
  const lock=useRef(false);
  const switchMode=(next:'login'|'activate'|'guest')=>{setMode(next);setError(null);setNotice(null);setPassword('');setCode('');setShow(false);};
  const submit=async(event:React.SubmitEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(lock.current||checking||unavailable)return;
    lock.current=true;setPending(true);setError(null);setNotice(null);
    try {
      if(mode==='guest') {
        const next=await apiRequest<Session>('/auth/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:guestName.trim(),inviteCode:inviteCode.trim()})});
        onAuthenticated(next);
      } else if(mode==='activate') {
        await apiRequest('/auth/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,activationCode:code.trim()})});
        switchMode('login');setNotice('Kata sandi tersimpan. Silakan masuk.');
      } else {
        const next=await apiRequest<Session>('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
        setPassword('');onAuthenticated(next);
      }
    } catch(err) {setError(err instanceof Error?err.message:'Permintaan gagal. Coba lagi.');}
    finally {lock.current=false;setPending(false);}
  };
  const disabled=checking||pending||unavailable;
  return <main className="login-page">
    <section className="login-story" aria-label="BaliCall">
      <img className="login-logo" src={logo} alt="BaliTower BaliCall" />
      <div className="login-story-copy"><h1>Rapat terhubung,<br />catatan tersusun.</h1><p>Satu ruang untuk berdiskusi, berbagi layar, dan mencatat hasil rapat.</p></div>
      <img className="login-devices" src={devices} alt="" />
      <span className="login-story-footer">Bali Tower Sentra</span>
    </section>
    <section className="login-form-panel">
      <div className="login-form-content"><span className="login-kicker">BaliCall</span><h2>{mode==='guest'?'Gabung sebagai tamu':mode==='login'?'Masuk ke BaliCall':'Aktivasi akun BaliCall'}</h2>
      <p className="login-description">{mode==='guest'?'Gunakan kode undangan tamu dari peserta rapat. Tidak perlu akun perusahaan.':mode==='login'?'Gunakan akun perusahaan untuk melanjutkan.':'Masukkan kode dari admin dan tentukan kata sandi Anda.'}</p>
      {checking && <p role="status" className="login-notice"><Loader2 className="ui-spinner" size={17} />Memeriksa sesi…</p>}
      {(error||serviceError) && <p role="alert" className="login-error">{error||serviceError}</p>}
      {notice && <p role="status" className="login-notice">{notice}</p>}
      {unavailable && <button className="login-text-button" type="button" onClick={()=>void onRetry()}>Coba hubungkan lagi</button>}
      <form onSubmit={submit} aria-busy={pending}>
        {mode==='guest' ? <>
          <label className="login-field">Nama tamu<span><input autoComplete="name" value={guestName} onChange={event=>setGuestName(event.target.value)} maxLength={80} required disabled={disabled} placeholder="Nama yang tampil di rapat" /></span></label>
          <label className="login-field">Kode undangan tamu<span><input autoComplete="off" value={inviteCode} onChange={event=>setInviteCode(event.target.value)} maxLength={22} required disabled={disabled} placeholder="Kode dari peserta rapat" /></span></label>
          <p className="login-help">Akses hanya ke rapat yang diundang. Nama tamu tidak diverifikasi sebagai karyawan.</p>
        </> : <>
        <label className="login-field">Email perusahaan<span><Mail size={21} aria-hidden="true" /><input type="email" autoComplete="username" inputMode="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="nama@balitower.co.id" maxLength={254} required disabled={disabled} /></span></label>
        {mode==='activate' && <label className="login-field">Kode aktivasi<span><LockKeyhole size={21} aria-hidden="true" /><input autoComplete="off" value={code} onChange={event=>setCode(event.target.value)} placeholder="Kode dari admin" maxLength={43} required disabled={disabled} /></span></label>}
        <label className="login-field">Kata sandi<span><LockKeyhole size={21} aria-hidden="true" /><input type={show?'text':'password'} autoComplete={mode==='activate'?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} minLength={mode==='activate'?15:undefined} maxLength={128} required disabled={disabled} aria-describedby={mode==='activate'?'password-hint':undefined} /><button type="button" className="login-password-toggle" aria-label={show?'Sembunyikan kata sandi':'Tampilkan kata sandi'} aria-pressed={show} onClick={()=>setShow(!show)} disabled={disabled}>{show?<EyeOff size={21}/>:<Eye size={21}/>}</button></span></label>
        {mode==='activate' && <p id="password-hint" className="login-help">Gunakan 15–128 karakter. Kode aktivasi berlaku sekali selama 24 jam.</p>}
        {mode==='login' && <button type="button" className="login-text-button login-forgot" disabled={disabled} onClick={()=>{switchMode('activate');setNotice('Hubungi admin untuk kode aktivasi ulang. Kode ini digunakan untuk membuat kata sandi baru.');}}>Lupa kata sandi?</button>}
        </>}
        <button type="submit" className="login-submit" disabled={disabled}>{pending?<><Loader2 size={20} className="ui-spinner"/>Memproses…</>:mode==='guest'?'Lanjut ke pemeriksaan perangkat':mode==='login'?'Masuk':'Simpan kata sandi'}</button>
      </form>
      {mode!=='activate' && <button className="login-guest-button" type="button" disabled={disabled} onClick={()=>switchMode(mode==='guest'?'login':'guest')}>{mode==='guest'?'Masuk dengan akun perusahaan':'Gabung sebagai tamu'}</button>}
      <div className="login-assistance"><span>{mode==='login'?'Pertama kali masuk?':'Sudah punya kata sandi?'}</span> <button className="login-text-button" type="button" disabled={checking||pending} onClick={()=>switchMode(mode==='login'?'activate':'login')}>{mode==='login'?'Aktivasi akun':'Kembali masuk'}</button></div>
      <p className="login-admin-help">Butuh bantuan? Hubungi admin IT perusahaan untuk aktivasi akun.</p></div>
      <footer className="login-form-footer">BaliCall · Bali Tower Sentra</footer>
    </section>
  </main>;
}
