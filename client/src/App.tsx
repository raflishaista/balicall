import { useState, useEffect, useEffectEvent, useRef } from 'react';
import { apiRequest, meetingPath } from './api';
import { createSaveQueue } from './saveQueue';
import { useBackendTranscription } from './useBackendTranscription';
import { useSpeechTranscription } from './useSpeechTranscription';
import './App.css';
import { BrandLogo, HomeDashboard, LobbyView, WorkspaceSidebar } from './Workspace';
import { initials } from './presentation';
import { MeetingRoom } from './MeetingRoom';
import { Track, ConnectionState } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useTrackVolume,
  useConnectionState,
} from '@livekit/components-react';
import {
  Copy,
  Check,
  ArrowRight,
  Clock,
  AlertCircle,
  Loader2,
  Volume2,
  Search,
  ChevronLeft,
} from 'lucide-react';

function mergeTranscripts(current: TranscriptEntry[], incoming: TranscriptEntry[]) {
  const byId = new Map([...current, ...incoming].map(entry => [entry.id, entry]));
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

interface TranscriptEntry {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  timestamp: string;
}

interface ActionItem {
  task: string;
  assignee: string;
  priority: 'High' | 'Medium' | 'Low';
  deadline: string;
}

interface MeetingSummary {
  title: string;
  executiveSummary: string;
  keyDiscussionPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  attendanceSummary: string[];
  transcriptCount?: number;
  provider?: string;
  note?: string;
  generatedAt?: string;
}

const PRESET_PERSONAS = [
  { id: 'BT-10492', name: 'Rafli Aditya', dept: 'NOC & Core Network' },
  { id: 'BT-10214', name: 'Budi Santoso', dept: 'Field Transmission' },
  { id: 'BT-10883', name: 'Siti Rahma', dept: 'Project Management' },
  { id: 'BT-10550', name: 'Agus Pratama', dept: 'Fiber Infrastructure' },
];

export default function App() {
  const [view, setView] = useState<'home' | 'lobby' | 'in-call' | 'summary'>('home');
  const [meetingIntent, setMeetingIntent] = useState<'create' | 'join'>('create');
  const [lastMeeting, setLastMeeting] = useState<{ title: string; roomName: string; endedAt: string; transcriptCount: number } | null>(null);
  
  // Lobby state
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [department, setDepartment] = useState('');
  const [roomName, setRoomName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  
  // Connection state
  const [token, setToken] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [sttProvider, setSttProvider] = useState<'browser' | 'server'>('browser');
  const [serverUrl, setServerUrl] = useState('ws://127.0.0.1:7880');
  
  // Active call state
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'transcript' | 'attendance'>('transcript');
  const [callDuration, setCallDuration] = useState('00:00');
  const [meetingStartTime, setMeetingStartTime] = useState<number | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [transcriptSaveError, setTranscriptSaveError] = useState<string | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saveQueue] = useState(() => createSaveQueue<{ entry: TranscriptEntry | null }>({
    onSaved: ({ entry }) => { if (entry) setTranscripts(previous => mergeTranscripts(previous, [entry])); },
    onChange: (count, error) => { setPendingSaves(count); setTranscriptSaveError(error); },
  }));

  // Backend Health and LLM status
  const [backendHealth, setBackendHealth] = useState<{
    status: string;
    llmProvider?: string;
    llmModel?: string;
    llmBaseUrl?: string;
    hasLlmKey?: boolean;
    llmEffectiveProvider?: string;
    livekitStatus?: string;
    sttProvider?: 'browser' | 'server';
    sttConfigured?: boolean;
  } | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const data = await apiRequest<NonNullable<typeof backendHealth>>('/health', {}, 5000);
        if (!cancelled) setBackendHealth(data);
      } catch { if (!cancelled) setBackendHealth(null); }
      finally { if (!cancelled) setHealthChecked(true); }
    };
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (view !== 'in-call' || !meetingStartTime) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
      setCallDuration(String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0'));
    }, 1000);
    return () => clearInterval(interval);
  }, [view, meetingStartTime]);

  useEffect(() => {
    if (view !== 'in-call' || !meetingId || !token) return;
    let cancelled = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      try {
        const data = await apiRequest<{ transcripts: TranscriptEntry[] }>(meetingPath(meetingId, 'transcript'), {
          headers: { Authorization: 'Bearer ' + token }, signal: abort.signal,
        });
        if (!cancelled) { setTranscripts(previous => mergeTranscripts(previous, data.transcripts)); setSyncError(null); }
      } catch { if (!cancelled) setSyncError('Transkrip belum tersinkron. Periksa koneksi layanan.'); }
      if (!cancelled) timer = setTimeout(sync, 2000);
    };
    void sync();
    return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, [view, meetingId, token]);

  useEffect(() => {
    if (!pendingSaves) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingSaves]);

  const handleJoin = async () => {
    if (!employeeId.trim() || !employeeName.trim() || !roomName.trim()) {
      setJoinError('Lengkapi identitas dan nama room.'); return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setJoinError('Mikrofon membutuhkan HTTPS atau localhost. Untuk PC lain, gunakan alamat HTTPS aplikasi.'); return;
    }
    setJoinError(null); setCallError(null); setSyncError(null); setIsJoining(true);
    try {
      const data = await apiRequest<{ token: string; url: string; meetingId: string; sttProvider: 'browser' | 'server' }>('/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomName.trim(), employeeId: employeeId.trim(), employeeName: employeeName.trim(), department }),
      });
      setToken(data.token); setMeetingId(data.meetingId); setServerUrl(data.url); setSttProvider(data.sttProvider);
      setTranscripts([]); setCallDuration('00:00'); setMeetingStartTime(Date.now()); setView('in-call');
    } catch (error) { setJoinError(error instanceof Error ? error.message : 'Gagal bergabung'); }
    finally { setIsJoining(false); }
  };

  const handleEndMeeting = async (generate = true) => {
    if (!meetingId || !token) return;
    setIsSummarizing(true); setCallError(null);
    try {
      await saveQueue.flush();
      const options = { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' };
      const data = generate ? await apiRequest<{ summary: MeetingSummary }>(meetingPath(meetingId, 'summarize'), options, 125000) : null;
      const left = await apiRequest<{ status: string }>(meetingPath(meetingId, 'leave'), options);
      if (data) {
        setLastMeeting({ title: data.summary.title, roomName, endedAt: data.summary.generatedAt || new Date().toISOString(), transcriptCount: data.summary.transcriptCount || transcripts.length });
        setSummary(left.status === 'active' ? { ...data.summary, note: [data.summary.note, 'Peserta lain masih berada di meeting. Ringkasan ini memakai transkrip saat permintaan ringkasan dikirim.'].filter(Boolean).join(' ') } : data.summary);
        setView('summary');
      } else { setToken(null); setMeetingId(null); setTranscripts([]); setView('home'); }
    } catch (error) {
      setCallError(error instanceof Error ? error.message : 'Gagal menyelesaikan meeting. Coba kembali.');
    } finally { setIsSummarizing(false); }
  };

  const handleAddSpeechLine = (text: string) => {
    if (!text.trim() || !meetingId || !token) return;
    const path = meetingPath(meetingId, 'transcript');
    saveQueue.enqueue(requestId => apiRequest(path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), requestId }),
    }));
  };

  const handleAddAudio = (audio: Blob, language: string) => {
    if (!meetingId || !token) return;
    const path = meetingPath(meetingId, 'audio');
    saveQueue.enqueue(requestId => apiRequest(path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': audio.type,
        'X-Request-Id': requestId, 'X-Speech-Language': language.split('-')[0] }, body: audio,
    }, 125000));
  };

  const handlePresence = async (connected: boolean) => {
    if (!meetingId || !token) return;
    try { await apiRequest(meetingPath(meetingId, 'presence'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ connected }),
    }, 5000); } catch { if (connected) setSyncError('Kehadiran belum tersinkron. Periksa koneksi layanan.'); }
  };

  const copyMarkdownSummary = () => {
    if (!summary) return;
    const md = `
# Notulen BaliTower Sentra: ${summary.title}
**Tanggal:** ${new Date().toLocaleDateString('id-ID')} | **Ruang:** ${roomName}
**Peserta:** ${summary.attendanceSummary?.join(', ') || 'Belum tercatat'}
**Layanan ringkasan:** ${summary.provider || 'Tidak diketahui'}

---
### Ringkasan
${summary.executiveSummary}

---
### Pokok pembahasan
${summary.keyDiscussionPoints?.map(p => `- ${p}`).join('\n')}

---
### Keputusan
${summary.decisions?.map(d => `- ${d}`).join('\n')}

---
### Tindak lanjut
| Tugas | Penanggung jawab | Prioritas | Tenggat |
| --- | --- | --- | --- |
${summary.actionItems?.map(a => `| ${a.task} | ${a.assignee} | ${a.priority} | ${a.deadline} |`).join('\n')}

---
*Dibuat oleh BaliTower Sentra Meeting*
    `.trim();

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCallError('Tidak dapat menyalin ringkasan. Periksa izin clipboard browser.'));
  };

  const openLobby = (intent: 'create' | 'join') => {
    setMeetingIntent(intent);
    setJoinError(null);
    setView('lobby');
  };

  return (
    <div className={`app-root ${view === 'in-call' ? 'in-call-layout' : ''}`}>
      {view !== 'in-call' && <WorkspaceSidebar view={view} intent={meetingIntent} employeeName={employeeName} hasSummary={Boolean(summary)} onHome={() => setView('home')} onCreate={() => openLobby('create')} onJoin={() => openLobby('join')} onSummary={() => setView('summary')} />}
      <div className="workspace-body">
      <header className={`app-header ${view === 'in-call' ? 'app-header-call' : ''}`}>
        {view === 'in-call' ? <div className="call-brand"><BrandLogo inverse /><span>Bali Tower Sentra</span></div> : <div className="page-identity"><span>Workspace / {view === 'home' ? 'Beranda' : view === 'lobby' ? 'Ruang rapat' : 'Notulen'}</span><strong>Internal Meeting & AI Minutes</strong></div>}

        <div className="header-meta">
          {view === 'in-call' ? <div className="call-clock"><Clock size={15} />{callDuration}</div> : (
            <div className={`service-status ${backendHealth ? 'is-online' : healthChecked ? 'is-offline' : 'is-checking'}`} role="status">
              <span className="status-dot" />
              {backendHealth ? `Layanan ${backendHealth.livekitStatus === 'reachable' ? 'siap' : 'terbatas'}` : healthChecked ? 'Layanan tidak tersambung' : 'Memeriksa layanan'}
            </div>
          )}
          <span className="user-avatar" title={employeeName || 'Bali Tower Sentra'}>{initials(employeeName)}</span>
        </div>
      </header>

      {(callError || syncError || transcriptSaveError || pendingSaves > 0) && <div className="app-alert" role="status" aria-live="polite" aria-busy={pendingSaves > 0}>
        {pendingSaves > 0 && <Loader2 className="ui-spinner" size={15} aria-hidden="true" />}
        {callError || syncError || transcriptSaveError} {pendingSaves > 0 && <span>{pendingSaves} ucapan menunggu tersimpan.</span>}
        {transcriptSaveError && <button className="text-button" onClick={() => saveQueue.retry()}>Coba simpan lagi</button>}
      </div>}
      <main className="app-main">
        {view === 'home' && <HomeDashboard
          backendHealth={backendHealth}
          lastMeeting={lastMeeting}
          employeeName={employeeName}
          onCreate={() => openLobby('create')}
          onJoin={(code?: string) => { if (code) setRoomName(code); openLobby('join'); }}
        />}
        {view === 'lobby' && (
          <LobbyView
            intent={meetingIntent}
            onIntentChange={setMeetingIntent}
            employeeId={employeeId}
            setEmployeeId={setEmployeeId}
            employeeName={employeeName}
            setEmployeeName={setEmployeeName}
            department={department}
            setDepartment={setDepartment}
            roomName={roomName}
            setRoomName={setRoomName}
            isJoining={isJoining}
            joinError={joinError}
            onJoin={handleJoin}
            microphoneDiagnostic={<MicrophoneDiagnostic />}
            personas={PRESET_PERSONAS}
          />
        )}

        {view === 'in-call' && token && (
          <InCallView
            token={token}
            sttProvider={sttProvider}
            setSttProvider={setSttProvider}
            sttConfigured={backendHealth?.sttConfigured || false}
            saveBlocked={Boolean(transcriptSaveError)}
            onAddAudio={handleAddAudio}
            onPresence={handlePresence}
            serverUrl={serverUrl}
            roomName={roomName}
            employeeId={employeeId}
            employeeName={employeeName}
            transcripts={transcripts}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onAddSpeechLine={handleAddSpeechLine}
            onEndMeeting={handleEndMeeting}
            isSummarizing={isSummarizing}
          />
        )}

        {view === 'summary' && summary && (
          <SummaryView
            summary={summary}
            roomName={roomName}
            transcripts={transcripts}
            copied={copied}
            onCopy={copyMarkdownSummary}
            onNewCall={() => {
              setToken(null);
              setMeetingId(null);
              setCallError(null);
              setTranscripts([]);
              setSummary(null);
              setView('home');
            }}
          />
        )}
      </main>
      </div>
    </div>
  );
}

