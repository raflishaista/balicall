import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Cloud, Info, LockKeyhole, Mic, Monitor, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, UserRound, Video, Volume2 } from 'lucide-react';
import { initials } from './presentation';
import { DEFAULT_PREFERENCES, transcriptionModelLabel } from './preferences';
import type { MeetingPreferences } from './preferences';
import type { AuthUser } from './AuthGate';
import './SettingsPage.css';

const categories = [
  { id: 'devices', title: 'Audio & Video', description: 'Perangkat dan kondisi awal saat bergabung.', Icon: Video, available: true },
  { id: 'display', title: 'Tampilan Rapat', description: 'Sorotan pembicara, preview kamera, dan animasi.', Icon: Monitor, available: true },
  { id: 'notifications', title: 'Notifikasi', description: 'Pengingat jadwal selama aplikasi terbuka.', Icon: Bell, available: true },
  { id: 'ai', title: 'AI & Notulen', description: 'Bahasa dan pilihan transkripsi default.', Icon: Sparkles, available: true },
  { id: 'storage', title: 'Rekaman & Penyimpanan', description: 'Kebijakan rekaman dan retensi perusahaan.', Icon: Cloud, available: false },
  { id: 'security', title: 'Keamanan & Akses', description: 'Akun, sesi perangkat, dan hak akses.', Icon: ShieldCheck, available: false },
] as const;
type Section = 'overview' | 'profile' | 'devices' | 'display' | 'notifications' | 'ai';

