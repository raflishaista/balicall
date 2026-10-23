import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Cloud, Film, HardDrive, Info, Lock, LockKeyhole, LogOut, Mic, Monitor, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, UserRound, Video, Volume2 } from 'lucide-react';
import { initials } from './presentation';
import { DEFAULT_PREFERENCES, transcriptionModelLabel, supportsSharedMicrophone, qwenDiarizationForModel, QWEN_TRANSCRIPTION_NOTICE, QWEN_DIARIZATION_NOTICE, QWEN_LIVE_DIARIZATION_NOTICE } from './preferences';
import type { MeetingPreferences } from './preferences';
import type { AuthUser } from './AuthGate';
import './SettingsPage.css';
import { ProfileEditor, UserAvatar } from './ProfileEditor';
import { PushSettings } from './NotificationCenter';
import { AIServicesPanel } from './AIServicesPanel';
import { TranscriptionModelOptions } from './TranscriptionModelOptions';
import { SEA_LIVE_MODEL, SEA_LIVE_NOTICE, modelPreferencePatch } from './modelSelection';
import type { useBackendHealth } from './useBackendHealth';
import { accountKey } from './accountScope';
import { HISTORY_KEY } from './summaryHistory';

const categories = [
  { id: 'devices', title: 'Audio & Video', description: 'Perangkat dan kondisi awal saat bergabung.', Icon: Video, available: true },
  { id: 'display', title: 'Tampilan Rapat', description: 'Sorotan pembicara, preview kamera, dan animasi.', Icon: Monitor, available: true },
  { id: 'notifications', title: 'Notifikasi', description: 'Inbox akun, pengingat dan notifikasi perangkat.', Icon: Bell, available: true },
  { id: 'ai', title: 'AI & Notulen', description: 'Bahasa dan pilihan transkripsi default.', Icon: Sparkles, available: true },
  { id: 'storage', title: 'Rekaman & Penyimpanan', description: 'Perekaman rapat, unggahan MP4, dan data notulen.', Icon: Cloud, available: true },
  { id: 'security', title: 'Keamanan & Akses', description: 'Kontrol akses rapat, privasi, dan status sesi.', Icon: ShieldCheck, available: true },
] as const;
type Section = 'overview' | 'profile' | 'devices' | 'display' | 'notifications' | 'ai' | 'storage' | 'security';

