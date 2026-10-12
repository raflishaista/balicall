import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiRequest } from './api';
import { disablePush, enablePush, getPushDeviceStatus } from './pushNotifications';
import type { PushDeviceStatus } from './pushNotifications';
interface Notice { id: string; kind: string; roomName: string; meetingId: string | null; readAt: string | null; createdAt: string }

export function PushSettings() {
  const [config, setConfig] = useState<{ configured: boolean; publicKey: string } | null>(null);
  const [device, setDevice] = useState<PushDeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const refresh = () => {
      if (lock.current) return;
      setLoading(true);
      setLoadError('');
      void Promise.all([
        apiRequest<{ configured: boolean; publicKey: string }>('/notifications/push-config', { signal: controller.signal }),
        getPushDeviceStatus(),
      ]).then(([configuration, status]) => {
        if (alive) { setConfig(configuration); setDevice(status); }
      }).catch(() => {
        if (alive) setLoadError('Status notifikasi belum dapat diperiksa. Periksa koneksi lalu coba lagi.');
      }).finally(() => { if (alive) setLoading(false); });
    };
    refresh();
    // Recheck permissions after returning from the browser's site settings.
    const onFocus = () => setRevision(value => value + 1);
    window.addEventListener('focus', onFocus);
    return () => { alive = false; controller.abort(); window.removeEventListener('focus', onFocus); };
  }, [revision]);
  const action = async (enable: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      await (enable ? enablePush(config?.publicKey || '') : disablePush());
      setDevice(await getPushDeviceStatus());
      setMessage(enable ? 'Notifikasi perangkat berhasil disinkronkan dengan akun ini.' : 'Notifikasi perangkat ini dinonaktifkan.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pengaturan belum tersimpan.');
    } finally { lock.current = false; setBusy(false); setRevision(value => value + 1); }
  };
  const labels = { active: 'Subscription tersedia di browser ini', inactive: 'Belum aktif di perangkat ini', denied: 'Izin notifikasi ditolak', unsupported: 'Web Push tidak didukung pada koneksi/browser ini' };
  return <section className="push-settings" aria-busy={loading || busy}>
    <h3>Notifikasi background & lintas perangkat</h3>
    <p>Aktifkan di setiap perangkat. Inbox tersimpan pada akun; notifikasi sistem memerlukan HTTPS, izin browser dan konfigurasi Web Push server.</p>
    <p>Notifikasi sistem hanya memuat pemberitahuan umum; buka BaliCall untuk membaca detail rapat.</p>
    <p role="status">{loading ? 'Memeriksa status notifikasi…' : loadError || (device ? labels[device] : 'Status belum diketahui')}</p>
    {loadError && <button type="button" className="button-secondary" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Coba lagi</button>}
    {!loading && !loadError && config && !config.configured && <p>Web Push server belum dikonfigurasi admin. Inbox tetap dapat digunakan.</p>}
    {device === 'active' && <p>Subscription browser tidak menjamin pengiriman. Gunakan tombol aktivasi untuk menyinkronkannya dengan akun ini.</p>}
    {device === 'denied' && <p>Izinkan notifikasi melalui pengaturan izin situs di browser, lalu kembali ke halaman ini.</p>}
    <div className="push-settings-actions">
      <button type="button" className="button-secondary" disabled={loading || busy || Boolean(loadError) || !config?.configured || !device || device === 'unsupported' || device === 'denied'} onClick={() => void action(true)}>{busy ? 'Memproses…' : 'Aktifkan notifikasi perangkat'}</button>
      <button type="button" className="text-button" disabled={loading || busy || Boolean(loadError) || device !== 'active'} onClick={() => void action(false)}>Nonaktifkan perangkat ini</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}

export function NotificationCenter({ onJoin, onSummary }: { onJoin: (room: string) => void; onSummary: () => void }) {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('notification'));
  const [items, setItems] = useState<Notice[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [opening, setOpening] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null), lock = useRef(false), alive = useRef(false);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    void apiRequest<{ notifications: Notice[] }>('/notifications', { signal: controller.signal }).then(data => {
      if (alive.current && !controller.signal.aborted) { setItems(data.notifications); setError(''); }
    }).catch(() => {
      if (alive.current && !controller.signal.aborted) setError('Inbox belum tersambung. Periksa koneksi lalu coba lagi.');
    }).finally(() => { if (alive.current && !controller.signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => {
    alive.current = true;
    const received = (event: MessageEvent) => { if (event.data?.type === 'balicall:open-notifications') { setOpen(true); refresh(); } };
    refresh(); const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); navigator.serviceWorker?.addEventListener('message', received);
    return () => { alive.current = false; request.current?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); navigator.serviceWorker?.removeEventListener('message', received); };
  }, [refresh]);
  useEffect(() => { if (open) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const choose = async (item: Notice) => {
    if (lock.current) return;
    lock.current = true; setOpening(item.id); setError('');
    try {
      await apiRequest('/notifications/' + item.id + '/read', { method: 'POST' });
      if (!alive.current) return;
      setItems(old => old.map(notice => notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice));
      close();
      if (item.kind === 'summary') onSummary(); else onJoin(item.roomName);
    } catch { if (alive.current) setError('Notifikasi belum dapat dibuka. Coba pilih kembali atau muat ulang inbox.'); }
    finally { lock.current = false; if (alive.current) setOpening(null); }
  };
  return <div className="notification-center" onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button ref={button} className="button-secondary" type="button" aria-label="Notifikasi akun" aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell size={17} />{items.filter(notice => !notice.readAt).length || ''}</button>
    {open && <div ref={dialog} className="notification-inbox" role="region" aria-label="Inbox notifikasi" aria-busy={loading || Boolean(opening)}>
      <h2>Notifikasi</h2><button type="button" className="text-button" onClick={close}>Tutup</button>
      {error && <><p role="status">{error}</p><button type="button" className="button-secondary" disabled={loading || Boolean(opening)} onClick={() => { setLoading(true); refresh(); }}>Coba lagi</button></>}
      {loading && <p role="status">Memuat inbox…</p>}
      {opening && <p role="status">Membuka notifikasi…</p>}
      {!items.length && !error && !loading && <p>Belum ada notifikasi.</p>}
      {items.map(item => <button type="button" className="notification-item" disabled={Boolean(opening)} key={item.id} onClick={() => void choose(item)}><strong>{item.kind === 'summary' ? 'Notulen siap' : item.kind === 'invitation' ? 'Undangan rapat' : 'Pengingat rapat'}{!item.readAt ? ' · Baru' : ''}</strong><span>{item.roomName}</span><small>{new Date(item.createdAt).toLocaleString('id-ID')}</small></button>)}
    </div>}
  </div>;
}
