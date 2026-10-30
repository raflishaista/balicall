import { AudioLines, CircleAlert, Loader2, Pause } from 'lucide-react';
import { transcriptionStatus, type TranscriptionState } from './transcriptionStatus';
export function TranscriptionStatus({state, warning}: {state: TranscriptionState; warning?: string | null}) {
  const status=transcriptionStatus(state);
  const Icon=status.tone==='error' ? CircleAlert : status.tone==='pending' ? Loader2 : status.tone==='active' ? AudioLines : Pause;
  return <div className="transcription-feedback">
    <div className={`transcription-state-card is-${status.tone}`} role="status" aria-live="polite" aria-atomic="true">
      <Icon size={17} aria-hidden="true" /><div><strong>{status.label}</strong><p>{status.detail}</p></div>
    </div>
    {warning && <p className="transcription-warning" role="status"><CircleAlert size={15} aria-hidden="true" /><span><strong>Perlu diperiksa:</strong> {warning}</span></p>}
    <p className="transcription-legend"><span className="transcript-phase final">Final</span> Teks tidak lagi sementara. <span className="transcript-phase provisional">Sementara</span> Teks masih dapat berubah.</p>
  </div>;
}