export function SettingsPage({ preferences, notice, employeeId, employeeName, department, authUser, transcription, aiStatus, onSave, onCheckDevices, onProfileUpdated, onOpenRecordings, onLogout, logoutPending }: {
  preferences: MeetingPreferences; notice: string | null; employeeId: string; employeeName: string; department: string;
  authUser?: AuthUser | null; onProfileUpdated?: (user:AuthUser)=>void;
  transcription: { configured: boolean; models: string[]; defaultModel: string } | null;
  aiStatus?: ReturnType<typeof useBackendHealth>;
  onSave: (value: MeetingPreferences) => boolean;
  onCheckDevices: (value: MeetingPreferences) => void;
  onOpenRecordings?: () => void;
  onLogout?: () => Promise<void>;
  logoutPending?: boolean;
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
        <section className="settings-profile surface-card" aria-labelledby="settings-profile-heading"><div className="settings-profile-avatar" aria-hidden="true">{authUser ? <UserAvatar user={authUser}/> : initials(profileName)}</div><h2 id="settings-profile-heading">{profileName || (authUser ? 'Nama belum tersedia' : 'Identitas rapat')}</h2><p>{profileDepartment || (authUser ? 'Departemen belum tersedia' : 'Isi identitas saat bergabung ke rapat.')}</p><dl><div><dt>NIK</dt><dd>{(authUser ? authUser.employeeId : employeeId) || (authUser ? 'Belum tersedia' : 'Belum diisi')}</dd></div>{authUser && <><div><dt>Email</dt><dd>{authUser.email || 'Belum tersedia'}</dd></div><div><dt>Jabatan</dt><dd>{authUser.position || 'Belum tersedia'}</dd></div></>}<div><dt>Departemen</dt><dd>{profileDepartment || 'Belum tersedia'}</dd></div></dl><div className="settings-profile-note">{authUser ? <ShieldCheck size={17} /> : <UserRound size={17} />}<p>{authUser ? 'Identitas perusahaan dari sesi login. Koreksi data dilakukan melalui admin.' : 'Identitas dari formulir rapat. Pengelolaan profil perusahaan tersedia setelah integrasi akun.'}</p></div>{authUser && <button className="button-secondary settings-profile-open" onClick={() => setSection('profile')}>Lihat profil <ChevronRight size={16} /></button>}</section>
        <div className="settings-category-grid">{filtered.length ? filtered.map(({ id, title, description, Icon, available }) => available
          ? <button className="settings-category" key={id} onClick={() => setSection(id as Section)}><span className="settings-category-icon"><Icon size={23} /></span><span><strong>{title}</strong><small>{description}</small><em>Tersedia</em></span><ChevronRight size={18} /></button>
          : <article className="settings-category settings-category-planned" key={id}><span className="settings-category-icon"><Icon size={23} /></span><div><h2>{title}</h2><p>{description}</p><span className="settings-planned-label">Menunggu integrasi</span></div><LockKeyhole size={16} aria-hidden="true" /></article>) : <p className="settings-empty" role="status">Pengaturan tidak ditemukan. Coba kata lain.</p>}</div>
      </div>
      <p className="settings-footnote"><Info size={17} />Preferensi perangkat, tampilan, pengingat, dan transkripsi disimpan di browser ini. Kebijakan perusahaan dikelola oleh admin.</p>
    </> : <>
      <button className="back-link settings-back" onClick={() => setSection('overview')}><ArrowLeft size={17} />Semua pengaturan</button>
      <div className="settings-detail-layout">
        <nav className="settings-sections" aria-label="Kategori pengaturan">
          {authUser && <button aria-current={section === 'profile' ? 'page' : undefined} onClick={() => setSection('profile')}><UserRound size={18} />Profil pengguna</button>}
          <button aria-current={section === 'devices' ? 'page' : undefined} onClick={() => setSection('devices')}><Video size={18} />Audio & Video</button>
          <button aria-current={section === 'display' ? 'page' : undefined} onClick={() => setSection('display')}><Monitor size={18} />Tampilan Rapat</button>
          <button aria-current={section === 'notifications' ? 'page' : undefined} onClick={() => setSection('notifications')}><Bell size={18} />Notifikasi</button>
          <button aria-current={section === 'ai' ? 'page' : undefined} onClick={() => setSection('ai')}><Sparkles size={18} />AI & Notulen</button>
          <button aria-current={section === 'storage' ? 'page' : undefined} onClick={() => setSection('storage')}><Cloud size={18} />Rekaman & Penyimpanan</button>
          <button aria-current={section === 'security' ? 'page' : undefined} onClick={() => setSection('security')}><ShieldCheck size={18} />Keamanan & Akses</button>
        </nav>
        {section === 'profile' ? authUser && <ProfileEditor user={authUser} onUpdated={onProfileUpdated}/> : <form className="settings-form surface-card" onSubmit={event => { event.preventDefault(); save(); }}>
          <div className="settings-form-heading">
            <span className="settings-category-icon">
              {section === 'devices' ? <Video size={24} /> :
               section === 'notifications' ? <Bell size={24} /> :
               section === 'ai' ? <Sparkles size={24} /> :
               section === 'storage' ? <Cloud size={24} /> :
               section === 'security' ? <ShieldCheck size={24} /> :
               <Monitor size={24} />}
            </span>
            <div>
              <h2>
                {section === 'devices' ? 'Audio & Video' :
                 section === 'notifications' ? 'Notifikasi' :
                 section === 'ai' ? 'AI & Notulen' :
                 section === 'storage' ? 'Rekaman & Penyimpanan' :
                 section === 'security' ? 'Keamanan & Akses' :
                 'Tampilan Rapat'}
              </h2>
              <p>
                {section === 'devices' ? 'Pilihan default untuk rapat berikutnya.' :
                 section === 'notifications' ? 'Pengingat jadwal di browser ini.' :
                 section === 'ai' ? 'Pilihan awal transkripsi untuk rapat berikutnya.' :
                 section === 'storage' ? 'Atur perekaman rapat, unggahan file, dan penyimpanan hasil notulen.' :
                 section === 'security' ? 'Kelola kontrol izin ruang rapat, privasi perangkat, dan status sesi.' :
                 'Atur cara kamu melihat peserta dan aktivitas rapat.'}
              </p>
            </div>
          </div>
          {section === 'notifications' && authUser && <PushSettings/>}
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
          </> : section === 'ai' ? (
            <AISettings draft={draft} update={update} transcription={transcription} aiStatus={aiStatus} />
          ) : section === 'notifications' ? (
            <fieldset className="settings-fields"><legend>Pengingat dalam aplikasi</legend><PreferenceToggle label="Pengingat jadwal rapat" description="Tampilkan pengingat 10 menit sebelum jadwal yang tersedia di aplikasi." checked={draft.scheduleReminders} onChange={scheduleReminders => update({ scheduleReminders })} /><p className="settings-field-help">Berlaku selama aplikasi terbuka. Jadwal diperiksa setiap 30 detik dan saat tab dibuka kembali. Pengingat tidak ditampilkan saat berada dalam panggilan. Inbox undangan dan notulen tersedia untuk akun login. Aktifkan Web Push pada setiap perangkat untuk menerima notifikasi sistem.</p></fieldset>
          ) : section === 'storage' ? (
            <StorageSettings draft={draft} update={update} onOpenRecordings={onOpenRecordings} authUser={authUser} />
          ) : section === 'security' ? (
            <SecuritySettings draft={draft} update={update} authUser={authUser} employeeId={employeeId} employeeName={employeeName} department={department} onLogout={onLogout} logoutPending={logoutPending} />
          ) : (
            <fieldset className="settings-fields"><legend>Pengalaman rapat</legend><p className="settings-field-help">Rapat dimulai dengan Grid agar semua peserta setara. Pilih Speaker di ruang rapat untuk mengikuti pembicara aktif. Berbagi layar selalu mendapat area utama.</p><PreferenceToggle label="Cerminkan video kamera sendiri" description="Berlaku pada preview dan video lokal. Video peserta lain tetap sesuai aslinya." checked={draft.mirrorLocalVideo} onChange={mirrorLocalVideo => update({ mirrorLocalVideo })} /><PreferenceToggle label="Kurangi animasi" description="Kurangi gerakan antarmuka. Preferensi pengurangan gerakan dari sistem tetap dihormati." checked={draft.reduceMotion} onChange={reduceMotion => update({ reduceMotion })} /></fieldset>
          )}
          <footer className="settings-save-bar"><p role="status">{dirty ? 'Perubahan belum disimpan' : saved ? <><Check size={16} />Preferensi tersimpan</> : section === 'notifications' ? 'Pengingat mengikuti preferensi tersimpan' : 'Preferensi berlaku untuk rapat berikutnya'}</p><div><button type="button" className="settings-reset" onClick={() => { setDraft({ ...DEFAULT_PREFERENCES }); setSaved(false); }}>Default</button><button type="button" className="button-secondary" disabled={!dirty} onClick={() => { setDraft({ ...preferences }); setSaved(false); }}>Batal</button><button type="submit" className="button-primary" disabled={!dirty}><Settings2 size={16} />Simpan perubahan</button></div></footer>
        </form>}
      </div>
    </>}
  </div>;
}