// ==========================================
// 🎙️ MICROPHONE HARDWARE TESTER COMPONENT
// ==========================================
function MicrophoneDiagnostic() {
  const [volume, setVolume] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [micName, setMicName] = useState<string>('Detecting microphone...');
  const [micError, setMicError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const micRequestRef = useRef(0);
  const [isRequestingMic, setIsRequestingMic] = useState(false);

  const startMicTest = async () => {
    const request = ++micRequestRef.current;
    setIsRequestingMic(true);
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== micRequestRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      setMicName(track?.label || 'Default Microphone');

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setVolume(normalized);
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
      setIsCapturing(true);
    } catch (err: any) {
      if (request !== micRequestRef.current) return;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.error('Microphone access failed:', err);
      setMicError(err.message || 'Microphone access denied. Please grant permission in your browser.');
    } finally { if (request === micRequestRef.current) setIsRequestingMic(false); }
  };

  const stopMicTest = () => {
    micRequestRef.current++;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsCapturing(false);
    setVolume(0);
  };

  useEffect(() => {
    return () => stopMicTest();
  }, []);

  return (
    <div className="microphone-check">
      <div className="microphone-check-heading"><span><Volume2 size={17} />Periksa mikrofon</span><button type="button" disabled={isRequestingMic} onClick={isCapturing ? stopMicTest : startMicTest}>{isRequestingMic ? 'Meminta izin...' : isCapturing ? 'Hentikan' : 'Uji suara'}</button></div>
      {micError && <p className="microphone-error" role="alert">{micError}</p>}
      <div className="microphone-volume"><span style={{ width: volume + '%' }} /></div>
      <div className={`diagnostic-wave ${isCapturing && volume > 5 ? 'voice-active' : ''}`} aria-hidden="true">{[7, 12, 19, 10, 23, 15, 20, 9, 17, 12, 22, 8, 16, 11].map((height, index) => <i key={index} style={{ height: isCapturing && volume > 5 ? Math.max(3, Math.round(height * Math.min(1, volume / 30))) : 3, animationDelay: index * .05 + 's' }} />)}</div>
      <p>{isCapturing ? volume > 10 ? 'Suaramu terdeteksi. Mikrofon siap digunakan.' : 'Coba berbicara dan perhatikan indikator suara.' : 'Uji input suara sebelum bergabung ke rapat.'}</p>
      {isCapturing && <small>{micName} · {volume}%</small>}
    </div>
  );
}
function InCallView({
  sttProvider, setSttProvider, sttConfigured, saveBlocked, onAddAudio, onPresence,
  token,
  serverUrl,
  roomName,
  employeeId,
  employeeName,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechLine,
  onEndMeeting,
  isSummarizing,
}: any) {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
    {connectionError && <div role="alert" style={{ padding: '12px', color: '#fca5a5' }}>{connectionError}</div>}
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      onError={(error: Error) => setConnectionError('Koneksi suara gagal: ' + error.message)}
      onConnected={() => setConnectionError(null)}
      onMediaDeviceFailure={() => setConnectionError('Mikrofon tidak tersedia. Periksa perangkat dan izin browser.')}
      audio={true}
      video={false}
      style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
    >
      <RoomAudioRenderer />
      <RoomContent
        sttProvider={sttProvider} setSttProvider={setSttProvider} sttConfigured={sttConfigured}
        saveBlocked={saveBlocked} onAddAudio={onAddAudio} onPresence={onPresence}
        roomName={roomName}
        employeeId={employeeId}
        employeeName={employeeName}
        transcripts={transcripts}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onAddSpeechLine={onAddSpeechLine}
        onEndMeeting={onEndMeeting}
        isSummarizing={isSummarizing}
      />
    </LiveKitRoom>
    </div>
  );
}

