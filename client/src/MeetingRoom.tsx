import { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import type { Participant } from 'livekit-client';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { AudioLines, Check, ChevronDown, FileText, Loader2, Mic, Send, Users, VideoOff, Grid2X2, UserRound, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { StartAudio, useRoomContext } from '@livekit/components-react';
import { BackgroundSettingsDialog } from './BackgroundSettingsDialog';
import type { BackgroundBlurControl } from './useBackgroundBlur';
import { MeetingControls } from './MeetingControls';
import { initials } from './presentation';
import { ParticipantLayout } from './ParticipantLayout';
import { MeetingPanel } from './MeetingPanel';
import { useMeasuredBox, useCompactMeeting } from './useMeetingGeometry';
import { orderParticipants, participantPage } from './meetingLayout';
import './MeetingLayout.css';
import { ScreenShareStage } from './ScreenShareStage';

interface Transcript {
  id: string; speakerId: string; speakerName: string; text: string; timestamp: string;
}

export function MeetingRoom({ participants, roomName, employeeId, connected, isMuted, micVolume, finishing, isSummarizing, finishError, speechError, interimText, isListening, speechEnabled, saveBlocked, sttProvider, sttConfigured, setSttProvider, speechLanguage, setSpeechLanguage, activeTab, setActiveTab, transcripts, onToggleMute, onToggleTranscription, onFinish, onAddSpeechLine, cameraTracks, isCameraEnabled, cameraPending, cameraError, microphoneError, onToggleCamera, screenTracks, isScreenShareEnabled, screenSharePending, screenShareError, screenShareSupported, onToggleScreenShare, devicePending, deviceError, onOpenDevices, spotlightIdentity, microphonePending, connectionState, mirrorLocalVideo = true, recordingPending, recordingError, onToggleRecording, isCameraBlur = false, cameraBlurPending = false, cameraBlurSupported = true, cameraBlurError = null, onToggleCameraBlur, onClearCameraBlurError, backgroundControl }: {
  backgroundControl?: BackgroundBlurControl;
  participants: Participant[]; roomName: string; employeeId: string; connected: boolean; isMuted: boolean; micVolume: number;
  finishing: boolean; isSummarizing: boolean; finishError: string | null; speechError: string | null; interimText: string; isListening: boolean; speechEnabled: boolean; saveBlocked: boolean;
  sttProvider: 'browser' | 'server'; sttConfigured: boolean; setSttProvider: (provider: 'browser' | 'server') => void;
  speechLanguage: 'id-ID' | 'en-US'; setSpeechLanguage: (language: 'id-ID' | 'en-US') => void;
  activeTab: 'transcript' | 'attendance'; setActiveTab: (tab: 'transcript' | 'attendance') => void; transcripts: Transcript[];
  onToggleMute: () => Promise<void>; onToggleTranscription: () => void; onFinish: (generate: boolean) => Promise<void>; onAddSpeechLine: (text: string) => void;
  cameraTracks: TrackReferenceOrPlaceholder[]; isCameraEnabled: boolean; cameraPending: boolean;
  cameraError: string | null; microphoneError: string | null; onToggleCamera: () => Promise<void>;
  screenTracks: TrackReference[]; isScreenShareEnabled: boolean; screenSharePending: boolean;
  screenShareError: string | null; screenShareSupported: boolean; onToggleScreenShare: () => Promise<void>;
  devicePending: boolean; deviceError: string | null; onOpenDevices: () => void;
  spotlightIdentity: string | null; microphonePending: boolean; connectionState: ConnectionState;
  mirrorLocalVideo?: boolean;
  recordingPending: boolean; recordingError: string | null; onToggleRecording: (enabled: boolean) => Promise<void>;
  isCameraBlur?: boolean; cameraBlurPending?: boolean; cameraBlurSupported?: boolean; cameraBlurError?: string | null;
  onToggleCameraBlur?: () => Promise<void>; onClearCameraBlurError?: () => void;
}) {
  const room = useRoomContext();
  const subscribeRecording = useCallback((notify: () => void) => {
    room.on(RoomEvent.RecordingStatusChanged, notify);
    return () => { room.off(RoomEvent.RecordingStatusChanged, notify); };
  }, [room]);
  const recording = useSyncExternalStore(subscribeRecording, () => room.isRecording, () => false);
  const [backgroundsOpen, setBackgroundsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'speaker'>('grid');
  const compact = useCompactMeeting();
  const [panelOpen, setPanelOpen] = useState(() => !compact);
  const [panelPercent, setPanelPercent] = useState(25);
  const [requestedPage, setRequestedPage] = useState(0);
  const { ref: roomRef, width: roomWidth } = useMeasuredBox<HTMLDivElement>();
  const minPercent = Math.max(20, roomWidth ? 280 / roomWidth * 100 : 20);
  const panelWidth = Math.max(minPercent, Math.min(42, panelPercent));
  const resizePanel = (value: number) => setPanelPercent(Math.max(minPercent, Math.min(42, value)));
  const orderedParticipants = orderParticipants(participants);
  const closePanel = () => { setPanelOpen(false); if (!compact) document.getElementById('toggle-meeting-transcript')?.focus(); };
  const [manualText, setManualText] = useState('');
  const tabId = useId();
  const transcriptTab = useRef<HTMLButtonElement>(null), attendanceTab = useRef<HTMLButtonElement>(null);
  const activateTab = (tab: 'transcript' | 'attendance') => { setActiveTab(tab); (tab === 'transcript' ? transcriptTab : attendanceTab).current?.focus(); };
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    activateTab(event.key === 'Home' ? 'transcript' : event.key === 'End' ? 'attendance' : activeTab === 'transcript' ? 'attendance' : 'transcript');
  };
  const [finishMode, setFinishMode] = useState<'summary' | 'leave' | null>(null);
  const busy = finishing || isSummarizing;
  const reconnecting = connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting;
  const connectionLabel = connected ? 'Terhubung' : reconnecting ? 'Menyambungkan kembali' : connectionState === ConnectionState.Disconnected ? 'Koneksi terputus' : 'Menghubungkan';
  const camerasByIdentity = new Map(cameraTracks.map(track => [track.participant.identity, track]));
  const spotlight = orderedParticipants.find(participant => participant.identity === spotlightIdentity) || orderedParticipants[0];
  const showingSpeaker = viewMode === 'speaker' && screenTracks.length === 0 && Boolean(spotlight);
  const videoWidth = roomWidth * (panelOpen && !compact ? 1 - panelWidth / 100 : 1) - 50;
  const stripCapacity = Math.max(1, Math.min(showingSpeaker ? 8 : 9, Math.floor((videoWidth + 10) / 150)));
  const paging = participantPage(showingSpeaker ? orderedParticipants.filter(participant => participant.identity !== spotlight.identity) : orderedParticipants, requestedPage, screenTracks.length || showingSpeaker ? stripCapacity : 9);
  const isVoiceActive = connected && !isMuted && micVolume > 5;
  const finishLabel = !busy ? null : finishing && !isSummarizing ? 'Menyimpan transkrip…' : finishMode === 'summary' ? 'Menyiapkan notulen…' : 'Menyimpan rapat…';
  const requestFinish = (generate: boolean) => {
    setFinishMode(generate ? 'summary' : 'leave');
    void onFinish(generate).finally(() => setFinishMode(null));
  };
  const transcriptStatus = !connected ? 'Menunggu koneksi' : isMuted ? 'Mikrofon nonaktif' : saveBlocked ? 'Penyimpanan tertunda' : speechError ? 'Transkripsi bermasalah' : isListening ? 'Mendengarkan' : speechEnabled ? 'Memulai transkripsi' : 'Transkripsi dihentikan';

  return <div ref={roomRef} className={`call-room meeting-layout ${panelOpen && !compact ? 'panel-open' : 'panel-closed'}`} style={{ gridTemplateColumns: panelOpen && !compact ? `minmax(0, 1fr) 10px ${panelWidth}%` : 'minmax(0, 1fr)' }}>
    <section className={`call-stage ${screenTracks.length ? 'has-screen-share' : ''}`}>
      <div className="call-info-bar"><div><span className="room-label">#{roomName}</span><span className="call-connection" role="status"><i className={connected ? 'status-dot online' : 'status-dot offline'} />{connectionLabel}</span></div><span className="participant-count"><Users size={16} />{participants.length} peserta</span></div>
      <div className="meeting-view-bar"><div className="meeting-view-toggle" role="group" aria-label="Tampilan peserta">
        <button type="button" aria-pressed={viewMode === 'grid'} onClick={() => { setViewMode('grid'); setRequestedPage(0); }}><Grid2X2 size={16} />Grid</button>
        <button type="button" aria-pressed={viewMode === 'speaker'} onClick={() => { setViewMode('speaker'); setRequestedPage(0); }}><UserRound size={16} />Speaker</button>
      </div><div className="meeting-state-chips"><span className={recording ? 'recording-active' : ''} role="status">{recording ? '● Merekam' : 'Tidak merekam'}</span><span role="status">Transkripsi · {transcriptStatus}</span></div></div>
      {!connected && <div className="connection-notice" role="status">{reconnecting ? 'Koneksi sedang dipulihkan. Kontrol media tersedia lagi setelah tersambung.' : connectionState === ConnectionState.Disconnected ? 'Koneksi rapat terputus. Keluar lalu gabung kembali untuk melanjutkan.' : 'Menyiapkan koneksi ke ruang rapat…'}</div>}
      <StartAudio label="Aktifkan suara peserta" className="audio-playback-button" />
      {finishError && <div className="call-error" role="alert">{finishError}</div>}
      {deviceError && <div className="call-error" role="alert">{deviceError}</div>}
      {recordingError && <div className="call-error" role="alert">{recordingError}</div>}
      {microphoneError && <div className="call-error" role="alert">{microphoneError}</div>}
      {cameraError && <div className="call-error camera-error" role="alert"><VideoOff size={17} /><span>{cameraError}</span><button type="button" disabled={busy || cameraPending || devicePending || !connected} onClick={() => void onToggleCamera()}>Coba kamera lagi</button></div>}
      {cameraBlurError && <div className="call-error camera-error" role="alert"><Sparkles size={17} /><span>{cameraBlurError}</span>{onClearCameraBlurError && <button type="button" onClick={onClearCameraBlurError}>Tutup</button>}</div>}
      {screenShareError && <div className="call-error" role="alert">{screenShareError}</div>}
      {!screenShareSupported && <div className="screen-share-hint" role="status">Berbagi layar belum tersedia di browser ini. Kamu tetap dapat melihat layar peserta lain.</div>}
      <div className={`meeting-video-area ${screenTracks.length ? 'presentation-layout' : showingSpeaker ? 'speaker-layout' : 'grid-layout'}`}>
        {screenTracks.length > 0 ? <ScreenShareStage tracks={screenTracks} /> : showingSpeaker ? <div className="speaker-primary"><ParticipantLayout participants={[spotlight]} cameras={camerasByIdentity} mirrorLocalVideo={mirrorLocalVideo} spotlightIdentity={spotlight.identity} /></div> : null}
        <ParticipantLayout participants={paging.items} cameras={camerasByIdentity} mirrorLocalVideo={mirrorLocalVideo} strip={screenTracks.length > 0 || showingSpeaker} />
        {!participants.length && <div className="waiting-participants"><Loader2 className="ui-spinner" size={30} aria-hidden="true" /><p>Menghubungkan peserta ke ruang rapat...</p></div>}
      </div>
      {paging.pages > 1 && <nav className="meeting-pagination" aria-label="Halaman peserta"><button type="button" aria-label="Halaman peserta sebelumnya" disabled={paging.page === 0} onClick={() => setRequestedPage(paging.page - 1)}><ChevronLeft size={17} /></button><span aria-live="polite">Halaman {paging.page + 1} dari {paging.pages}</span><button type="button" aria-label="Halaman peserta berikutnya" disabled={paging.page === paging.pages - 1} onClick={() => setRequestedPage(paging.page + 1)}><ChevronRight size={17} /></button></nav>}
      <div className="call-bottom-note"><span><AudioLines size={15} />Rapat audio &amp; video · Kamera bisa dimatikan kapan saja</span><span className="mic-level" role="meter" aria-label="Level mikrofon rapat" aria-valuemin={0} aria-valuemax={100} aria-valuenow={micVolume}><Mic size={14} /><i><b style={{ width: micVolume + '%' }} /></i></span></div>

    </section>

    {panelOpen && !compact && <div className="meeting-panel-divider" role="separator" tabIndex={0} aria-label="Ubah lebar panel transkrip" aria-orientation="vertical" aria-valuemin={Math.round(minPercent)} aria-valuemax={42} aria-valuenow={Math.round(panelWidth)}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = roomRef.current?.getBoundingClientRect(); if (bounds) resizePanel((bounds.right - event.clientX) / bounds.width * 100); }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); resizePanel(event.key === 'Home' ? minPercent : event.key === 'End' ? 42 : panelWidth + (event.key === 'ArrowLeft' ? 2 : -2)); }} />}
    <MeetingPanel open={panelOpen} compact={compact} onClose={closePanel}>
