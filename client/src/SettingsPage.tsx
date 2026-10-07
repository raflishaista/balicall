import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Cloud, Info, LockKeyhole, Mic, Monitor, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, UserRound, Video, Volume2 } from 'lucide-react';
import { initials } from './presentation';
import { DEFAULT_PREFERENCES } from './preferences';
import type { MeetingPreferences } from './preferences';
import './SettingsPage.css';

const categories = [
  { id: 'devices', title: 'Audio & Video', description: 'Perangkat dan kondisi awal saat bergabung.', Icon: Video, available: true },
  { id: 'display', title: 'Tampilan Rapat', description: 'Sorotan pembicara, preview kamera, dan animasi.', Icon: Monitor, available: true },
  { id: 'notifications', title: 'Notifikasi', description: 'Pengingat, undangan, dan pemberitahuan rapat.', Icon: Bell, available: false },
  { id: 'ai', title: 'AI & Notulen', description: 'Bahasa, transkripsi, dan format hasil rapat.', Icon: Sparkles, available: false },
  { id: 'storage', title: 'Rekaman & Penyimpanan', description: 'Kebijakan rekaman dan retensi perusahaan.', Icon: Cloud, available: false },
  { id: 'security', title: 'Keamanan & Akses', description: 'Akun, sesi perangkat, dan hak akses.', Icon: ShieldCheck, available: false },
] as const;
type Section = 'overview' | 'devices' | 'display';

export function SettingsPage({ preferences, notice, employeeId, employeeName, department, onSave, onCheckDevices }: {
  preferences: MeetingPreferences; notice: string | null; employeeId: string; employeeName: string; department: string;
  onSave: (value: MeetingPreferences) => boolean;
  onCheckDevices: (value: MeetingPreferences) => void;
}) {
  const [section, setSection] = useState<Section>('overview');
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

  const filtered = categories.filter(category => `${category.title} ${category.description}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID')));
  return <div className="settings-page">
    <header className="settings-heading"><div><p className="page-kicker">PREFERENSI WORKSPACE</p><h1>Pengaturan</h1><p>Siapkan pengalaman rapat yang nyaman untuk kamu.</p></div><span className="settings-local-badge"><Monitor size={15} />Browser ini</span></header>
    {notice && <p className="settings-notice" role="alert"><Info size={18} />{notice}</p>}
    {section === 'overview' ? <>
      <label className="settings-search"><Search size={18} /><input aria-label="Cari pengaturan" placeholder="Cari pengaturan…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="settings-overview">
        <section className="settings-profile surface-card" aria-labelledby="settings-profile-heading"><div className="settings-profile-avatar">{initials(employeeName)}</div><h2 id="settings-profile-heading">{employeeName || 'Identitas rapat'}</h2><p>{department || 'Isi identitas saat bergabung ke rapat.'}</p><dl><div><dt>NIK</dt><dd>{employeeId || 'Belum diisi'}</dd></div><div><dt>Departemen</dt><dd>{department || 'Belum diisi'}</dd></div></dl><div className="settings-profile-note"><UserRound size={17} /><p>Identitas dari formulir rapat. Pengelolaan profil perusahaan tersedia setelah integrasi akun.</p></div></section>
        <div className="settings-category-grid">{filtered.length ? filtered.map(({ id, title, description, Icon, available }) => available
          ? <button className="settings-category" key={id} onClick={() => setSection(id as Section)}><span className="settings-category-icon"><Icon size={23} /></span><span><strong>{title}</strong><small>{description}</small><em>Tersedia</em></span><ChevronRight size={18} /></button>
          : <article className="settings-category settings-category-planned" key={id}><span className="settings-category-icon"><Icon size={23} /></span><div><h2>{title}</h2><p>{description}</p><span className="settings-planned-label">Menunggu integrasi</span></div><LockKeyhole size={16} aria-hidden="true" /></article>) : <p className="settings-empty" role="status">Pengaturan tidak ditemukan. Coba kata lain.</p>}</div>
      </div>
      <p className="settings-footnote"><Info size={17} />Preferensi perangkat dan tampilan disimpan di browser ini. Kebijakan perusahaan dikelola oleh admin.</p>
    </> : <>
      <button className="back-link settings-back" onClick={() => setSection('overview')}><ArrowLeft size={17} />Semua pengaturan</button>
      <div className="settings-detail-layout">
        <nav className="settings-sections" aria-label="Kategori pengaturan"><button aria-current={section === 'devices' ? 'page' : undefined} onClick={() => setSection('devices')}><Video size={18} />Audio & Video</button><button aria-current={section === 'display' ? 'page' : undefined} onClick={() => setSection('display')}><Monitor size={18} />Tampilan Rapat</button></nav>
        <form className="settings-form surface-card" onSubmit={event => { event.preventDefault(); save(); }}>
          <div className="settings-form-heading"><span className="settings-category-icon">{section === 'devices' ? <Video size={24} /> : <Monitor size={24} />}</span><div><h2>{section === 'devices' ? 'Audio & Video' : 'Tampilan Rapat'}</h2><p>{section === 'devices' ? 'Pilihan default untuk rapat berikutnya.' : 'Atur cara kamu melihat peserta dan aktivitas rapat.'}</p></div></div>
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
          </> : <fieldset className="settings-fields"><legend>Pengalaman rapat</legend><p className="settings-field-help">Rapat dimulai dengan Grid agar semua peserta setara. Pilih Speaker di ruang rapat untuk mengikuti pembicara aktif. Berbagi layar selalu mendapat area utama.</p><PreferenceToggle label="Cerminkan video kamera sendiri" description="Berlaku pada preview dan video lokal. Video peserta lain tetap sesuai aslinya." checked={draft.mirrorLocalVideo} onChange={mirrorLocalVideo => update({ mirrorLocalVideo })} /><PreferenceToggle label="Kurangi animasi" description="Kurangi gerakan antarmuka. Preferensi pengurangan gerakan dari sistem tetap dihormati." checked={draft.reduceMotion} onChange={reduceMotion => update({ reduceMotion })} /></fieldset>}
          <footer className="settings-save-bar"><p role="status">{dirty ? 'Perubahan belum disimpan' : saved ? <><Check size={16} />Preferensi tersimpan</> : 'Preferensi berlaku untuk rapat berikutnya'}</p><div><button type="button" className="settings-reset" onClick={() => { setDraft({ ...DEFAULT_PREFERENCES }); setSaved(false); }}>Default</button><button type="button" className="button-secondary" disabled={!dirty} onClick={() => { setDraft({ ...preferences }); setSaved(false); }}>Batal</button><button type="submit" className="button-primary" disabled={!dirty}><Settings2 size={16} />Simpan perubahan</button></div></footer>
        </form>
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
