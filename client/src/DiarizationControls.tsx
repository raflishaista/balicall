import { useId } from 'react';
import { resolveDiarization } from './diarization';
import type { DiarizationOptions } from './diarization';
import './DiarizationControls.css';

export function DiarizationControls({ disabled = false, onSharedChange, onLiveChange, onBatchChange, ...options }: DiarizationOptions & {
  disabled?: boolean;
  onSharedChange?: (enabled: boolean) => void;
  onLiveChange?: (enabled: boolean) => void;
  onBatchChange?: (enabled: boolean) => void;
}) {
  const id = useId();
  const state = resolveDiarization(options);
  return <fieldset className="diarization-controls" aria-describedby={`${id}-availability ${id}-identity`}>
    <legend>Pemisahan pembicara (diarization)</legend>
    <label className="diarization-option">
      <input type="checkbox" checked={state.shared} disabled={disabled || !state.available || !onSharedChange}
        aria-describedby={`${id}-availability`} onChange={event => onSharedChange?.(event.target.checked)} />
      <span><strong>Mikrofon dipakai beberapa orang</strong><small>Gunakan saat beberapa orang berbicara melalui satu perangkat.</small></span>
    </label>
    <p id={`${id}-availability`} className="diarization-availability" role="status">{state.notice}{!state.available && options.sharedRoomMic ? ' Pilihan tersimpan dipertahankan dan akan dipakai kembali pada layanan yang mendukung.' : ''}</p>
    <div className="diarization-children">
      <label className="diarization-option">
        <input type="checkbox" checked={state.live} disabled={disabled || !state.shared || !onLiveChange}
          onChange={event => onLiveChange?.(event.target.checked)} />
        <span><strong>Saat rapat berlangsung</strong><small>Pisahkan pembicara per potongan audio. Hasil dapat tertunda; label antar-potongan belum tentu orang yang sama.</small></span>
      </label>
      <label className="diarization-option">
        <input type="checkbox" checked={state.batch} disabled={disabled || !state.shared || !onBatchChange}
          onChange={event => onBatchChange?.(event.target.checked)} />
        <span><strong>Analisis ulang setelah rapat</strong><small>Proses ulang audio yang tersedia sebelum menyusun notulen. Waktu proses dapat lebih lama; hasil dapat mengubah label pembicara.</small></span>
      </label>
    </div>
    {state.shared && !state.live && !state.batch && <p className="diarization-availability" role="status">Pilih minimal satu waktu pemrosesan agar pemisahan pembicara diterapkan.</p>}
    <p id={`${id}-identity`} className="diarization-identity">Pembicara 1/2 adalah label suara, bukan nama atau NIK. Orang dalam satu mikrofon tidak dikenali otomatis berdasarkan akun.</p>
  </fieldset>;
}
