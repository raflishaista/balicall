import { useEffect, useId, useRef } from 'react';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Headphones, Loader2, Mic, RefreshCw, Settings2, Video, VideoOff, X } from 'lucide-react';
import type { useDeviceSettings } from './useDeviceSettings';

type DeviceSettings = ReturnType<typeof useDeviceSettings>;

export function DeviceSettingsDialog({ settings, connected, blocked, micVolume, sttProvider, mirror = true, onClose }: {
  settings: DeviceSettings; connected: boolean; blocked: boolean; micVolume: number; sttProvider: 'browser' | 'server'; mirror?: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { localParticipant, cameraTrack, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const disabled = blocked || !connected || settings.pendingKind !== null;
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    node?.showModal(); closeButton.current?.focus();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  return <dialog ref={dialog} className="device-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),[tabindex="0"]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="device-dialog-heading"><span className="feature-icon"><Settings2 size={24} /></span><div><h2 id={`${id}-title`}>Perangkat audio &amp; video</h2><p id={`${id}-description`}>Perubahan langsung berlaku untuk rapat ini.</p></div><button ref={closeButton} type="button" className="icon-button" aria-label="Tutup pengaturan perangkat" onClick={onClose}><X size={21} /></button></header>
    {!connected && <p className="device-notice" role="status">Perangkat dapat diganti setelah rapat tersambung kembali.</p>}
    {settings.loading && <p role="status" className="device-notice"><Loader2 size={16} className="ui-spinner" />Membaca perangkat...</p>}
    {(settings.error || settings.listError) && <p role="alert" className="device-error">{settings.error || settings.listError}</p>}
    {settings.notice && <p role="status" className="device-success">{settings.notice}</p>}
    <div className="device-settings-grid"><div className="device-selectors">
      <DeviceSelector settings={settings} kind="audioinput" label="Mikrofon" icon={<Mic size={18} />} disabled={disabled} />
      <div className="device-input-meter"><span>{isMicrophoneEnabled ? 'Level mikrofon rapat' : 'Mikrofon nonaktif'}</span><i><b style={{ width: micVolume + '%' }} /></i></div>
      <DeviceSelector settings={settings} kind="videoinput" label="Kamera" icon={<Video size={18} />} disabled={disabled} />
      <DeviceSelector settings={settings} kind="audiooutput" label="Speaker / headphone" icon={<Headphones size={18} />} disabled={disabled || !settings.outputSupported} />
      {!settings.outputSupported ? <p className="device-help">Browser ini belum mendukung pemilihan speaker. Atur output melalui pengaturan suara sistem.</p> : settings.outputPickerSupported && <button type="button" className="text-button" disabled={disabled} onClick={() => void settings.requestOutput()}>Izinkan / pilih speaker melalui browser</button>}
    </div><div className="device-camera-preview">
      {isCameraEnabled && cameraTrack?.track?.mediaStreamTrack.readyState === 'live' ? <VideoTrack trackRef={{ participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }} className="device-preview-video" style={{ transform: mirror ? 'scaleX(-1)' : 'none' }} autoPlay playsInline muted aria-label="Preview kamera aktif" /> : <div><VideoOff size={30} /><span>Kamera nonaktif atau belum tersedia</span></div>}
      <p>Preview kamera rapat</p>
    </div></div>
    <p className="device-help">Pemilihan perangkat menjaga status mute dan kamera. Nama perangkat bisa disembunyikan sebelum izin browser diberikan.</p>
    {sttProvider === 'browser' && <p className="device-notice">Transkripsi browser memakai input yang dipilih oleh browser dan belum tentu mengikuti mikrofon rapat ini. Mode transkripsi server mengikuti track mikrofon rapat.</p>}
    <footer className="device-dialog-footer"><button type="button" className="button-secondary" disabled={settings.loading || disabled} onClick={() => void settings.refreshDevices()}><RefreshCw size={15} />Muat ulang daftar</button><button type="button" className="button-primary" onClick={onClose}>Selesai</button></footer>
  </dialog>;
}

function DeviceSelector({ settings, kind, label, icon, disabled }: { settings: DeviceSettings; kind: MediaDeviceKind; label: string; icon: React.ReactNode; disabled: boolean }) {
  const id = useId();
  const choices = settings.devices.filter((device, index, all) => device.kind === kind && device.deviceId && all.findIndex(candidate => candidate.kind === kind && candidate.deviceId === device.deviceId) === index);
  const selected = settings.active[kind];
  const defaultOption = kind === 'audiooutput' || selected === 'default';
  const missing = selected !== 'default' && !choices.some(device => device.deviceId === selected);
  return <div className="device-selector"><label htmlFor={id}>{icon}{label}{settings.pendingKind === kind && <Loader2 size={15} className="ui-spinner" />}</label>
    <select id={id} value={settings.outputSupported || kind !== 'audiooutput' ? selected : 'default'} disabled={disabled || settings.loading || (!choices.length && kind !== 'audiooutput')} onChange={event => void settings.selectDevice(kind, event.target.value)}>
      {defaultOption && !choices.some(device => device.deviceId === 'default') && <option value="default">Default sistem</option>}
      {missing && <option value={selected} disabled>Pilihan sebelumnya (tidak tersedia)</option>}
      {choices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
    </select>
    {missing && !settings.loading && <small className="device-missing">Perangkat tidak ditemukan dalam daftar. Pilih perangkat lain atau sambungkan kembali.</small>}
    {!choices.length && !settings.loading && <small className="device-help">{kind === 'audiooutput' ? 'Hanya output default yang tersedia atau diizinkan.' : 'Tidak ada perangkat yang tersedia atau diizinkan.'}</small>}
    {kind === 'audiooutput' && <small className="device-help">Untuk suara peserta lain di rapat.</small>}
  </div>;
}