export function SettingsPage({ preferences, notice, employeeId, employeeName, department, authUser, transcription, onSave, onCheckDevices }: {
  preferences: MeetingPreferences; notice: string | null; employeeId: string; employeeName: string; department: string;
  authUser?: AuthUser | null;
  transcription: { configured: boolean; models: string[]; defaultModel: string } | null;
  onSave: (value: MeetingPreferences) => boolean;
  onCheckDevices: (value: MeetingPreferences) => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef<Section>('overview');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(() => ({ ...preferences }));
  const [saved, setSaved] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);
  const outputSupported = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
  const update = (patch: Partial<MeetingPreferences>) => { setDraft(previous => ({ ...previous, ...patch })); setSaved(false); };
  const save = () => { const success = onSave(draft); setSaved(success); return success; };

  useEffect(() => {
    if (previousSection.current !== section) headingRef.current?.focus();
    previousSection.current = section;
  }, [section]);

  useEffect(() => {
    if (section !== 'devices') return;
    let cancelled = false;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      setLoading(true);
      try {
        if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Device enumeration unavailable');
        const available = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled && request === sequence) { setDevices(available); setDeviceError(null); }
      } catch { if (!cancelled && request === sequence) setDeviceError('Daftar perangkat belum tersedia. Gunakan HTTPS atau localhost dan periksa izin browser.'); }
      finally { if (!cancelled && request === sequence) setLoading(false); }
    };
    void refresh();
    const changed = () => { void refresh(); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => { cancelled = true; navigator.mediaDevices?.removeEventListener('devicechange', changed); };
  }, [section, refreshKey]);

  const visibleCategories = authUser ? [{ id: 'profile', title: 'Profil pengguna', description: 'Identitas perusahaan dari sesi login kamu.', Icon: UserRound, available: true }, ...categories] : categories;
  const filtered = visibleCategories.filter(category => `${category.title} ${category.description}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID')));
  const profileName = authUser ? authUser.name : employeeName;
  const profileDepartment = authUser ? authUser.department : department;
  return <div className="settings-page">
    <header className="settings-heading"><div><p className="page-kicker">{section === 'profile' ? 'AKUN PERUSAHAAN' : 'PREFERENSI WORKSPACE'}</p><h1 ref={headingRef} tabIndex={-1}>{section === 'profile' ? 'Profil pengguna' : 'Pengaturan'}</h1><p>{section === 'profile' ? 'Identitas akun yang digunakan untuk rapat.' : 'Siapkan pengalaman rapat yang nyaman untuk kamu.'}</p></div><span className="settings-local-badge">{section === 'profile' ? <><ShieldCheck size={15} />Sesi login aktif</> : <><Monitor size={15} />Browser ini</>}</span></header>
    {notice && <p className="settings-notice" role="alert"><Info size={18} />{notice}</p>}
    {section === 'overview' ? <>
      <label className="settings-search"><Search size={18} /><input aria-label="Cari pengaturan" placeholder="Cari pengaturan…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="settings-overview">
        <section className="settings-profile surface-card" aria-labelledby="settings-profile-heading"><div className="settings-profile-avatar" aria-hidden="true">{initials(profileName)}</div><h2 id="settings-profile-heading">{profileName || (authUser ? 'Nama belum tersedia' : 'Identitas rapat')}</h2><p>{profileDepartment || (authUser ? 'Departemen belum tersedia' : 'Isi identitas saat bergabung ke rapat.')}</p><dl><div><dt>NIK</dt><dd>{(authUser ? authUser.employeeId : employeeId) || (authUser ? 'Belum tersedia' : 'Belum diisi')}</dd></div>{authUser && <><div><dt>Email</dt><dd>{authUser.email || 'Belum tersedia'}</dd></div><div><dt>Jabatan</dt><dd>{authUser.position || 'Belum tersedia'}</dd></div></>}<div><dt>Departemen</dt><dd>{profileDepartment || 'Belum tersedia'}</dd></div></dl><div className="settings-profile-note">{authUser ? <ShieldCheck size={17} /> : <UserRound size={17} />}<p>{authUser ? 'Identitas perusahaan dari sesi login. Koreksi data dilakukan melalui admin.' : 'Identitas dari formulir rapat. Pengelolaan profil perusahaan tersedia setelah integrasi akun.'}</p></div>{authUser && <button className="button-secondary settings-profile-open" onClick={() => setSection('profile')}>Lihat profil <ChevronRight size={16} /></button>}</section>
        <div className="settings-category-grid">{filtered.length ? filtered.map(({ id, title, description, Icon, available }) => available
          ? <button className="settings-category" key={id} onClick={() => setSection(id as Section)}><span className="settings-category-icon"><Icon size={23} /></span><span><strong>{title}</strong><small>{description}</small><em>Tersedia</em></span><ChevronRight size={18} /></button>
          : <article className="settings-category settings-category-planned" key={id}><span className="settings-category-icon"><Icon size={23} /></span><div><h2>{title}</h2><p>{description}</p><span className="settings-planned-label">Menunggu integrasi</span></div><LockKeyhole size={16} aria-hidden="true" /></article>) : <p className="settings-empty" role="status">Pengaturan tidak ditemukan. Coba kata lain.</p>}</div>
      </div>
      <p className="settings-footnote"><Info size={17} />Preferensi perangkat, tampilan, pengingat, dan transkripsi disimpan di browser ini. Kebijakan perusahaan dikelola oleh admin.</p>
    </> : <>
      <button className="back-link settings-back" onClick={() => setSection('overview')}><ArrowLeft size={17} />Semua pengaturan</button>
      <div className="settings-detail-layout">
        <nav className="settings-sections" aria-label="Kategori pengaturan">{authUser && <button aria-current={section === 'profile' ? 'page' : undefined} onClick={() => setSection('profile')}><UserRound size={18} />Profil pengguna</button>}<button aria-current={section === 'devices' ? 'page' : undefined} onClick={() => setSection('devices')}><Video size={18} />Audio & Video</button><button aria-current={section === 'display' ? 'page' : undefined} onClick={() => setSection('display')}><Monitor size={18} />Tampilan Rapat</button><button aria-current={section === 'notifications' ? 'page' : undefined} onClick={() => setSection('notifications')}><Bell size={18} />Notifikasi</button><button aria-current={section === 'ai' ? 'page' : undefined} onClick={() => setSection('ai')}><Sparkles size={18} />AI & Notulen</button></nav>
        {section === 'profile' ? authUser && <section className="settings-profile-detail surface-card" aria-labelledby="profile-detail-heading">
          <div className="settings-form-heading"><span className="settings-category-icon"><UserRound size={24} /></span><div><h2 id="profile-detail-heading">Identitas perusahaan</h2><p>Data akun dari sesi login aktif.</p></div></div>
          <div className="settings-profile-identity"><div className="settings-profile-avatar" aria-hidden="true">{initials(authUser.name)}</div><div><h3>{authUser.name || 'Belum tersedia'}</h3><p>{authUser.department || 'Departemen belum tersedia'}</p><span className="settings-verified-label"><ShieldCheck size={15} />Akun terautentikasi</span></div></div>
          <dl className="settings-profile-data">{[['Nama lengkap', authUser.name], ['NIK', authUser.employeeId], ['Email perusahaan', authUser.email], ['Departemen', authUser.department], ['Jabatan', authUser.position]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value?.trim() || 'Belum tersedia'}</dd></div>)}</dl>
          <div className="settings-profile-note"><Info size={18} /><p>Data profil ditampilkan dari akun perusahaan dan tidak dapat diubah di halaman ini. Jika ada data yang kurang tepat, hubungi admin perusahaan dengan menyertakan NIK kamu.</p></div>
        </section> : <form className="settings-form surface-card" onSubmit={event => { event.preventDefault(); save(); }}>
          <div className="settings-form-heading"><span className="settings-category-icon">{section === 'devices' ? <Video size={24} /> : section === 'notifications' ? <Bell size={24} /> : section === 'ai' ? <Sparkles size={24} /> : <Monitor size={24} />}</span><div><h2>{section === 'devices' ? 'Audio & Video' : section === 'notifications' ? 'Notifikasi' : section === 'ai' ? 'AI & Notulen' : 'Tampilan Rapat'}</h2><p>{section === 'devices' ? 'Pilihan default untuk rapat berikutnya.' : section === 'notifications' ? 'Pengingat jadwal di browser ini.' : section === 'ai' ? 'Pilihan awal transkripsi untuk rapat berikutnya.' : 'Atur cara kamu melihat peserta dan aktivitas rapat.'}</p></div></div>
          {section === 'devices' ? <>
            <fieldset className="settings-fields"><legend>Perangkat default</legend>
              <PreferenceDevice label="Mikrofon default" Icon={Mic} kind="audioinput" value={draft.microphoneId} devices={devices} disabled={loading} onChange={microphoneId => update({ microphoneId })} />
              <PreferenceDevice label="Kamera default" Icon={Video} kind="videoinput" value={draft.cameraId} devices={devices} disabled={loading} onChange={cameraId => update({ cameraId })} />
              <PreferenceDevice label="Speaker / headset default" Icon={Volume2} kind="audiooutput" value={draft.outputId} devices={devices} disabled={loading || !outputSupported} onChange={outputId => update({ outputId })} />
              {!outputSupported && <p className="settings-field-help">Pemilihan output belum didukung browser ini. Suara mengikuti output sistem.</p>}
              {deviceError && <p className="settings-notice" role="alert">{deviceError}</p>}
              <button className="settings-refresh" type="button" disabled={loading} onClick={() => setRefreshKey(key => key + 1)}><RefreshCw size={15} />{loading ? 'Memuat perangkat…' : 'Perbarui daftar perangkat'}</button>
              <p className="settings-field-help">Nama perangkat mengikuti izin browser. Membuka halaman ini tidak menyalakan mikrofon atau kamera. Jika perangkat pilihan tidak tersedia, periksa pilihan sebelum bergabung.</p>
            </fieldset>
            <fieldset className="settings-fields"><legend>Saat bergabung</legend><PreferenceToggle label="Aktifkan mikrofon saat bergabung" description="Kamu dapat mengubahnya lagi di preview sebelum masuk." checked={draft.microphoneEnabled} onChange={microphoneEnabled => update({ microphoneEnabled })} /><PreferenceToggle label="Aktifkan kamera saat bergabung" description="Kamera mulai setelah kamu memilih bergabung dan memberi izin." checked={draft.cameraEnabled} onChange={cameraEnabled => update({ cameraEnabled })} /></fieldset>
            <div className="settings-check-devices"><div><strong>Pastikan suara dan gambar siap.</strong><p>Simpan pilihan, lalu gunakan preview kamera dan tes mikrofon sebelum rapat.</p></div><button type="button" className="button-secondary" onClick={() => { if (save()) onCheckDevices(draft); }}>Simpan & periksa perangkat <ArrowRight size={16} /></button></div>
          </> : section === 'ai' ? <AISettings draft={draft} update={update} transcription={transcription} /> : section === 'notifications' ? <fieldset className="settings-fields"><legend>Pengingat dalam aplikasi</legend><PreferenceToggle label="Pengingat jadwal rapat" description="Tampilkan pengingat 10 menit sebelum jadwal yang tersedia di aplikasi." checked={draft.scheduleReminders} onChange={scheduleReminders => update({ scheduleReminders })} /><p className="settings-field-help">Berlaku selama aplikasi terbuka. Jadwal diperiksa setiap 30 detik dan saat tab dibuka kembali. Pengingat tidak ditampilkan saat berada dalam panggilan. Undangan, notifikasi sistem/background, dan pengiriman lintas perangkat menunggu integrasi layanan perusahaan.</p></fieldset> : <fieldset className="settings-fields"><legend>Pengalaman rapat</legend><p className="settings-field-help">Rapat dimulai dengan Grid agar semua peserta setara. Pilih Speaker di ruang rapat untuk mengikuti pembicara aktif. Berbagi layar selalu mendapat area utama.</p><PreferenceToggle label="Cerminkan video kamera sendiri" description="Berlaku pada preview dan video lokal. Video peserta lain tetap sesuai aslinya." checked={draft.mirrorLocalVideo} onChange={mirrorLocalVideo => update({ mirrorLocalVideo })} /><PreferenceToggle label="Kurangi animasi" description="Kurangi gerakan antarmuka. Preferensi pengurangan gerakan dari sistem tetap dihormati." checked={draft.reduceMotion} onChange={reduceMotion => update({ reduceMotion })} /></fieldset>}
          <footer className="settings-save-bar"><p role="status">{dirty ? 'Perubahan belum disimpan' : saved ? <><Check size={16} />Preferensi tersimpan</> : section === 'notifications' ? 'Pengingat mengikuti preferensi tersimpan' : 'Preferensi berlaku untuk rapat berikutnya'}</p><div><button type="button" className="settings-reset" onClick={() => { setDraft({ ...DEFAULT_PREFERENCES }); setSaved(false); }}>Default</button><button type="button" className="button-secondary" disabled={!dirty} onClick={() => { setDraft({ ...preferences }); setSaved(false); }}>Batal</button><button type="submit" className="button-primary" disabled={!dirty}><Settings2 size={16} />Simpan perubahan</button></div></footer>
        </form>}
      </div>
    </>}
  </div>;
}

function PreferenceToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></label>;
}

function PreferenceDevice({ label, Icon, kind, value, devices, disabled, onChange }: { label: string; Icon: typeof Mic; kind: MediaDeviceKind; value: string; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (value: string) => void }) {
  const choices = devices.filter((device, index, all) => device.kind === kind && device.deviceId && device.deviceId !== 'default' && all.findIndex(other => other.kind === kind && other.deviceId === device.deviceId) === index);
  const missing = value !== 'default' && !choices.some(device => device.deviceId === value);
  return <label className="settings-device-field"><span><Icon size={17} />{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="default">Default — perangkat sistem</option>{missing && <option value={value}>Pilihan tersimpan — belum tersedia</option>}{choices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Perangkat ${index + 1} (izin belum diberikan)`}</option>)}</select>{missing && <small>Perangkat tersimpan tidak terlihat. Sambungkan perangkat atau pilih default.</small>}</label>;
}

