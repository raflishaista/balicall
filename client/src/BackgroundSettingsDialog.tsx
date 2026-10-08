import { useEffect, useId, useRef } from 'react';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ImagePlus, Loader2, Sparkles, VideoOff, X } from 'lucide-react';
import type { BackgroundBlurControl } from './useBackgroundBlur';
import { BLUR_BACKGROUND, NO_BACKGROUND, shouldMirrorCamera } from './backgroundEffects';
import skyline from './assets/backgrounds/BalitowerSentra-Connected-Skyline.png';
import navy from './assets/backgrounds/BalitowerSentra-Connected-Navy.png';
import studio from './assets/backgrounds/BalitowerSentra-Studio-Sentra.png';
import './BackgroundSettingsDialog.css';

const backgrounds = [
  { id: 'skyline', label: 'BalitowerSentra — Connected Skyline', imagePath: skyline },
  { id: 'sentra', label: 'BalitowerSentra — Connected Navy', imagePath: navy },
  { id: 'studio', label: 'BalitowerSentra — Studio Sentra', imagePath: studio },
];
export function BackgroundSettingsDialog({ control, blocked, mirror = true, onClose }: {
  control: BackgroundBlurControl; blocked: boolean; mirror?: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { localParticipant, cameraTrack, isCameraEnabled } = useLocalParticipant();
  const disabled = blocked || control.blurPending || !control.blurSupported || !isCameraEnabled;
  useEffect(() => {
    const previous = document.activeElement, node = dialog.current;
    node?.showModal(); close.current?.focus();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog className="background-dialog" ref={dialog} aria-labelledby={id + '-title'} aria-describedby={id + '-description'}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id={id + '-title'}><Sparkles size={21} />Latar kamera</h2><p id={id + '-description'}>Pilih latar yang nyaman untuk rapat Anda.</p></div><button ref={close} className="icon-button" type="button" aria-label="Tutup latar kamera" onClick={onClose}><X size={22} /></button></header>
    <div className="background-preview">
      {isCameraEnabled && cameraTrack ? <VideoTrack trackRef={{ participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }} autoPlay playsInline muted aria-label="Preview latar kamera" style={{ transform: shouldMirrorCamera(mirror, control.selection) ? 'scaleX(-1)' : 'none' }} /> : <div><VideoOff size={30} /><p>Nyalakan kamera untuk melihat dan menerapkan latar.</p></div>}
      <span>{control.blurPending ? 'Menerapkan latar…' : control.selection.label}</span>
    </div>
    {!control.blurSupported && <p className="background-notice" role="status">Efek latar belum didukung browser atau perangkat ini. Kamera tetap dapat digunakan tanpa efek.</p>}
    {control.blurError && <p className="background-error" role="alert">{control.blurError}</p>}
    <div className="background-choices" role="group" aria-label="Pilihan latar kamera">
      {[NO_BACKGROUND, BLUR_BACKGROUND, ...backgrounds].map(choice => <button type="button" key={choice.id} disabled={disabled} aria-pressed={control.selection.id === choice.id} onClick={() => void control.selectBackground(choice)}>
        {choice.imagePath ? <img src={choice.imagePath} alt="" /> : <span className={'background-swatch ' + choice.id}>{choice.id === 'none' ? <VideoOff size={24} /> : <Sparkles size={24} />}</span>}<span>{choice.label}</span>
      </button>)}
      {control.selection.id === 'upload' && <button type="button" disabled={disabled} aria-pressed="true"><img src={control.selection.imagePath} alt="" /><span>Gambar sendiri</span></button>}
    </div>
    <label className="background-upload"><ImagePlus size={19} /><span>Unggah gambar sendiri<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} aria-label="Unggah gambar latar kamera" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void control.selectBackground(NO_BACKGROUND, file); }} /></span></label>
    <p className="background-help">JPG, PNG, atau WebP · Maks. 5 MB, 4096 × 4096 piksel. Gambar unggahan hanya dipakai selama sesi ini dan tidak disimpan ke server. Efek dapat menambah beban perangkat.</p>
    <footer><span role="status">{control.blurPending ? <><Loader2 size={16} className="ui-spinner" />Menerapkan latar…</> : 'Perubahan langsung terlihat oleh peserta lain.'}</span><button type="button" className="button-primary" onClick={onClose}>Selesai</button></footer>
  </dialog>;
}
