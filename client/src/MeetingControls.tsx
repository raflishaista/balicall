import { useEffect, useRef, useState } from 'react';
import { AudioLines, Circle, Square, Loader2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings2, Users, Video, VideoOff, MoreHorizontal, FileText, Sparkles } from 'lucide-react';

export function MeetingControls({ busy, connected, devicePending, isMuted, microphonePending, isCameraEnabled, cameraPending, isScreenShareEnabled, screenSharePending, screenShareSupported, speechEnabled, speechError, isListening, saveBlocked, finishLabel, recording, recordingPending, onToggleRecording, onToggleMute, onToggleCamera, onToggleScreenShare, onToggleTranscription, onOpenDevices, onParticipants, transcriptOpen, onTranscript, onFinish, isCameraBlur = false, cameraBlurPending = false, cameraBlurSupported = true, onToggleCameraBlur, onOpenBackgrounds }: {
  onOpenBackgrounds?: () => void;
  busy: boolean; connected: boolean; devicePending: boolean; isMuted: boolean; microphonePending: boolean;
  isCameraEnabled: boolean; cameraPending: boolean; isScreenShareEnabled: boolean; screenSharePending: boolean; screenShareSupported: boolean;
  speechEnabled: boolean; speechError: string | null; isListening: boolean; saveBlocked: boolean; finishLabel: string | null;
  onToggleMute: () => Promise<void>; onToggleCamera: () => Promise<void>; onToggleScreenShare: () => Promise<void>;
  transcriptOpen: boolean; onTranscript: () => void;
  recording: boolean; recordingPending: boolean; onToggleRecording: () => Promise<void>;
  onToggleTranscription: () => void; onOpenDevices: () => void; onParticipants: () => void; onFinish: (generate: boolean) => void;
  isCameraBlur?: boolean; cameraBlurPending?: boolean; cameraBlurSupported?: boolean; onToggleCameraBlur?: () => Promise<void>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    more.current?.querySelector<HTMLButtonElement>('.meeting-more-menu button:not([disabled])')?.focus();
    const outside = (event: PointerEvent) => { if (!more.current?.contains(event.target as Node)) setMoreOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [moreOpen]);
  return <footer className="call-control-bar" role="group" aria-label="Kontrol rapat" id="meeting-controls">
    <div className="call-controls">
      <button type="button" className={`call-control ${isMuted ? 'control-muted' : ''}`} aria-label={isMuted ? 'Aktifkan mikrofon' : 'Matikan mikrofon'} aria-pressed={!isMuted} aria-busy={microphonePending} disabled={busy || devicePending || microphonePending || !connected} onClick={() => void onToggleMute()}>
        {microphonePending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isMuted ? <MicOff size={22} /> : <Mic size={22} />}<span>{microphonePending ? 'Memproses…' : isMuted ? 'Aktifkan mic' : 'Mikrofon'}</span>
      </button>
      <button type="button" className={`call-control ${isCameraEnabled ? 'control-active' : 'control-muted'}`} aria-label={isCameraEnabled ? 'Matikan kamera' : 'Aktifkan kamera'} aria-pressed={isCameraEnabled} aria-busy={cameraPending} disabled={busy || cameraPending || devicePending || !connected} onClick={() => void onToggleCamera()}>
        {cameraPending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isCameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}<span>{cameraPending ? 'Memproses…' : isCameraEnabled ? 'Kamera' : 'Aktifkan kamera'}</span>
      </button>
      {onOpenBackgrounds ? <button type="button" className="call-control" aria-label="Latar kamera" aria-haspopup="dialog" disabled={busy || devicePending || cameraPending || !connected} onClick={onOpenBackgrounds}><Sparkles size={22} /><span>Latar kamera</span></button> : cameraBlurSupported && onToggleCameraBlur ? <button type="button" className={`call-control ${isCameraBlur ? 'control-active' : ''}`} aria-label={isCameraBlur ? 'Nonaktifkan blur latar belakang' : 'Aktifkan blur latar belakang'} aria-pressed={isCameraBlur} aria-busy={cameraBlurPending} disabled={busy || !isCameraEnabled || cameraBlurPending || devicePending || !connected} onClick={() => void onToggleCameraBlur()}><Sparkles size={22} /><span>Blur latar</span></button> : null}
      <button type="button" className={`call-control ${isScreenShareEnabled ? 'control-active' : ''}`} aria-label={isScreenShareEnabled ? 'Hentikan berbagi layar' : 'Bagikan layar'} aria-pressed={isScreenShareEnabled} aria-busy={screenSharePending} disabled={busy || screenSharePending || !connected || (!screenShareSupported && !isScreenShareEnabled)} onClick={() => void onToggleScreenShare()}>
        {screenSharePending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isScreenShareEnabled ? <MonitorOff size={22} /> : <MonitorUp size={22} />}<span>{screenSharePending ? 'Memproses…' : isScreenShareEnabled ? 'Hentikan layar' : 'Bagikan layar'}</span>
      </button>
      <button type="button" className="call-control" aria-label="Peserta" onClick={onParticipants}><Users size={22} /><span>Peserta</span></button>
      <div className="meeting-more" ref={more} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setMoreOpen(false); moreButton.current?.focus(); } }}>
        <button ref={moreButton} type="button" className="call-control" aria-label="Lainnya" aria-expanded={moreOpen} aria-controls="meeting-more-options" onClick={() => setMoreOpen(!moreOpen)}><MoreHorizontal size={22} /><span>Lainnya</span></button>
        <div className="meeting-more-menu" id="meeting-more-options" role="group" aria-label="Pilihan lainnya" hidden={!moreOpen}>
          <button type="button" aria-label={recording ? 'Hentikan rekaman' : 'Mulai rekaman'} aria-pressed={recording} aria-busy={recordingPending} disabled={busy || recordingPending || !connected} onClick={() => void onToggleRecording()}>
            {recordingPending ? <Loader2 className="ui-spinner" size={18} aria-hidden="true" /> : recording ? <Square size={18} /> : <Circle size={18} />}<span>{recordingPending ? 'Memproses rekaman…' : recording ? 'Hentikan rekaman' : 'Mulai rekaman'}</span>
          </button>
          <button type="button" aria-label={speechError ? 'Coba transkripsi lagi' : speechEnabled ? 'Jeda transkripsi' : 'Mulai transkripsi'} aria-pressed={speechEnabled && !speechError} disabled={busy || !connected || isMuted || saveBlocked} onClick={onToggleTranscription}><AudioLines size={18} /><span>{speechError ? 'Coba transkripsi lagi' : speechEnabled ? 'Jeda transkrip' : 'Mulai transkrip'}</span>{isListening && <i className="status-dot online" />}</button>
          <button type="button" aria-label="Pengaturan perangkat" aria-haspopup="dialog" disabled={busy || !connected} onClick={() => { setMoreOpen(false); moreButton.current?.focus(); onOpenDevices(); }}><Settings2 size={18} /><span>Perangkat audio &amp; video</span></button>
        </div>
      </div>
      <button id="toggle-meeting-transcript" type="button" className={`call-control ${transcriptOpen ? 'control-active' : ''}`} aria-label="Transkrip" aria-pressed={transcriptOpen} onClick={onTranscript}><FileText size={22} /><span>Transkrip</span></button>
    </div>
    <div className="leave-controls">
      <button type="button" className="leave-simple" disabled={busy} onClick={() => onFinish(false)}>Keluar</button>
      <button type="button" className="leave-button" disabled={busy} onClick={() => onFinish(true)} aria-busy={busy}>{busy && <Loader2 className="ui-spinner" size={16} aria-hidden="true" />}{busy ? finishLabel : <><PhoneOff size={18} />Selesai &amp; notulen</>}</button>
    </div>
  </footer>;
}
