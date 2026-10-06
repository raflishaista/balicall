import { AudioLines, Loader2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings2, Users, Video, VideoOff } from 'lucide-react';

export function MeetingControls({ busy, connected, devicePending, isMuted, microphonePending, isCameraEnabled, cameraPending, isScreenShareEnabled, screenSharePending, screenShareSupported, speechEnabled, speechError, isListening, saveBlocked, finishLabel, onToggleMute, onToggleCamera, onToggleScreenShare, onToggleTranscription, onOpenDevices, onParticipants, onFinish }: {
  busy: boolean; connected: boolean; devicePending: boolean; isMuted: boolean; microphonePending: boolean;
  isCameraEnabled: boolean; cameraPending: boolean; isScreenShareEnabled: boolean; screenSharePending: boolean; screenShareSupported: boolean;
  speechEnabled: boolean; speechError: string | null; isListening: boolean; saveBlocked: boolean; finishLabel: string | null;
  onToggleMute: () => Promise<void>; onToggleCamera: () => Promise<void>; onToggleScreenShare: () => Promise<void>;
  onToggleTranscription: () => void; onOpenDevices: () => void; onParticipants: () => void; onFinish: (generate: boolean) => void;
}) {
  return <footer className="call-control-bar" role="group" aria-label="Kontrol rapat" id="meeting-controls">
    <div className="call-controls">
      <button type="button" className={`call-control ${isMuted ? 'control-muted' : ''}`} aria-label={isMuted ? 'Aktifkan mikrofon' : 'Matikan mikrofon'} aria-pressed={!isMuted} aria-busy={microphonePending} disabled={busy || devicePending || microphonePending || !connected} onClick={() => void onToggleMute()}>
        {microphonePending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isMuted ? <MicOff size={22} /> : <Mic size={22} />}<span>{microphonePending ? 'Memproses…' : isMuted ? 'Aktifkan mic' : 'Mikrofon'}</span>
      </button>
      <button type="button" className={`call-control ${isCameraEnabled ? 'control-active' : 'control-muted'}`} aria-label={isCameraEnabled ? 'Matikan kamera' : 'Aktifkan kamera'} aria-pressed={isCameraEnabled} aria-busy={cameraPending} disabled={busy || cameraPending || devicePending || !connected} onClick={() => void onToggleCamera()}>
        {cameraPending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isCameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}<span>{cameraPending ? 'Memproses…' : isCameraEnabled ? 'Kamera' : 'Aktifkan kamera'}</span>
      </button>
      <button type="button" className={`call-control ${isScreenShareEnabled ? 'control-active' : ''}`} aria-label={isScreenShareEnabled ? 'Hentikan berbagi layar' : 'Bagikan layar'} aria-pressed={isScreenShareEnabled} aria-busy={screenSharePending} disabled={busy || screenSharePending || !connected || (!screenShareSupported && !isScreenShareEnabled)} onClick={() => void onToggleScreenShare()}>
        {screenSharePending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isScreenShareEnabled ? <MonitorOff size={22} /> : <MonitorUp size={22} />}<span>{screenSharePending ? 'Memproses…' : isScreenShareEnabled ? 'Hentikan layar' : 'Bagikan layar'}</span>
      </button>
      <button type="button" className={`call-control ${isListening ? 'control-active' : ''}`} aria-label={speechError ? 'Coba transkripsi lagi' : speechEnabled ? 'Jeda transkripsi' : 'Mulai transkripsi'} aria-pressed={speechEnabled && !speechError} disabled={busy || !connected || isMuted || saveBlocked} onClick={onToggleTranscription}><AudioLines size={22} /><span>{speechError ? 'Coba transkrip' : speechEnabled ? 'Jeda transkrip' : 'Mulai transkrip'}</span></button>
      <button type="button" className="call-control" aria-label="Pengaturan perangkat" aria-haspopup="dialog" disabled={busy || !connected} onClick={onOpenDevices}><Settings2 size={22} /><span>Perangkat</span></button>
      <button type="button" className="call-control" onClick={onParticipants}><Users size={22} /><span>Peserta</span></button>
    </div>
    <div className="leave-controls">
      <button type="button" className="leave-simple" disabled={busy} onClick={() => onFinish(false)}>Keluar</button>
      <button type="button" className="leave-button" disabled={busy} onClick={() => onFinish(true)} aria-busy={busy}>{busy && <Loader2 className="ui-spinner" size={16} aria-hidden="true" />}{busy ? finishLabel : <><PhoneOff size={18} />Selesai &amp; notulen</>}</button>
    </div>
  </footer>;
}