<div className="call-panel-tabs" role="tablist" aria-label="Panel rapat"><button ref={transcriptTab} role="tab" id={`${tabId}-transcript-tab`} aria-controls={`${tabId}-transcript-panel`} aria-selected={activeTab === 'transcript'} tabIndex={activeTab === 'transcript' ? 0 : -1} className={activeTab === 'transcript' ? 'active' : ''} onKeyDown={tabKeys} onClick={() => setActiveTab('transcript')}><FileText size={17} />Transkrip</button><button ref={attendanceTab} role="tab" id={`${tabId}-attendance-tab`} aria-controls={`${tabId}-attendance-panel`} aria-selected={activeTab === 'attendance'} tabIndex={activeTab === 'attendance' ? 0 : -1} className={activeTab === 'attendance' ? 'active' : ''} onKeyDown={tabKeys} onClick={() => setActiveTab('attendance')}><Users size={17} />Peserta <span>{participants.length}</span></button></div>
      <div className="call-tab-panel" role="tabpanel" id={`${tabId}-transcript-panel`} aria-labelledby={`${tabId}-transcript-tab`} hidden={activeTab !== 'transcript'} tabIndex={0}>
        <div className="transcription-settings"><div className="transcription-status" role="status"><i className={isListening ? 'status-dot online' : speechError ? 'status-dot offline' : 'status-dot'} />{transcriptStatus}</div><select aria-label="Bahasa transkripsi" value={speechLanguage} disabled={busy} onChange={event => setSpeechLanguage(event.target.value as 'id-ID' | 'en-US')}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select><label>Layanan transkripsi<select aria-label="Layanan transkripsi" value={sttProvider} disabled={busy} onChange={event => setSttProvider(event.target.value as 'browser' | 'server')}><option value="browser">Browser</option><option value="server" disabled={!sttConfigured}>Server{!sttConfigured ? ' · belum tersedia' : ''}</option></select></label></div>
        {speechError && <div className="transcription-error" role="alert"><p>{speechError}</p><button disabled={busy || !connected || isMuted || saveBlocked} onClick={onToggleTranscription}>Coba transkripsi lagi</button></div>}
        <div className="live-transcript-list" role="log" aria-label="Transkrip langsung" aria-live="polite" aria-relevant="additions" tabIndex={0}>
          {transcripts.length ? transcripts.map(entry => <article className="live-transcript-entry" key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time><span className={entry.speakerId === employeeId ? 'transcript-avatar local' : 'transcript-avatar'}>{initials(entry.speakerName)}</span><div><strong>{entry.speakerName}</strong><p>{entry.text}</p></div></article>) : <div className="transcript-empty"><span><AudioLines size={31} /></span><h3>Ruang untuk setiap suara.</h3><p>{isListening ? 'Mulai berbicara. Ucapan yang dikenali akan muncul di sini.' : 'Transkrip akan tampil setelah layanan mulai mendengarkan mikrofonmu.'}</p></div>}
        </div>
        {interimText && <div className="interim-transcript"><AudioLines size={16} /><p>{interimText}</p></div>}
        {import.meta.env.DEV && <details className="manual-transcript"><summary>Tambahkan ucapan manual <ChevronDown size={14} /></summary><form onSubmit={event => { event.preventDefault(); if (manualText.trim()) { onAddSpeechLine(manualText.trim()); setManualText(''); } }}><input aria-label="Ucapan manual" value={manualText} disabled={busy || saveBlocked} onChange={event => setManualText(event.target.value)} placeholder="Ketik ucapan untuk pengujian" required /><button type="submit" aria-label="Simpan ucapan manual" disabled={busy || saveBlocked}><Send size={16} /></button></form></details>}
        <div className={`listening-footer ${isListening ? 'listening' : ''} ${isVoiceActive ? 'voice-active' : ''}`}><div className="waveform" aria-hidden="true">{[9, 16, 23, 13, 27, 18, 32, 15, 24, 11, 20, 29, 14, 23, 10, 17].map((height, index) => <i key={index} style={{ height: isVoiceActive ? Math.max(3, Math.round(height * Math.min(1, micVolume / 30))) : 3, animationDelay: index * .06 + 's' }} />)}</div><span>{!connected ? 'Menunggu koneksi' : isMuted ? 'Mikrofon mati' : isVoiceActive ? 'Suara terdeteksi' : isListening ? 'Mendengarkan...' : 'Transkripsi siaga'}</span></div>
      </div><div className="call-tab-panel attendance-list" role="tabpanel" id={`${tabId}-attendance-panel`} aria-labelledby={`${tabId}-attendance-tab`} hidden={activeTab !== 'attendance'} tabIndex={0}><h3>Di ruang rapat <span>{participants.length}</span></h3>{participants.map(participant => <div className="attendance-entry" key={participant.identity}><span className="transcript-avatar">{initials(participant.name || participant.identity)}</span><div><strong>{participant.name || participant.identity}</strong><small>{participant.identity}</small></div><Check size={17} /></div>)}</div>
    </MeetingPanel>
    <MeetingControls busy={busy} connected={connected} devicePending={devicePending} isMuted={isMuted} microphonePending={microphonePending}
      isCameraEnabled={isCameraEnabled} cameraPending={cameraPending} isScreenShareEnabled={isScreenShareEnabled} screenSharePending={screenSharePending} screenShareSupported={screenShareSupported}
      speechEnabled={speechEnabled} speechError={speechError} isListening={isListening} saveBlocked={saveBlocked} finishLabel={finishLabel}
      recording={recording} recordingPending={recordingPending} onToggleRecording={() => onToggleRecording(!recording)}
      onToggleMute={onToggleMute} onToggleCamera={onToggleCamera} onToggleScreenShare={onToggleScreenShare} onToggleTranscription={onToggleTranscription}
      onOpenDevices={onOpenDevices} onParticipants={() => { setPanelOpen(true); setActiveTab('attendance'); }} transcriptOpen={panelOpen && activeTab === 'transcript'} onTranscript={() => { setPanelOpen(!panelOpen || activeTab !== 'transcript'); setActiveTab('transcript'); }} onFinish={requestFinish}
      onOpenBackgrounds={backgroundControl ? () => { setPanelOpen(false); setBackgroundsOpen(true); } : undefined}
      isCameraBlur={isCameraBlur} cameraBlurPending={cameraBlurPending} cameraBlurSupported={cameraBlurSupported} onToggleCameraBlur={onToggleCameraBlur} />
    {backgroundsOpen && backgroundControl && <BackgroundSettingsDialog control={backgroundControl} blocked={busy || devicePending || cameraPending || !connected} mirror={mirrorLocalVideo} onClose={() => setBackgroundsOpen(false)} />}
  </div>;
}
