import { useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { initials } from './presentation';
import { MicrophoneDiagnostic } from './MicrophoneDiagnostic';
import type { InputKind, usePreJoinMedia } from './usePreJoinMedia';

export function PreJoinPreview({ media, employeeName, blocked }: {
  media: ReturnType<typeof usePreJoinMedia>; employeeName: string; blocked: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = media.streams.videoinput;
    if (media.streams.videoinput) void element.play().catch(() => {});
    return () => { element.srcObject = null; };
  }, [media.streams.videoinput]);
  const field = (kind: InputKind, label: string, selected: string) => {
    const devices = media.devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default');
    const missing = selected !== 'default' && !devices.some(device => device.deviceId === selected);
    return <label className="prejoin-device-field">{label}<select aria-label={label} value={selected} disabled={blocked} onChange={event => media.select(kind, event.target.value)}>
      <option value="default">Default — perangkat sistem</option>
      {missing && <option value={selected}>Pilihan tidak tersedia — pilih perangkat lain</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1} (izin belum diberikan)`}</option>)}
    </select></label>;
  };
  return <section className="prejoin-panel" aria-label="Pemeriksaan perangkat sebelum bergabung">
    <div className="prejoin-camera">
      <video ref={video} className="prejoin-video" muted playsInline autoPlay aria-label="Preview kamera kamu" hidden={!media.streams.videoinput} />
      {!media.streams.videoinput && <div className="prejoin-placeholder"><span className="preview-avatar">{initials(employeeName)}</span><strong>{employeeName || 'Nama kamu'}</strong><span>{media.pending.videoinput ? 'Menunggu izin kamera…' : 'Preview hanya terlihat oleh kamu'}</span></div>}
      <div className="prejoin-camera-label"><span>{employeeName || 'Kamu'} · Preview lokal</span><button type="button" disabled={blocked} onClick={() => media.pending.videoinput || media.streams.videoinput ? media.stopCamera() : media.capture('videoinput')}>{media.pending.videoinput ? 'Batalkan preview' : media.streams.videoinput ? 'Hentikan preview' : 'Preview kamera'}</button></div>
    </div>
    {media.errors.videoinput && <p className="prejoin-error" role="alert">{media.errors.videoinput}</p>}
    <div className="prejoin-toggles">
      <button type="button" disabled={blocked} aria-label="Mikrofon saat bergabung" aria-pressed={media.choices.microphoneEnabled} onClick={() => media.toggle('audioinput')}>{media.choices.microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}<span>Mikrofon {media.choices.microphoneEnabled ? 'aktif' : 'nonaktif'}</span></button>
      <button type="button" disabled={blocked} aria-label="Kamera saat bergabung" aria-pressed={media.choices.cameraEnabled} onClick={() => media.toggle('videoinput')}>{media.choices.cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}<span>Kamera {media.choices.cameraEnabled ? 'aktif' : 'nonaktif'}</span></button>
    </div>
    <p className="prejoin-state" role="status">Saat masuk: mic {media.choices.microphoneEnabled ? 'aktif' : 'nonaktif'} · kamera {media.choices.cameraEnabled ? 'aktif' : 'nonaktif'}</p>
    <div className="prejoin-devices">{field('audioinput', 'Mikrofon sebelum bergabung', media.choices.microphoneId)}{field('videoinput', 'Kamera sebelum bergabung', media.choices.cameraId)}</div>
    {media.deviceError && <p className="prejoin-error" role="alert">{media.deviceError}</p>}
    <button type="button" className="prejoin-refresh" disabled={blocked} onClick={() => void media.refresh()}>Perbarui daftar perangkat</button>
    <MicrophoneDiagnostic key={media.streams.audioinput?.id || 'no-input'} stream={media.streams.audioinput} pending={media.pending.audioinput} error={media.errors.audioinput} blocked={blocked} onStart={() => void media.capture('audioinput')} onStop={media.stopMicrophone} />
  </section>;
}
