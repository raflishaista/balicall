import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowRight, AudioLines, Calendar, Check, ChevronRight, FileText, Home, Loader2, LogIn, Mic, Plus, Search, Settings, Users, X } from 'lucide-react';
import { initials } from './presentation';

export interface WorkspaceHealth {
  livekitStatus?: string;
  sttProvider?: 'browser' | 'server';
  sttConfigured?: boolean;
}

interface RecentMeeting {
  title: string;
  roomName: string;
  endedAt: string;
  transcriptCount: number;
}

export function BrandLogo({ inverse = false }: { inverse?: boolean }) {
  return <img className="brand-logo" src={inverse ? '/brand/balitower-logo-white.png' : '/brand/balitower-logo.png'} alt="BaliTower" />;
}

export function WorkspaceSidebar({ view, intent, employeeName, hasSummary, onHome, onCreate, onJoin, onSummary, onSchedule, onSettings, onLogout, logoutPending, isGuest = false }: {
  onLogout?: () => Promise<void>; logoutPending?: boolean; isGuest?: boolean;
  view: string; intent: 'create' | 'join'; employeeName: string; hasSummary: boolean;
  onHome: () => void; onCreate: () => void; onJoin: () => void; onSummary: () => void; onSchedule?: () => void; onSettings: () => void;
}) {
  return <aside className="workspace-sidebar">
    <div className="sidebar-brand"><BrandLogo /><span>SENTRA WORKSPACE</span></div>
    <p className="sidebar-label">WORKSPACE</p>
    <nav className="sidebar-navigation" aria-label="Navigasi utama">
      {!isGuest && <button className={view === 'home' ? 'sidebar-link active' : 'sidebar-link'} aria-current={view === 'home' ? 'page' : undefined} onClick={onHome}><Home size={19} /><span>Beranda</span></button>}
      {!isGuest && <button className={view === 'lobby' && intent === 'create' ? 'sidebar-link active' : 'sidebar-link'} onClick={onCreate}><Plus size={19} /><span>Buat rapat</span></button>}
      <button className={view === 'lobby' && intent === 'join' ? 'sidebar-link active' : 'sidebar-link'} onClick={onJoin}><LogIn size={19} /><span>Gabung rapat</span></button>
      {!isGuest && <button className={view === 'schedule' ? 'sidebar-link active' : 'sidebar-link'} aria-current={view === 'schedule' ? 'page' : undefined} onClick={onSchedule}><Calendar size={19} /><span>Jadwalkan rapat</span></button>}
      {!isGuest && <button className={view === 'summary' ? 'sidebar-link active' : 'sidebar-link'} aria-current={view === 'summary' ? 'page' : undefined} title="Lihat notulen & riwayat rapat" onClick={onSummary}>
        <FileText size={19} />
        <span>Notulen rapat</span>
        {hasSummary && <span className="sidebar-has-summary-dot" title="Tersedia notulen tersimpan" />}
      </button>}
      <button className={view === 'settings' ? 'sidebar-link active' : 'sidebar-link'} aria-current={view === 'settings' ? 'page' : undefined} onClick={onSettings}><Settings size={19} /><span>Pengaturan</span></button>
    </nav>
    <div className="sidebar-bottom">
      {onLogout && <button type="button" className="sidebar-link sidebar-account-logout" disabled={logoutPending} onClick={() => void onLogout()} aria-label="Keluar akun">{logoutPending ? <Loader2 className="ui-spinner" size={18} /> : <LogIn size={18} />}<span>{logoutPending ? 'Keluar…' : 'Keluar akun'}</span></button>}
      <div className="sidebar-note"><AudioLines size={20} /><div><strong>Ruang untuk terhubung.</strong><span>Suara, percakapan, keputusan.</span></div></div>
      <div className="sidebar-profile"><span className="user-avatar">{initials(employeeName)}</span><div><strong>{employeeName || 'Bali Tower Sentra'}</strong><span>Internal meeting workspace</span></div></div>
    </div>
  </aside>;
}

