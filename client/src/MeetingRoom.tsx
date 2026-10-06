import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Participant } from 'livekit-client';
import { Track } from 'livekit-client';
import type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { AudioLines, Check, ChevronDown, FileText, Loader2, Mic, MicOff, MonitorUp, MonitorOff, PhoneOff, Send, Settings2, Users, Video, VideoOff } from 'lucide-react';
import { initials } from './presentation';
import { ParticipantVideoTile } from './ParticipantVideoTile';
import { ScreenShareStage } from './ScreenShareStage';

interface Transcript {
  id: string; speakerId: string; speakerName: string; text: string; timestamp: string;
}

export function MeetingRoom({ participants, roomName, employeeId, connected, isMuted, micVolume, finishing, isSummarizing, finishError, speechError, interimText, isListening, speechEnabled, saveBlocked, sttProvider, sttConfigured, setSttProvider, speechLanguage, setSpeechLanguage, activeTab, setActiveTab, transcripts, onToggleMute, onToggleTranscription, onFinish, onAddSpeechLine, cameraTracks, isCameraEnabled, cameraPending, cameraError, microphoneError, onToggleCamera, screenTracks, isScreenShareEnabled, screenSharePending, screenShareError, screenShareSupported, onToggleScreenShare, devicePending, deviceError, onOpenDevices, spotlightIdentity }: {
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
  spotlightIdentity: string | null;
}) {
  const [manualText, setManualText] = useState('');
  const [finishMode, setFinishMode] = useState<'summary' | 'leave' | null>(null);
  const busy = finishing || isSummarizing;
  const camerasByIdentity = new Map(cameraTracks.map(track => [track.participant.identity, track]));
  const spotlight = participants.find(participant => participant.identity === spotlightIdentity) || participants[0];
  const showingSpeaker = screenTracks.length === 0 && Boolean(spotlight);
  const isVoiceActive = connected && !isMuted && micVolume > 5;
  const finishLabel = !busy ? null : finishing && !isSummarizing ? 'Menyimpan transkrip…' : finishMode === 'summary' ? 'Menyiapkan notulen…' : 'Menyimpan rapat…';
  const requestFinish = (generate: boolean) => {
    setFinishMode(generate ? 'summary' : 'leave');
    void onFinish(generate).finally(() => setFinishMode(null));
  };
  const transcriptStatus = !connected ? 'Menunggu koneksi' : isMuted ? 'Mikrofon nonaktif' : saveBlocked ? 'Penyimpanan tertunda' : speechError ? 'Transkripsi bermasalah' : isListening ? 'Mendengarkan' : speechEnabled ? 'Memulai transkripsi' : 'Transkripsi dihentikan';

  return <div className="call-room">
    <section className={`call-stage ${screenTracks.length ? 'has-screen-share' : ''}`}>
      <div className="call-info-bar"><div><span className="room-label">#{roomName}</span><span className="call-connection"><i className={connected ? 'status-dot online' : 'status-dot offline'} />{connected ? 'Terhubung' : 'Menghubungkan'}</span></div><span className="participant-count"><Users size={16} />{participants.length} peserta</span></div>
      {finishError && <div className="call-error" role="alert">{finishError}</div>}
      {deviceError && <div className="call-error" role="alert">{deviceError}</div>}
      {microphoneError && <div className="call-error" role="alert">{microphoneError}</div>}
      {cameraError && <div className="call-error camera-error" role="alert"><VideoOff size={17} /><span>{cameraError}</span><button type="button" disabled={busy || cameraPending || devicePending || !connected} onClick={() => void onToggleCamera()}>Coba kamera lagi</button></div>}
      {screenShareError && <div className="call-error" role="alert">{screenShareError}</div>}
      {!screenShareSupported && <div className="screen-share-hint" role="status">Berbagi layar belum tersedia di browser ini. Kamu tetap dapat melihat layar peserta lain.</div>}
      {screenTracks.length > 0 && <ScreenShareStage tracks={screenTracks} />}
      {showingSpeaker && <div className="speaker-focus-status" role="status"><AudioLines size={15} /><span>Sorotan otomatis · <strong>{spotlight.name || spotlight.identity}</strong>{spotlight.isLocal ? ' (Kamu)' : ''}</span></div>}
      <div className={`participant-grid ${showingSpeaker ? 'spotlight-grid' : ''} ${participants.length < 3 ? 'small-room' : ''}`} style={{ '--speaker-columns': Math.max(1, Math.min(3, participants.length - 1)) } as CSSProperties}>
        {participants.map(participant => <ParticipantVideoTile key={participant.identity} spotlight={showingSpeaker && participant.identity === spotlight.identity} trackRef={camerasByIdentity.get(participant.identity) || { participant, source: Track.Source.Camera }} />)}
        {!participants.length && <div className="waiting-participants"><Loader2 className="ui-spinner" size={30} aria-hidden="true" /><p>Menghubungkan peserta ke ruang rapat...</p></div>}
      </div>
      <div className="call-bottom-note"><span><AudioLines size={15} />Rapat audio &amp; video · Kamera bisa dimatikan kapan saja</span><span className="mic-level"><Mic size={14} /><i><b style={{ width: micVolume + '%' }} /></i></span></div>
      <footer className="call-control-bar"><div className="call-controls"><button className={`call-control ${isMuted ? 'control-muted' : ''}`} disabled={busy || devicePending || !connected} onClick={() => void onToggleMute()}>{isMuted ? <MicOff size={22} /> : <Mic size={22} />}<span>{isMuted ? 'Aktifkan mic' : 'Mikrofon'}</span></button><button type="button" className={`call-control ${isCameraEnabled ? 'control-active' : 'control-muted'}`} aria-label={isCameraEnabled ? 'Matikan kamera' : 'Aktifkan kamera'} aria-pressed={isCameraEnabled} aria-busy={cameraPending} disabled={busy || cameraPending || devicePending || !connected} onClick={() => void onToggleCamera()}>{cameraPending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isCameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}<span>{cameraPending ? 'Memproses...' : isCameraEnabled ? 'Kamera' : 'Aktifkan kamera'}</span></button><button type="button" className={`call-control ${isScreenShareEnabled ? 'control-active' : ''}`} aria-label={isScreenShareEnabled ? 'Hentikan berbagi layar' : 'Bagikan layar'} aria-pressed={isScreenShareEnabled} aria-busy={screenSharePending} disabled={busy || screenSharePending || !connected || (!screenShareSupported && !isScreenShareEnabled)} onClick={() => void onToggleScreenShare()}>{screenSharePending ? <Loader2 className="ui-spinner" size={22} aria-hidden="true" /> : isScreenShareEnabled ? <MonitorOff size={22} /> : <MonitorUp size={22} />}<span>{screenSharePending ? 'Memproses...' : isScreenShareEnabled ? 'Hentikan layar' : 'Bagikan layar'}</span></button><button className={`call-control ${isListening ? 'control-active' : ''}`} disabled={busy || !connected || isMuted || saveBlocked} onClick={onToggleTranscription}><AudioLines size={22} /><span>{speechError ? 'Coba transkrip' : speechEnabled ? 'Jeda transkrip' : 'Mulai transkrip'}</span></button><button type="button" className="call-control" aria-label="Pengaturan perangkat" aria-haspopup="dialog" disabled={busy || !connected} onClick={onOpenDevices}><Settings2 size={22} /><span>Perangkat</span></button><button className="call-control" onClick={() => setActiveTab('attendance')}><Users size={22} /><span>Peserta</span></button></div><div className="leave-controls"><button className="leave-simple" disabled={busy} onClick={() => requestFinish(false)}>Keluar</button><button className="leave-button" disabled={busy} onClick={() => requestFinish(true)} aria-busy={busy}>{busy && <Loader2 className="ui-spinner" size={16} aria-hidden="true" />}{busy ? finishLabel : <><PhoneOff size={18} />Selesai &amp; notulen</>}</button></div></footer>
    </section>

    <aside className="call-side-panel"><div className="call-panel-tabs"><button className={activeTab === 'transcript' ? 'active' : ''} onClick={() => setActiveTab('transcript')}><FileText size={17} />Transkrip</button><button className={activeTab === 'attendance' ? 'active' : ''} onClick={() => setActiveTab('attendance')}><Users size={17} />Peserta <span>{participants.length}</span></button></div>
      {activeTab === 'transcript' ? <>
        <div className="transcription-settings"><div className="transcription-status" role="status"><i className={isListening ? 'status-dot online' : speechError ? 'status-dot offline' : 'status-dot'} />{transcriptStatus}</div><select aria-label="Bahasa transkripsi" value={speechLanguage} disabled={busy} onChange={event => setSpeechLanguage(event.target.value as 'id-ID' | 'en-US')}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select><label>Layanan transkripsi<select aria-label="Layanan transkripsi" value={sttProvider} disabled={busy} onChange={event => setSttProvider(event.target.value as 'browser' | 'server')}><option value="browser">Browser</option><option value="server" disabled={!sttConfigured}>Server{!sttConfigured ? ' · belum tersedia' : ''}</option></select></label></div>
        {speechError && <div className="transcription-error" role="alert"><p>{speechError}</p><button disabled={busy || !connected || isMuted || saveBlocked} onClick={onToggleTranscription}>Coba transkripsi lagi</button></div>}
        <div className="live-transcript-list">
          {transcripts.length ? transcripts.map(entry => <article className="live-transcript-entry" key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time><span className={entry.speakerId === employeeId ? 'transcript-avatar local' : 'transcript-avatar'}>{initials(entry.speakerName)}</span><div><strong>{entry.speakerName}</strong><p>{entry.text}</p></div></article>) : <div className="transcript-empty"><span><AudioLines size={31} /></span><h3>Ruang untuk setiap suara.</h3><p>{isListening ? 'Mulai berbicara. Ucapan yang dikenali akan muncul di sini.' : 'Transkrip akan tampil setelah layanan mulai mendengarkan mikrofonmu.'}</p></div>}
        </div>
        {interimText && <div className="interim-transcript"><AudioLines size={16} /><p>{interimText}</p></div>}
        {import.meta.env.DEV && <details className="manual-transcript"><summary>Tambahkan ucapan manual <ChevronDown size={14} /></summary><form onSubmit={event => { event.preventDefault(); if (manualText.trim()) { onAddSpeechLine(manualText.trim()); setManualText(''); } }}><input aria-label="Ucapan manual" value={manualText} disabled={busy || saveBlocked} onChange={event => setManualText(event.target.value)} placeholder="Ketik ucapan untuk pengujian" required /><button type="submit" aria-label="Simpan ucapan manual" disabled={busy || saveBlocked}><Send size={16} /></button></form></details>}
        <div className={`listening-footer ${isListening ? 'listening' : ''} ${isVoiceActive ? 'voice-active' : ''}`}><div className="waveform" aria-hidden="true">{[9, 16, 23, 13, 27, 18, 32, 15, 24, 11, 20, 29, 14, 23, 10, 17].map((height, index) => <i key={index} style={{ height: isVoiceActive ? Math.max(3, Math.round(height * Math.min(1, micVolume / 30))) : 3, animationDelay: index * .06 + 's' }} />)}</div><span>{!connected ? 'Menunggu koneksi' : isMuted ? 'Mikrofon mati' : isVoiceActive ? 'Suara terdeteksi' : isListening ? 'Mendengarkan...' : 'Transkripsi siaga'}</span></div>
      </> : <div className="attendance-list"><h3>Di ruang rapat <span>{participants.length}</span></h3>{participants.map(participant => <div className="attendance-entry" key={participant.identity}><span className="transcript-avatar">{initials(participant.name || participant.identity)}</span><div><strong>{participant.name || participant.identity}</strong><small>{participant.identity}</small></div><Check size={17} /></div>)}</div>}
    </aside>
  </div>;
}
