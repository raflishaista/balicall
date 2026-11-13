import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail, User } from 'lucide-react';
import { apiRequest, setAuthCsrfToken, AUTH_EXPIRED_EVENT } from './api';
import { setAccountScope } from './accountScope';
import devices from './assets/login/balicall-connected-devices.webp';
import logo from './assets/login/balitower-balicall-logo-white.webp';
import './Login.css';
import { disablePush } from './pushNotifications';
import { clearSummarySession } from './summaryHistory';
import { BalitowerLoading } from './BalitowerLoading';
import { usePreferences } from './usePreferences';

const App = lazy(() => import('./App'));

function WorkspaceLoading() {
  const { preferences } = usePreferences();
  return <BalitowerLoading variant="workspace" reduceMotion={preferences.reduceMotion} />;
}

export interface AuthUser { employeeId: string; name: string; email: string; department: string; position: string; isGuest?: boolean; isSuperAdmin?: boolean; guestMeetingId?: string; guestRoomName?: string; guestRoomCode?: string; legalName?: string; photoVersion?: string|null }
interface Session { enabled: boolean; user: AuthUser | null; csrfToken?: string | null }
export function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  const generation = useRef({ value: 0 });
  const logoutLock = useRef(false);
  const accept = useCallback((next: Session) => {
    setAuthCsrfToken(next.csrfToken || null); setAccountScope(next.user?.employeeId || null);
    setSession(next); setError(null);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        if (next.user) localStorage.setItem('balicall_active_session', JSON.stringify({ id: next.user.employeeId, t: Date.now() }));
        else localStorage.removeItem('balicall_active_session');
      } catch {}
    }
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
    const expired = () => {
      lifecycle.value++;
      setAuthCsrfToken(null);
      setAccountScope(null);
      if (typeof window !== 'undefined' && window.location) {
        window.location.hash = '#/home';
      }
      setSession({ enabled: true, user: null });
      setChecking(false);
      setError('Sesi sudah berakhir. Silakan masuk kembali.');
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'balicall_active_session') void check();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    window.addEventListener('storage', onStorage);
    return () => {
      lifecycle.value++;
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
      window.removeEventListener('storage', onStorage);
    };
  }, [check]);
  const logout = async () => {
    if (logoutLock.current) return;
    logoutLock.current = true;
    generation.current.value++;
    setLogoutPending(true); setError(null);
    try {
      // Notification cleanup must not prevent revoking the login session.
      if (session?.user && !session.user.isGuest) {
        try { await disablePush(); } catch { console.warn('Push cleanup unavailable during logout.'); }
      }
      await apiRequest('/auth/logout', {method:'POST'});
      clearSummarySession();
      if (typeof window !== 'undefined' && window.location) {
        window.location.hash = '#/home';
      }
      accept({enabled:true,user:null});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal keluar. Coba lagi.');
    } finally {
      logoutLock.current = false; setLogoutPending(false);
    }
  };
  if (!checking && session && (!session.enabled || session.user)) {
    return <><Suspense fallback={<WorkspaceLoading />}><App key={session.user?.employeeId || 'legacy'} authUser={session.user}
      onProfileUpdated={user=>setSession(current=>current?.user?.employeeId===user.employeeId
        ? {...current,user:{...current.user,...user}} : current)}
      onLogout={session.enabled ? logout : undefined} logoutPending={logoutPending} /></Suspense>
      {error && <div className="login-session-error" role="alert">{error}</div>}</>;
  }
  return <LoginPage checking={checking} serviceError={error} unavailable={!session && !checking}
    onRetry={async()=>{setChecking(true);await check();}} onAuthenticated={accept} />;

}
export function LoginPage({checking,serviceError,unavailable,onRetry,onAuthenticated}:{
  checking:boolean;serviceError:string|null;unavailable:boolean;onRetry:()=>Promise<void>;onAuthenticated:(session:Session)=>void;
}) {
  const [mode,setMode]=useState<'login'|'activate'|'request'|'guest'>('login');
  const [guestName,setGuestName]=useState(''),[inviteCode,setInviteCode]=useState(''),[requestName,setRequestName]=useState('');
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [code,setCode]=useState('');
  const [show,setShow]=useState(false), [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null), [notice,setNotice]=useState<string|null>(null);
  const [conflictModal,setConflictModal]=useState<{email:string;name?:string;message:string}|null>(null);
  const lock=useRef(false);
  const switchMode=(next:'login'|'activate'|'request'|'guest')=>{setMode(next);setError(null);setNotice(null);setConflictModal(null);setRequestName('');setPassword('');setCode('');setShow(false);};
  const submit=async(event:React.SyntheticEvent|{preventDefault?:()=>void},force=false)=>{
    if('preventDefault' in event && typeof event.preventDefault==='function')event.preventDefault();
    if(lock.current||checking||unavailable)return;
    lock.current=true;setPending(true);setError(null);setNotice(null);
    try {
      if(mode==='guest') {
        const next=await apiRequest<Session>('/auth/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:guestName.trim(),inviteCode:inviteCode.trim()})});
        if (typeof window !== 'undefined' && window.location) {
          window.location.hash = '#/home';
        }
        onAuthenticated(next);
      } else if(mode==='activate') {
        await apiRequest('/auth/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,activationCode:code.trim()})});
        switchMode('login');setNotice('Kata sandi tersimpan. Silakan masuk.');
      } else if(mode==='request') {
        await apiRequest('/auth/request-activation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:requestName.trim(),email,password})});
        switchMode('login');setNotice('Permintaan aktivasi terkirim. Silakan tunggu persetujuan admin sebelum masuk.');
      } else {
        const next=await apiRequest<Session>('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,...(force?{force:true}:{})})});
        setPassword('');setConflictModal(null);
        if (typeof window !== 'undefined' && window.location) {
          window.location.hash = '#/home';
        }
        onAuthenticated(next);
      }
    } catch(err:any) {
      if(mode==='login' && (err?.status===409 || err?.code==='ACCOUNT_ALREADY_LOGGED_IN' || err?.data?.alreadyLoggedIn)) {
        setConflictModal({email,name:err?.data?.employeeName,message:err instanceof Error?err.message:'Akun ini sedang aktif di sesi atau perangkat lain.'});
      } else {
        setError(err instanceof Error?err.message:'Permintaan gagal. Coba lagi.');
      }
    } finally {lock.current=false;setPending(false);}
  };
  const disabled=checking||pending||unavailable;
  return <main className="login-page">
    <section className="login-story" aria-label="BaliCall">
      <img className="login-logo" src={logo} width={768} height={288} decoding="async" alt="BaliTower BaliCall" />
      <div className="login-story-copy"><h1>Rapat terhubung,<br />catatan tersusun.</h1><p>Satu ruang untuk berdiskusi, berbagi layar, dan mencatat hasil rapat.</p></div>
      <img className="login-devices" src={devices} width={1536} height={1024} decoding="async" alt="" />
      <span className="login-story-footer">Bali Tower Sentra</span>
    </section>
    <section className="login-form-panel">
      <div className="login-form-content"><span className="login-kicker">BaliCall</span><h2>{mode==='guest'?'Gabung sebagai tamu':mode==='login'?'Masuk ke BaliCall':mode==='request'?'Request aktivasi akun':'Aktivasi akun BaliCall'}</h2>
      <p className="login-description">{mode==='guest'?'Gunakan kode undangan tamu dari peserta rapat. Tidak perlu akun perusahaan.':mode==='login'?'Gunakan akun perusahaan untuk melanjutkan.':mode==='request'?'Isi nama, email, dan kata sandi yang diinginkan. Permintaan akan ditinjau oleh admin sebelum akun diaktifkan untuk masuk.':'Masukkan kode dari admin dan tentukan kata sandi Anda.'}</p>
      {checking && <p role="status" className="login-notice"><Loader2 className="ui-spinner" size={17} />Memeriksa sesi…</p>}
      {(error||serviceError) && <p role="alert" className="login-error">{error||serviceError}</p>}
      {notice && <p role="status" className="login-notice">{notice}</p>}
      {unavailable && <button className="login-text-button" type="button" onClick={()=>void onRetry()}>Coba hubungkan lagi</button>}
      <form onSubmit={submit} aria-busy={pending}>
        {mode==='guest' ? <>
          <label className="login-field">Nama tamu<span><input autoComplete="name" value={guestName} onChange={event=>setGuestName(event.target.value)} maxLength={80} required disabled={disabled} placeholder="Nama yang tampil di rapat" /></span></label>
          <label className="login-field">Kode undangan tamu<span><input autoComplete="off" value={inviteCode} onChange={event=>{const val=event.target.value; setInviteCode(val.trim().length <= 5 ? val.toUpperCase() : val);}} maxLength={22} required disabled={disabled} placeholder="5 digit kode ruang atau kode undangan" /></span></label>
          <p className="login-help">Akses hanya ke rapat yang diundang. Masukkan 5 digit kode ruang atau kode undangan dari peserta rapat.</p>
        </> : <>
        {mode==='request' && <label className="login-field">Nama lengkap<span><User size={21} aria-hidden="true" /><input type="text" autoComplete="name" value={requestName} onChange={event=>setRequestName(event.target.value)} placeholder="Nama lengkap Anda" maxLength={120} required disabled={disabled} /></span></label>}
        <label className="login-field">Email perusahaan<span><Mail size={21} aria-hidden="true" /><input type="email" autoComplete="username" inputMode="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="nama@balitower.co.id" maxLength={254} required disabled={disabled} /></span></label>
        {mode==='activate' && <label className="login-field">Kode aktivasi<span><LockKeyhole size={21} aria-hidden="true" /><input autoComplete="off" value={code} onChange={event=>setCode(event.target.value)} placeholder="Kode dari admin" maxLength={43} required disabled={disabled} /></span></label>}
        <label className="login-field">Kata sandi<span><LockKeyhole size={21} aria-hidden="true" /><input type={show?'text':'password'} autoComplete={mode==='activate'||mode==='request'?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} minLength={mode==='activate'||mode==='request'?8:undefined} maxLength={128} required disabled={disabled} aria-describedby={mode==='activate'||mode==='request'?'password-hint':undefined} /><button type="button" className="login-password-toggle" aria-label={show?'Sembunyikan kata sandi':'Tampilkan kata sandi'} aria-pressed={show} onClick={()=>setShow(!show)} disabled={disabled}>{show?<EyeOff size={21}/>:<Eye size={21}/>}</button></span></label>
        {mode==='activate' && <p id="password-hint" className="login-help">Gunakan 8–128 karakter. Kode aktivasi berlaku sekali selama 24 jam.</p>}
        {mode==='request' && <p id="password-hint" className="login-help">Gunakan 8–128 karakter. Admin akan meninjau permintaan Anda dan mengaktifkan akun agar dapat digunakan untuk masuk.</p>}
        {mode==='login' && <button type="button" className="login-text-button login-forgot" disabled={disabled} onClick={()=>{switchMode('activate');setNotice('Hubungi admin untuk kode aktivasi ulang. Kode ini digunakan untuk membuat kata sandi baru.');}}>Lupa kata sandi?</button>}
        </>}
        <button type="submit" className="login-submit" disabled={disabled}>{pending?<><Loader2 size={20} className="ui-spinner"/>Memproses…</>:mode==='guest'?'Lanjut ke pemeriksaan perangkat':mode==='login'?'Masuk':mode==='request'?'Kirim Permintaan':'Simpan kata sandi'}</button>
      </form>
      {mode!=='activate' && mode!=='request' && <button className="login-guest-button" type="button" disabled={disabled} onClick={()=>switchMode(mode==='guest'?'login':'guest')}>{mode==='guest'?'Masuk dengan akun perusahaan':'Gabung sebagai tamu'}</button>}
      <div className="login-assistance"><span>{mode==='login'?'Pertama kali masuk?':'Sudah punya kata sandi?'}</span> {mode==='login'?<><button className="login-text-button" type="button" disabled={checking||pending} onClick={()=>switchMode('activate')}>Aktivasi akun</button><span>·</span><button className="login-text-button" type="button" disabled={checking||pending} onClick={()=>switchMode('request')}>Request Aktivasi</button></>:<button className="login-text-button" type="button" disabled={checking||pending} onClick={()=>switchMode('login')}>Kembali masuk</button>}</div>
      <p className="login-admin-help">Butuh bantuan? Hubungi admin IT perusahaan untuk aktivasi akun.</p></div>
      <footer className="login-form-footer">BaliCall · Bali Tower Sentra</footer>
    </section>
    {conflictModal && (
      <div className="login-conflict-backdrop" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="login-conflict-dialog">
          <div className="login-conflict-header">
            <div className="login-conflict-icon" aria-hidden="true">
              <AlertCircle size={26} />
            </div>
            <div>
              <h3 id="conflict-title">Akun Sedang Digunakan</h3>
              <p className="login-conflict-subtitle">Sesi login aktif terdeteksi</p>
            </div>
          </div>
          <p className="login-conflict-body">
            Akun <strong>{conflictModal.email}</strong> saat ini sedang aktif di sesi atau perangkat lain. Untuk menjaga integritas data rapat dan keamanan akun, Anda dibatasi untuk masuk ke akun yang sedang aktif.
          </p>
          <div className="login-conflict-actions">
            <button
              type="button"
              className="login-conflict-cancel"
              onClick={() => { setConflictModal(null); setError('Masuk dibatalkan. Akun masih aktif di sesi lain.'); }}
              disabled={pending}
            >
              Batalkan
            </button>
            <button
              type="button"
              className="login-conflict-force"
              onClick={() => void submit({ preventDefault: () => {} }, true)}
              disabled={pending}
            >
              {pending ? <><Loader2 size={16} className="ui-spinner" /> Memproses…</> : 'Keluarkan Sesi Lain & Masuk'}
            </button>
          </div>
        </div>
      </div>
    )}
  </main>;
}