function RoomContent({
  sttProvider, setSttProvider, sttConfigured, saveBlocked, onAddAudio, onPresence,
  roomName,
  employeeId,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechLine,
  onEndMeeting,
  isSummarizing,
}: any) {
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const isMuted = !isMicrophoneEnabled;
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const presence = useEffectEvent((value: boolean) => onPresence(value));
  useEffect(() => {
    void presence(connected);
    if (!connected) return;
    const timer = setInterval(() => void presence(true), 10000);
    return () => clearInterval(timer);
  }, [connected]);
  const volume = useTrackVolume(microphoneTrack ? { participant: localParticipant, publication: microphoneTrack, source: Track.Source.Microphone } : undefined);
  const micVolume = isMuted ? 0 : Math.min(100, Math.round(volume * 100));
  const [speechLanguage, setSpeechLanguage] = useState<'id-ID' | 'en-US'>('id-ID');
  const paused = isMuted || !connected || isSummarizing || saveBlocked;
  const browserSpeech = useSpeechTranscription({ language: speechLanguage, muted: paused || sttProvider !== 'browser', onFinal: onAddSpeechLine });
  const backendSpeech = useBackendTranscription({ language: speechLanguage, muted: paused || sttProvider !== 'server',
    track: microphoneTrack?.track?.mediaStreamTrack, volume, onAudio: onAddAudio });
  const { isListeningSpeechApi, interimText, speechError, toggleSpeechRecognition, speechEnabled, finishTranscription } =
    sttProvider === 'server' ? backendSpeech : browserSpeech;
  const finishMeeting = async (generate: boolean) => {
    setFinishing(true); setFinishError(null);
    try { await finishTranscription(); await onEndMeeting(generate); }
    catch (error) { setFinishError(error instanceof Error ? error.message : 'Gagal menyelesaikan transkripsi'); }
    finally { setFinishing(false); }
  };
  const toggleMute = async () => {
    try { await localParticipant.setMicrophoneEnabled(isMuted); }
    catch (error) { setFinishError(error instanceof Error ? error.message : 'Gagal mengubah mikrofon'); }
  };

  return <MeetingRoom
    participants={participants} localParticipant={localParticipant} roomName={roomName} employeeId={employeeId}
    connected={connected} isMuted={isMuted} micVolume={micVolume} finishing={finishing} isSummarizing={isSummarizing}
    finishError={finishError} speechError={speechError} interimText={interimText} isListening={isListeningSpeechApi}
    speechEnabled={speechEnabled} saveBlocked={saveBlocked} sttProvider={sttProvider} sttConfigured={sttConfigured}
    setSttProvider={setSttProvider} speechLanguage={speechLanguage} setSpeechLanguage={setSpeechLanguage}
    activeTab={activeTab} setActiveTab={setActiveTab} transcripts={transcripts}
    onToggleMute={toggleMute} onToggleTranscription={toggleSpeechRecognition} onFinish={finishMeeting} onAddSpeechLine={onAddSpeechLine}
  />;
}
function SummaryView({
  summary,
  roomName,
  transcripts,
  copied,
  onCopy,
  onNewCall,
}: {
  summary: MeetingSummary;
  roomName: string;
  transcripts: TranscriptEntry[];
  copied: boolean;
  onCopy: () => void;
  onNewCall: () => void;
}) {
  const [tab, setTab] = useState<'summary' | 'decisions' | 'actions' | 'transcript'>('summary');
  const [query, setQuery] = useState('');
  const filteredTranscripts = transcripts.filter(entry =>
    `${entry.speakerName} ${entry.text}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))
  );
  const tabs = [
    { id: 'summary', label: 'Ringkasan' },
    { id: 'decisions', label: `Keputusan (${summary.decisions.length})` },
    { id: 'actions', label: `Tindak lanjut (${summary.actionItems.length})` },
    { id: 'transcript', label: `Transkrip (${transcripts.length})` },
  ] as const;

  return (
    <div className="summary-page">
      <button className="back-link" onClick={onNewCall}><ChevronLeft size={16} /> Kembali ke beranda</button>
      <section className="summary-card">
        <header className="summary-heading">
          <div>
            <p className="eyebrow">NOTULEN RAPAT · {summary.provider || 'AI ASSISTANT'}</p>
            <h1>{summary.title}</h1>
            <p className="summary-meta">Ruang <strong>#{roomName}</strong> · {summary.generatedAt ? new Date(summary.generatedAt).toLocaleString('id-ID') : 'Waktu tidak tersedia'} · {transcripts.length} ucapan</p>
          </div>
          <div className="summary-actions">
            <button className="button-secondary" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Tersalin' : 'Salin notulen'}</button>
            <button className="button-primary" onClick={onNewCall}>Rapat baru <ArrowRight size={15} /></button>
          </div>
        </header>

        {summary.note && <div className="summary-note"><AlertCircle size={16} />{summary.note}</div>}

        <nav className="summary-tabs" aria-label="Bagian notulen" role="tablist">
          {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`summary-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>

        {tab === 'summary' && <div className="summary-panel">
          <section className="summary-section"><h2>Ringkasan rapat</h2><p>{summary.executiveSummary || 'Belum ada ringkasan yang tersedia.'}</p></section>
          <div className="summary-preview-grid">
            <section className="summary-section"><h2>Keputusan</h2>{summary.decisions.length ? <ol className="summary-list">{summary.decisions.slice(0, 3).map((decision, index) => <li key={index}>{decision}</li>)}</ol> : <p>Belum ada keputusan yang tercatat.</p>}</section>
            <section className="summary-section"><h2>Tindak lanjut</h2>{summary.actionItems.length ? <ol className="summary-list">{summary.actionItems.slice(0, 3).map((item, index) => <li key={index}><strong>{item.assignee}</strong> · {item.task}</li>)}</ol> : <p>Belum ada tindak lanjut yang tercatat.</p>}</section>
          </div>
          <section className="summary-section"><h2>Pokok pembahasan</h2>{summary.keyDiscussionPoints.length ? <ul className="summary-list">{summary.keyDiscussionPoints.map((point, index) => <li key={index}>{point}</li>)}</ul> : <p>Belum ada pokok pembahasan.</p>}</section>
          <section className="summary-section"><h2>Peserta</h2><div className="attendee-list">{summary.attendanceSummary.length ? summary.attendanceSummary.map((attendee, index) => <span key={index}>{attendee}</span>) : <span>Data peserta tidak tersedia</span>}</div></section>
        </div>}

        {tab === 'decisions' && <div className="summary-panel"><section className="summary-section"><h2>Keputusan rapat</h2>{summary.decisions.length ? <ol className="summary-list ordered">{summary.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ol> : <p>Belum ada keputusan yang tercatat.</p>}</section></div>}

        {tab === 'actions' && <div className="summary-panel"><section className="summary-section"><h2>Tindak lanjut</h2>{summary.actionItems.length ? <div className="action-table-wrap"><table className="action-table"><thead><tr><th>Tugas</th><th>Penanggung jawab</th><th>Prioritas</th><th>Tenggat</th></tr></thead><tbody>{summary.actionItems.map((item, index) => <tr key={index}><td>{item.task}</td><td>{item.assignee || 'Belum ditentukan'}</td><td><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.deadline || 'Belum ditentukan'}</td></tr>)}</tbody></table></div> : <p>Belum ada tindak lanjut yang tercatat.</p>}</section></div>}

        {tab === 'transcript' && <div className="summary-panel"><section className="summary-section">
          <div className="transcript-heading"><div><h2>Transkrip lengkap</h2><p>{filteredTranscripts.length} dari {transcripts.length} ucapan</p></div><label className="transcript-search"><Search size={15} /><input aria-label="Cari transkrip" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau isi ucapan" /></label></div>
          {filteredTranscripts.length ? <div className="recap-transcript-list">{filteredTranscripts.map(entry => <article className="recap-transcript-entry" key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{entry.speakerName}</strong><p>{entry.text}</p></div></article>)}</div> : <p className="empty-transcript">{transcripts.length ? 'Tidak ada ucapan yang cocok dengan pencarian.' : 'Belum ada transkrip untuk rapat ini.'}</p>}
        </section></div>}
      </section>
    </div>
  );
}