function MeetingGuide({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const buttons = closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <button ref={closeRef} className="icon-button dialog-close" aria-label="Tutup panduan" onClick={onClose}><X size={20} /></button>
      <span className="feature-icon"><AudioLines size={25} /></span><h2 id="guide-title">Siap untuk rapat berikutnya?</h2><p>Beberapa langkah sederhana agar percakapanmu tercatat.</p>
      <ol className="guide-steps"><li><strong>Siapkan identitas dan ruang</strong><span>Isi nama serta NIK. Bagikan nama ruang yang sama kepada peserta.</span></li><li><strong>Periksa mikrofon</strong><span>Uji input suara, lalu izinkan mikrofon di browser saat masuk rapat.</span></li><li><strong>Perhatikan status transkripsi</strong><span>Status “Mendengarkan” menunjukkan layanan transkrip sedang aktif.</span></li><li><strong>Simpan hasil percakapan</strong><span>Pilih “Selesai & notulen” untuk membuat ringkasan, keputusan, dan tindak lanjut.</span></li></ol>
      <button className="button-primary full-width" onClick={onStart}>Mulai persiapan rapat <ArrowRight size={17} /></button>
    </section>
  </div>;
}

export function HomeDashboard({ backendHealth, lastMeeting, employeeName, onCreate, onJoin, onSchedule, upcomingSchedules }: {
  backendHealth: WorkspaceHealth | null; lastMeeting: RecentMeeting | null; employeeName: string;
  onCreate: () => void; onJoin: (code?: string) => void; onSchedule?: () => void; upcomingSchedules?: any[];
}) {
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const [hour] = useState(() => new Date().getHours());
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const recentMatches = lastMeeting && (lastMeeting.title + lastMeeting.roomName).toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'));
  const ready = backendHealth?.livekitStatus === 'reachable';

  return <div className="dashboard-content">
    <div className="dashboard-heading"><div><p className="page-kicker">BALI TOWER SENTRA</p><h1>{greeting}{employeeName ? ', ' + employeeName.split(' ')[0] : ''}<span className="greeting-dot">.</span></h1><p>Terhubung dengan tim, lanjutkan ide, dan catat setiap keputusan.</p></div><label className="workspace-search"><Search size={17} /><input aria-label="Cari rapat terakhir" placeholder="Cari rapat terakhir..." value={query} onChange={event => setQuery(event.target.value)} /></label></div>

    <section className="dashboard-hero" aria-label="Bali Tower Sentra">
      <img src="/brand/tower-landscape.webp" alt="Menara telekomunikasi BaliTower dengan latar pegunungan Bali" fetchPriority="high" />
      <div className="hero-scrim" /><div className="hero-copy"><span>Bali Tower Sentra</span><h2>Connecting People.<br />Enabling Tomorrow.</h2><p>Kolaborasi yang lebih dekat.<br />Untuk jaringan yang terus terhubung.</p><span className="hero-caption"><span /> INTERNAL MEETING WORKSPACE</span></div>
    </section>

    <div className="quick-actions">
      <button className="quick-action primary" onClick={onCreate}><span className="quick-action-icon"><Plus size={23} /></span><span><strong>Buat rapat</strong><small>Mulai ruang baru untuk tim</small></span><ChevronRight size={17} /></button>
      <button className="quick-action" onClick={() => onJoin()}><span className="quick-action-icon"><LogIn size={22} /></span><span><strong>Gabung rapat</strong><small>Masuk dengan kode ruang</small></span><ChevronRight size={17} /></button>
      <button className="quick-action" onClick={onSchedule}><span className="quick-action-icon"><Calendar size={22} /></span><span><strong>Jadwalkan rapat</strong><small>Atur kalender & ruang masa depan</small></span><ChevronRight size={17} /></button>
      <button className="quick-action" onClick={() => setGuideOpen(true)}><span className="quick-action-icon"><FileText size={21} /></span><span><strong>Panduan rapat</strong><small>Persiapkan suara dan transkrip</small></span><ChevronRight size={17} /></button>
    </div>

    <div className="dashboard-columns">
      <section className="surface-card recent-card"><header className="card-heading"><div><span className="section-kicker">AKTIVITAS TIM</span><h2>Rapat terakhir</h2></div><span className="subtle-tag">Sesi ini</span></header>
        {recentMatches ? <article className="recent-meeting"><span className="recent-meeting-icon"><FileText size={23} /></span><div><strong>{lastMeeting.title}</strong><span>#{lastMeeting.roomName}</span><small>{new Date(lastMeeting.endedAt).toLocaleString('id-ID')} · {lastMeeting.transcriptCount} ucapan</small></div><Check size={18} /></article> : <div className="empty-meetings"><span className="empty-meetings-icon"><Users size={29} /></span><h3>{query ? 'Rapat tidak ditemukan' : 'Percakapan berikutnya dimulai di sini'}</h3><p>{query ? 'Coba nama ruang atau judul yang berbeda.' : 'Belum ada rapat selesai di sesi ini. Mulai rapat untuk membuat transkrip dan notulen.'}</p>{!query && <button className="text-action" onClick={onCreate}>Mulai rapat pertama <ArrowRight size={15} /></button>}</div>}
        
        {upcomingSchedules && upcomingSchedules.length > 0 && (
          <div className="dashboard-upcoming-widget">
            <div className="upcoming-widget-header">
              <span className="upcoming-widget-title"><Calendar size={14} /> Agenda Rapat Terdekat</span>
              {onSchedule && <button type="button" className="text-action" onClick={onSchedule}>Buka Kalender <ArrowRight size={12} /></button>}
            </div>
            <div className="upcoming-widget-item">
              <div className="upcoming-widget-info">
                <strong>{upcomingSchedules[0].title}</strong>
                <span>#{upcomingSchedules[0].roomName} · {new Date(upcomingSchedules[0].scheduledStart).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}, {new Date(upcomingSchedules[0].scheduledStart).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</span>
              </div>
              <button type="button" className="button-primary compact-btn" onClick={() => onJoin(upcomingSchedules[0].roomName)}>
                Masuk <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}

        <form className="quick-join" onSubmit={event => { event.preventDefault(); if (code.trim()) onJoin(code.trim()); }}><label htmlFor="quick-meeting-code">Sudah punya kode ruang?</label><div><input id="quick-meeting-code" value={code} onChange={event => setCode(event.target.value)} placeholder="Masukkan kode / nama ruang" required /><button className="button-primary" type="submit">Gabung <ArrowRight size={15} /></button></div></form>
      </section>

      <section className="surface-card assistant-card"><header className="card-heading"><div><span className="section-kicker">MEETING ASSISTANT</span><h2>Fokus pada percakapan.</h2></div><span className="assistant-symbol"><AudioLines size={23} /></span></header><p className="assistant-intro">Bawa hasil rapat menjadi langkah nyata, tanpa kehilangan konteks.</p>
        <div className="assistant-feature"><span><Mic size={18} /></span><div><strong>Transkrip percakapan</strong><p>Ikuti ucapan peserta selama rapat berlangsung.</p></div></div><div className="assistant-feature"><span><FileText size={18} /></span><div><strong>Notulen setelah rapat</strong><p>Ringkasan, keputusan, dan tindak lanjut dalam satu tempat.</p></div></div>
        <div className="connection-card"><span className={ready ? 'status-dot online' : 'status-dot offline'} /><div><strong>{ready ? 'Layanan rapat terhubung' : 'Layanan rapat belum siap'}</strong><p>{backendHealth ? backendHealth.sttProvider === 'server' ? backendHealth.sttConfigured ? 'Transkripsi server tersedia' : 'Transkripsi server belum dikonfigurasi' : 'Transkripsi menggunakan browser' : 'Periksa koneksi backend sebelum mulai'}</p></div><Activity size={17} /></div>
      </section>
    </div>
    <footer className="dashboard-footer"><span>Bali Tower Sentra · Internal Meeting & AI Minutes</span><span>Connecting people, one conversation at a time.</span></footer>
    {guideOpen && <MeetingGuide onClose={closeGuide} onStart={() => { setGuideOpen(false); onCreate(); }} />}
  </div>;
}

export function LobbyView({ intent, onIntentChange, employeeId, setEmployeeId, employeeName, setEmployeeName, department, setDepartment, roomName, setRoomName, isJoining, joinError, onJoin, mediaPreview, personas, identityLocked = false, isGuest = false }: {
  intent: 'create' | 'join'; onIntentChange: (intent: 'create' | 'join') => void;
  employeeId: string; setEmployeeId: (value: string) => void; employeeName: string; setEmployeeName: (value: string) => void;
  department: string; setDepartment: (value: string) => void; roomName: string; setRoomName: (value: string) => void;
  isJoining: boolean; joinError: string | null; onJoin: () => void; mediaPreview: ReactNode;
  identityLocked?: boolean; isGuest?: boolean;
  personas: {id: string; name: string; dept: string}[];
}) {
  return <div className="lobby-page"><div className="lobby-page-heading"><span className="page-kicker">LET'S CONNECT</span><h1>{intent === 'create' ? 'Mulai percakapan baru.' : 'Tim kamu sudah menunggu.'}</h1><p>Siapkan identitas, periksa kamera dan mikrofon, lalu masuk ke ruang rapat.</p></div>
    <div className="lobby-layout"><section className="lobby-preview"><div className="preview-photo" /><div className="preview-heading"><span className="preview-live-dot" /> SIAPKAN RUANG KOLABORASI</div>{mediaPreview}<div className="preview-footer"><Mic size={15} /><span>Gunakan headset untuk suara yang lebih jernih.</span></div></section>
      <section className="lobby-card">{!isGuest && <div className="lobby-switch" role="group" aria-label="Pilih aksi rapat"><button className={intent === 'create' ? 'selected' : ''} onClick={() => onIntentChange('create')}><Plus size={16} />Buat rapat</button><button className={intent === 'join' ? 'selected' : ''} onClick={() => onIntentChange('join')}><LogIn size={16} />Gabung rapat</button></div>}<h2>{intent === 'create' ? 'Buat ruang untuk timmu' : 'Gabung ke ruang rapat'}</h2><p className="lobby-intro">{intent === 'create' ? 'Peserta dapat bergabung menggunakan nama ruang yang sama.' : 'Masukkan nama ruang yang dibagikan penyelenggara.'}</p>
        <form onSubmit={event => { event.preventDefault(); onJoin(); }}>
          <div className="form-grid">{!isGuest && <label>NIK karyawan<input autoComplete="username" readOnly={identityLocked} value={employeeId} onChange={event => setEmployeeId(event.target.value)} placeholder="Contoh: BT-10492" required /></label>}<label>Nama lengkap<input autoComplete="name" readOnly={identityLocked} value={employeeName} onChange={event => setEmployeeName(event.target.value)} placeholder="Masukkan nama kamu" required /></label></div>
          {!isGuest && <label className="form-field">Departemen<select required disabled={identityLocked} value={department} onChange={event => setDepartment(event.target.value)}><option value="">Pilih departemen</option>{identityLocked && <option value={department}>{department}</option>}<option>NOC & Core Network</option><option>Field Transmission</option><option>Fiber Infrastructure</option><option>Project Management</option><option>IT Operations</option></select></label>}
          <label className="form-field">{intent === 'create' ? 'Nama ruang rapat' : 'Kode / nama ruang'}<input readOnly={isGuest} value={roomName} onChange={event => setRoomName(event.target.value)} placeholder={intent === 'create' ? 'Contoh: koordinasi-jaringan' : 'Masukkan nama ruang dari tim'} required /></label>
          <div className="form-note"><AudioLines size={18} /><span>Pilihan perangkat dan status mic/kamera di preview dipakai saat masuk. Preview berhenti sebelum koneksi dimulai. Kamu bisa bergabung dengan kamera atau mikrofon nonaktif.</span></div>
          {joinError && <div className="form-error" role="alert">{joinError}</div>}
          <button className="button-primary full-width lobby-submit" disabled={isJoining} type="submit" aria-busy={isJoining}>{isJoining ? <><Loader2 className="ui-spinner" size={16} aria-hidden="true" />Menghubungkan...</> : <>{intent === 'create' ? 'Mulai rapat' : 'Gabung rapat'}<ArrowRight size={17} /></>}</button>
        </form>
        {import.meta.env.DEV && !identityLocked && <details className="dev-tools"><summary>Data demo untuk pengujian lokal</summary><div className="persona-list">{personas.map(persona => <button key={persona.id} onClick={() => { setEmployeeId(persona.id); setEmployeeName(persona.name); setDepartment(persona.dept); }}><strong>{persona.name}</strong><span>{persona.id}</span></button>)}</div></details>}
      </section>
    </div>
  </div>;
}