function AISettings({ draft, update, transcription }: {
  draft: MeetingPreferences; update: (patch: Partial<MeetingPreferences>) => void;
  transcription: { configured: boolean; models: string[]; defaultModel: string } | null;
}) {
  const models = transcription?.models || [];
  const missingModel = Boolean(draft.transcriptionModel && !models.includes(draft.transcriptionModel));
  return <>
    <fieldset className="settings-fields"><legend>Transkripsi default</legend>
      <label className="settings-device-field"><span>Bahasa transkripsi</span><select aria-label="Bahasa transkripsi" value={draft.speechLanguage} onChange={event => update({ speechLanguage: event.target.value as MeetingPreferences['speechLanguage'] })}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
      <label className="settings-device-field"><span>Layanan transkripsi</span><select aria-label="Layanan transkripsi" value={draft.transcriptionProvider} onChange={event => update({ transcriptionProvider: event.target.value as MeetingPreferences['transcriptionProvider'] })}><option value="auto">Otomatis — ikuti default server</option><option value="browser">Browser</option><option value="server" disabled={!transcription?.configured}>Server{!transcription?.configured ? ' · belum tersedia' : ''}</option></select></label>
      <label className="settings-device-field"><span>Model transkripsi default</span><select aria-label="Model transkripsi default" value={draft.transcriptionModel} disabled={!transcription?.configured || draft.transcriptionProvider === 'browser'} onChange={event => update({ transcriptionModel: event.target.value })}><option value="">Ikuti default server{transcription?.defaultModel ? ` — ${transcriptionModelLabel(transcription.defaultModel)}` : ''}</option>{missingModel && <option value={draft.transcriptionModel} disabled>{draft.transcriptionModel} · pilihan tersimpan belum tersedia</option>}{models.map(model => <option key={model} value={model}>{transcriptionModelLabel(model)}</option>)}</select></label>
      <p className="settings-field-help" role="status">{!transcription ? 'Konfigurasi layanan belum dapat diperiksa. Pilihan Otomatis dan Browser tetap tersedia.' : !transcription.configured ? 'Layanan Server belum dikonfigurasi. Jika dipilih sebelumnya, rapat memakai Browser.' : 'Pilihan model mengikuti konfigurasi server. Kesiapan pemrosesan suara diperiksa saat digunakan dalam rapat.'}</p>
      {missingModel && <p className="settings-notice" role="status">Model tersimpan belum tersedia. Rapat berikutnya memakai model default yang tersedia.</p>}
      <p className="settings-field-help">Model berlaku saat layanan Server digunakan. Kamu tetap dapat mengganti bahasa, layanan, dan model di ruang rapat. Perubahan di ruang rapat tidak mengubah default ini.</p>
    </fieldset>
    <fieldset className="settings-fields"><legend>Hasil notulen</legend><p className="settings-field-help">Format notulen mengikuti layanan AI perusahaan. Pengaturan ini tidak mengubah format laporan, hak host, perekaman, atau kebijakan transkripsi rapat.</p></fieldset>
  </>;
}