function PreferenceToggle({ label, description, checked, disabled = false, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></label>;
}

function PreferenceDevice({ label, Icon, kind, value, devices, disabled, onChange }: { label: string; Icon: typeof Mic; kind: MediaDeviceKind; value: string; devices: MediaDeviceInfo[]; disabled: boolean; onChange: (value: string) => void }) {
  const choices = devices.filter((device, index, all) => device.kind === kind && device.deviceId && device.deviceId !== 'default' && all.findIndex(other => other.kind === kind && other.deviceId === device.deviceId) === index);
  const missing = value !== 'default' && !choices.some(device => device.deviceId === value);
  return <label className="settings-device-field"><span><Icon size={17} />{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="default">Default — perangkat sistem</option>{missing && <option value={value}>Pilihan tersimpan — belum tersedia</option>}{choices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Perangkat ${index + 1} (izin belum diberikan)`}</option>)}</select>{missing && <small>Perangkat tersimpan tidak terlihat. Sambungkan perangkat atau pilih default.</small>}</label>;
}

function AISettings({ draft, update, transcription, aiStatus }: {
  draft: MeetingPreferences; update: (patch: Partial<MeetingPreferences>) => void;
  transcription: { configured: boolean; models: string[]; defaultModel: string } | null;
  aiStatus?: ReturnType<typeof useBackendHealth>;
}) {
  const models = transcription?.models || [];
  const isQwen = (draft.transcriptionModel || transcription?.defaultModel) === 'qwen3-asr-0.6b';
  const sharedMicSupported = supportsSharedMicrophone(draft.transcriptionModel || transcription?.defaultModel, qwenDiarizationForModel(draft.transcriptionModel || transcription?.defaultModel, aiStatus?.health))
    && (!isQwen || draft.transcriptionProvider === 'server');
  const missingModel = Boolean(draft.transcriptionModel && !models.includes(draft.transcriptionModel));
  return <>
    {aiStatus && <AIServicesPanel health={aiStatus.health} checking={aiStatus.checking} error={aiStatus.error} checkedAt={aiStatus.checkedAt} onRefresh={() => void aiStatus.refresh()} />}
    <fieldset className="settings-fields"><legend>Transkripsi default</legend>
      <label className="settings-device-field"><span>Bahasa transkripsi</span><select aria-label="Bahasa transkripsi" value={draft.speechLanguage} disabled={[SEA_LIVE_MODEL].includes(draft.transcriptionModel)} onChange={event => update({ speechLanguage: event.target.value as MeetingPreferences['speechLanguage'] })}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
      <label className="settings-device-field"><span>Layanan transkripsi</span><select aria-label="Layanan transkripsi" value={draft.transcriptionProvider} onChange={event => update({ transcriptionProvider: event.target.value as MeetingPreferences['transcriptionProvider'] })}><option value="auto">Otomatis — ikuti default server</option><option value="browser">Browser</option><option value="server" disabled={!transcription?.configured}>Server{!transcription?.configured ? ' · belum tersedia' : ''}</option></select></label>
      <label className="settings-device-field"><span>Model transkripsi default</span><select aria-label="Model transkripsi default" value={draft.transcriptionModel} disabled={!transcription?.configured || draft.transcriptionProvider === 'browser'} onChange={event => update(modelPreferencePatch(event.target.value))}><option value="">Ikuti default server{transcription?.defaultModel ? ` — ${transcriptionModelLabel(transcription.defaultModel)}` : ''}</option>{missingModel && ![SEA_LIVE_MODEL].includes(draft.transcriptionModel) && <option value={draft.transcriptionModel} disabled>{draft.transcriptionModel} · pilihan tersimpan belum tersedia</option>}<TranscriptionModelOptions models={models} /></select></label>
      {draft.transcriptionModel === SEA_LIVE_MODEL && !(draft.sharedRoomMic && sharedMicSupported) && <p role="status">{SEA_LIVE_NOTICE}</p>}
      <PreferenceToggle
        label="Mode Mikrofon Ruang Rapat (Diarization)"
        description="Pemisahan pembicara untuk mikrofon bersama. Memerlukan layanan Server dan model diarization yang aktif."
        checked={sharedMicSupported && (draft.sharedRoomMic ?? false)}
        disabled={!sharedMicSupported}
        onChange={sharedRoomMic => update({ sharedRoomMic })}
      />
      {!sharedMicSupported && ![SEA_LIVE_MODEL].includes(draft.transcriptionModel) && <p className="settings-notice" role="status">{QWEN_TRANSCRIPTION_NOTICE}</p>}
      {isQwen && sharedMicSupported && <p role="status">{QWEN_DIARIZATION_NOTICE}</p>}
      {draft.transcriptionModel === 'qwen3-asr-0.6b-live' && <p role="status">{QWEN_LIVE_DIARIZATION_NOTICE}</p>}
      {sharedMicSupported && draft.sharedRoomMic && (
        <div style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '12px', borderLeft: '2px solid #e2e8f0', marginLeft: '6px', margin: '8px 0 12px 6px' }}>
          <PreferenceToggle
            label="Diarisasi Langsung (Live / Normal)"
            description="Label mengikuti teks final selama rapat; dapat menunggu giliran bicara selesai."
            checked={draft.liveDiarization ?? true}
            onChange={liveDiarization => update({ liveDiarization })}
          />
          <PreferenceToggle
            label="Diarisasi Batch Pasca-Rapat (Post-Meeting)"
            description="Jalankan diarization penuh pada rekaman kontinu saat rapat berakhir untuk memastikan penomoran pembicara konsisten pada notulen."
            checked={!isQwen && draft.transcriptionModel !== SEA_LIVE_MODEL && (draft.batchDiarization ?? true)}
            disabled={isQwen || draft.transcriptionModel === SEA_LIVE_MODEL}
            onChange={batchDiarization => update({ batchDiarization })}
          />
        </div>
      )}
      <p className="settings-field-help">Browser dan WhisperLiveKit belum mendukung diarization pada alur ini. Pilihan Otomatis mengikuti layanan yang dipakai saat bergabung. Pada Qwen Live, label pembicara berlaku selama satu sesi mikrofon. Pada model berbasis potongan audio, label berlaku per potongan. Label ini tidak mengenali nama atau NIK karyawan.</p>
      <p className="settings-field-help" role="status">{!transcription ? 'Konfigurasi layanan belum dapat diperiksa. Pilihan Otomatis dan Browser tetap tersedia.' : !transcription.configured ? 'Layanan Server belum dikonfigurasi. Jika dipilih sebelumnya, rapat memakai Browser.' : 'Pilihan model mengikuti konfigurasi server. Kesiapan pemrosesan suara diperiksa saat digunakan dalam rapat.'}</p>
      {missingModel && <p className="settings-notice" role="status">Model tersimpan belum tersedia. Rapat berikutnya memakai model default yang tersedia.</p>}
      <p className="settings-field-help">Model berlaku saat layanan Server digunakan. Kamu tetap dapat mengganti bahasa, layanan, dan model di ruang rapat. Perubahan di ruang rapat tidak mengubah default ini.</p>
    </fieldset>
    <fieldset className="settings-fields"><legend>Hasil notulen</legend><p className="settings-field-help">Format notulen mengikuti layanan AI perusahaan. Pengaturan ini tidak mengubah format laporan, hak host, perekaman, atau kebijakan transkripsi rapat.</p></fieldset>
  </>;
}

function StorageSettings({
  draft,
  update,
  onOpenRecordings,
  authUser,
}: {
  draft: MeetingPreferences;
  update: (patch: Partial<MeetingPreferences>) => void;
  onOpenRecordings?: () => void;
  authUser?: AuthUser | null;
}) {
  const [cacheInfo, setCacheInfo] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = window.localStorage.getItem(accountKey(HISTORY_KEY));
      if (raw) {
        const parsed = JSON.parse(raw);
        setCacheInfo({
          count: Array.isArray(parsed) ? parsed.length : 0,
          bytes: new Blob([raw]).size,
        });
      } else {
        setCacheInfo({ count: 0, bytes: 0 });
      }
    } catch {
      setCacheInfo({ count: 0, bytes: 0 });
    }
  }, []);

  const handleClearCache = () => {
    if (!window.confirm('Hapus seluruh salinan riwayat notulen offline di browser ini? Notulen yang telah tersimpan di server tetap aman.')) return;
    try {
      window.localStorage.removeItem(accountKey(HISTORY_KEY));
      setCacheInfo({ count: 0, bytes: 0 });
      setCacheNotice('Riwayat notulen lokal berhasil dibersihkan.');
    } catch {
      setCacheNotice('Gagal membersihkan cache lokal.');
    }
  };

  const formattedBytes = cacheInfo.bytes >= 1024 * 1024
    ? `${(cacheInfo.bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(cacheInfo.bytes / 1024))} KB`;

  return (
    <>
      <fieldset className="settings-fields">
        <legend>Perekaman rapat langsung</legend>
        <PreferenceToggle
          label="Perekaman otomatis saat menjadi Host"
          description="Mulai perekaman rapat secara otomatis saat Anda membuka sesi panggilan sebagai host utama."
          checked={draft.autoRecordMeeting ?? false}
          onChange={autoRecordMeeting => update({ autoRecordMeeting })}
        />
        <PreferenceToggle
          label="Konfirmasi sebelum mulai merekam"
          description="Tampilkan dialog persetujuan saat tombol rekam ditekan agar semua peserta siap."
          checked={draft.recordingConsentPrompt ?? true}
          onChange={recordingConsentPrompt => update({ recordingConsentPrompt })}
        />
        <label className="settings-device-field">
          <span><Film size={17} />Format & kualitas rekaman rapat</span>
          <select
            aria-label="Format & kualitas rekaman rapat"
            value={draft.recordingQuality || 'standard'}
            onChange={event => update({ recordingQuality: event.target.value as MeetingPreferences['recordingQuality'] })}
          >
            <option value="standard">HD 720p (1280x720, 30 fps) — Standar seimbang</option>
            <option value="hd">Full HD 1080p (1920x1080, 30 fps) — Kualitas tinggi arsip</option>
            <option value="audio-only">Audio Saja (MP4 AAC) — Sangat hemat penyimpanan</option>
          </select>
        </label>
        <p className="settings-field-help">
          Perekaman rapat diproses oleh layanan LiveKit Egress server. Seluruh peserta akan melihat indikator visual '● Merekam' saat sesi aktif. Rekaman rapat disimpan di penyimpanan cloud internal perusahaan.
        </p>
      </fieldset>

      <fieldset className="settings-fields">
        <legend>Unggahan rekaman mandiri (STT & Notulen)</legend>
        {onOpenRecordings && (
          <div className="settings-check-devices" style={{ marginBottom: '18px' }}>
            <div>
              <strong>Kelola & transkripsi rekaman video (.mp4)</strong>
              <p>Unggah rekaman offline untuk diproses transkripsi dan rangkuman otomatis AI secara mandiri tanpa ruang rapat aktif.</p>
            </div>
            <button type="button" className="button-secondary" onClick={onOpenRecordings}>
              <UploadCloud size={16} /> Buka rekaman terunggah <ArrowRight size={16} />
            </button>
          </div>
        )}
        <label className="settings-device-field">
          <span>Bahasa transkripsi rekaman default</span>
          <select
            aria-label="Bahasa transkripsi rekaman default"
            value={draft.defaultRecordingLanguage || 'id'}
            onChange={event => update({ defaultRecordingLanguage: event.target.value as MeetingPreferences['defaultRecordingLanguage'] })}
          >
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="settings-device-field">
          <span>Pemisah pembicara default (Diarization)</span>
          <select
            aria-label="Pemisah pembicara default"
            value={draft.defaultRecordingDiarizer || 'none'}
            onChange={event => update({ defaultRecordingDiarizer: event.target.value as MeetingPreferences['defaultRecordingDiarizer'] })}
          >
            <option value="none">Tanpa pemisah pembicara</option>
            <option value="nemotron">Nemotron-3 (direkomendasikan)</option>
            <option value="pyannote">Pyannote</option>
          </select>
        </label>
        <p className="settings-field-help">
          File rekaman diunggah dan disimpan sementara di server hingga transkripsi dan perangkuman selesai. Setelah notulen berhasil dibuat, file video mentah otomatis dibersihkan demi efisiensi dan privasi data.{authUser ? ` Rekaman Anda dikaitkan dengan akun ${authUser.name} (${authUser.employeeId}).` : ''}
        </p>
      </fieldset>

      <fieldset className="settings-fields">
        <legend>Penyimpanan lokal & data notulen</legend>
        <PreferenceToggle
          label="Simpan salinan riwayat notulen di browser"
          description="Simpan hingga 20 notulen rapat terakhir di browser ini agar dapat dibuka kembali secara instan dan offline."
          checked={draft.saveSummaryOffline ?? true}
          onChange={saveSummaryOffline => update({ saveSummaryOffline })}
        />
        <PreferenceToggle
          label="Salin otomatis teks notulen ke clipboard"
          description="Otomatis salin ringkasan Markdown ke papan klip begitu proses perangkuman selesai."
          checked={draft.autoCopySummary ?? false}
          onChange={autoCopySummary => update({ autoCopySummary })}
        />

        <div className="settings-storage-box">
          <div className="settings-storage-info">
            <HardDrive size={18} />
            <div>
              <strong>Penyimpanan Browser Lokal</strong>
              <small>{cacheInfo.count > 0 ? `${cacheInfo.count} notulen tersimpan (${formattedBytes})` : 'Belum ada data notulen tersimpan di browser ini'}</small>
            </div>
          </div>
          {cacheInfo.count > 0 && (
            <button type="button" className="settings-danger-btn" onClick={handleClearCache}>
              <Trash2 size={15} /> Bersihkan cache riwayat
            </button>
          )}
        </div>
        {cacheNotice && <p className="settings-notice" role="status" style={{ marginTop: '12px' }}><Check size={16} />{cacheNotice}</p>}

        <p className="settings-field-help">
          Pembersihan cache hanya menghapus salinan offline di browser ini. Notulen yang tersimpan di database server tetap aman dan dapat dimuat ulang melalui riwayat rapat.
        </p>
      </fieldset>
    </>
  );
}

function SecuritySettings({
  draft,
  update,
  authUser,
  employeeId,
  employeeName,
  department,
  onLogout,
  logoutPending,
}: {
  draft: MeetingPreferences;
  update: (patch: Partial<MeetingPreferences>) => void;
  authUser?: AuthUser | null;
  employeeId: string;
  employeeName: string;
  department: string;
  onLogout?: () => Promise<void>;
  logoutPending?: boolean;
}) {
  const isGuest = Boolean(authUser?.isGuest || employeeId.startsWith('GUEST-'));

  return (
    <>
      <fieldset className="settings-fields">
        <legend>Status sesi & autentikasi</legend>
        <div className="settings-session-box">
          <div className="settings-session-meta">
            <span className={authUser && !isGuest ? 'settings-verified-label' : 'settings-planned-label'}>
              {authUser && !isGuest ? <ShieldCheck size={13} /> : <UserRound size={13} />}
              {authUser && !isGuest ? 'Akun Karyawan Terverifikasi' : isGuest ? 'Sesi Tamu Rapat' : 'Sesi Tamu / Tanpa Akun'}
            </span>
            <div className="settings-session-details">
              <strong>{authUser?.name || employeeName || 'Pengguna BaliCall'}</strong>
              <small>
                {authUser?.email ? `${authUser.email} · ` : ''}
                NIK: {authUser?.employeeId || employeeId || '-'} · {authUser?.department || department || 'Umum'}
              </small>
              <p className="settings-session-security-note">
                <Lock size={13} />
                {authUser && !isGuest
                  ? 'Sesi dilindungi Cookie HttpOnly & Token CSRF. Masa aktif sesi hingga 8 jam.'
                  : isGuest
                  ? 'Sesi tamu hanya memiliki akses terbatas pada rapat yang diundang.'
                  : 'Sesi browser tanpa login. Data profil hanya tersimpan di perangkat ini.'}
              </p>
            </div>
          </div>
          {onLogout && (authUser || isGuest) && (
            <button
              type="button"
              className="settings-danger-btn"
              disabled={logoutPending}
              onClick={() => void onLogout()}
            >
              <LogOut size={15} />
              {logoutPending ? 'Memproses keluar…' : isGuest ? 'Tinggalkan sesi tamu' : 'Keluar dari akun ini'}
            </button>
          )}
        </div>
        <p className="settings-field-help">
          Akun karyawan terhubung dengan direktori internal Bali Tower. Pembaruan nama legal atau departemen dikelola melalui administrator.
        </p>
      </fieldset>

      <fieldset className="settings-fields">
        <legend>Kontrol ruang rapat yang Anda buat</legend>
        <PreferenceToggle
          label="Izinkan peserta tamu (Guest Access)"
          description="Buka akses bagi peserta luar dengan kode undangan 22 karakter saat Anda membuat rapat."
          checked={draft.allowGuestJoin ?? true}
          onChange={allowGuestJoin => update({ allowGuestJoin })}
        />
        <PreferenceToggle
          label="Bisukan (mute) peserta lain saat bergabung"
          description="Otomatis nonaktifkan mikrofon peserta lain saat pertama kali memasuki ruang rapat Anda."
          checked={draft.muteOnJoin ?? false}
          onChange={muteOnJoin => update({ muteOnJoin })}
        />
        <PreferenceToggle
          label="Batasi berbagi layar hanya untuk Host & Co-host"
          description="Hanya Anda dan rekan co-host yang diizinkan untuk membagikan layar presentasi."
          checked={draft.hostOnlyScreenShare ?? false}
          onChange={hostOnlyScreenShare => update({ hostOnlyScreenShare })}
        />
        <PreferenceToggle
          label="Wajibkan persetujuan bicara untuk peserta tamu"
          description="Peserta tamu harus menekan 'Minta Izin Bicara' (Raise Hand) dan disetujui host sebelum dapat bersuara."
          checked={draft.requireSpeakApprovalForGuests ?? false}
          onChange={requireSpeakApprovalForGuests => update({ requireSpeakApprovalForGuests })}
        />
        <p className="settings-field-help">
          Preferensi di atas menjadi acuan default saat Anda membuat rapat baru sebagai host. Anda tetap dapat mempromosikan co-host, membisukan, atau mengeluarkan peserta secara manual dari panel peserta ruang rapat.
        </p>
      </fieldset>

      <fieldset className="settings-fields">
        <legend>Privasi & keamanan perangkat</legend>
        <PreferenceToggle
          label="Hentikan kamera & mikrofon seketika saat keluar"
          description="Segera rilis izin perangkat keras dan hentikan semua MediaStream browser saat Anda meninggalkan ruang rapat."
          checked={draft.autoReleaseDevicesOnLeave ?? true}
          onChange={autoReleaseDevicesOnLeave => update({ autoReleaseDevicesOnLeave })}
        />
        <PreferenceToggle
          label="Tampilkan lencana keamanan WebRTC di ruang rapat"
          description="Tampilkan indikator status koneksi terenkripsi DTLS-SRTP pada bilah status ruang rapat."
          checked={draft.showSecurityBadge ?? true}
          onChange={showSecurityBadge => update({ showSecurityBadge })}
        />

        <div className="settings-security-protocols">
          <strong><ShieldCheck size={16} /> Standar Keamanan & Perlindungan Data BaliCall</strong>
          <ul>
            <li><strong>Enkripsi Transport:</strong> Aliran audio, video, dan berbagi layar diamankan dengan protokol WebRTC DTLS 1.2 dan SRTP AES-128-GCM.</li>
            <li><strong>Isolasi Token:</strong> Kredensial ruangan menggunakan JSON Web Token (JWT) yang ditandatangani secara kriptografis dan berbatas waktu.</li>
            <li><strong>Privasi Transkripsi:</strong> Model inferensi suara (Whisper, SEA, Qwen) berjalan di server internal on-premise Bali Tower tanpa meneruskan rekaman suara ke pihak ketiga.</li>
          </ul>
        </div>
      </fieldset>
    </>
  );
}
