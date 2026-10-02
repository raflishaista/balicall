import { useState, useEffect, useEffectEvent, useRef } from 'react';
import { apiRequest, meetingPath } from './api';
import { createSaveQueue } from './saveQueue';
import { useBackendTranscription } from './useBackendTranscription';
import { useSpeechTranscription } from './useSpeechTranscription';
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
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Users,
  FileText,
  Sparkles,
  Send,
  Copy,
  Check,
  Activity,
  ArrowRight,
  ShieldCheck,
  Radio,
  Clock,
  AlertCircle,
  Volume2,
  Cpu
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
  const [view, setView] = useState<'lobby' | 'in-call' | 'summary'>('lobby');
  
  // Lobby state
  const [employeeId, setEmployeeId] = useState('BT-10492');
  const [employeeName, setEmployeeName] = useState('Rafli Aditya');
  const [department, setDepartment] = useState('NOC & Core Network');
  const [roomName, setRoomName] = useState('site-sync-tower-jakarta');
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
        setSummary(left.status === 'active' ? { ...data.summary, note: [data.summary.note, 'Peserta lain masih berada di meeting. Ringkasan ini memakai transkrip saat permintaan ringkasan dikirim.'].filter(Boolean).join(' ') } : data.summary);
        setView('summary');
      } else { setToken(null); setMeetingId(null); setTranscripts([]); setView('lobby'); }
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
# 📝 Bali Tower Meeting Minutes: ${summary.title}
**Date:** ${new Date().toLocaleDateString()} | **Room:** ${roomName}
**Attendees:** ${summary.attendanceSummary?.join(', ') || 'N/A'}
**AI Engine:** ${summary.provider || 'Office LLM'}

---
### 📌 Executive Summary
${summary.executiveSummary}

---
### 💡 Key Discussion Points
${summary.keyDiscussionPoints?.map(p => `- ${p}`).join('\n')}

---
### ⚖️ Key Decisions Made
${summary.decisions?.map(d => `- ${d}`).join('\n')}

---
### 📋 Action Items
| Task | Assignee | Priority | Deadline |
| --- | --- | --- | --- |
${summary.actionItems?.map(a => `| ${a.task} | ${a.assignee} | ${a.priority} | ${a.deadline} |`).join('\n')}

---
*Generated by Bali Tower AI Voice Assistant*
    `.trim();

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCallError('Tidak dapat menyalin ringkasan. Periksa izin clipboard browser.'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#0b0f19', color: '#f1f5f9' }}>
      {/* Top Global Navbar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 28px',
        backgroundColor: '#131b2e',
        borderBottom: '1px solid #273553'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '8px',
            backgroundColor: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '18px',
            color: '#fff',
            boxShadow: '0 0 12px rgba(37,99,235,0.4)'
          }}>
            BT
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '0.2px', margin: 0, color: '#f8fafc' }}>
              Bali Tower Voice Call & AI Minutes
            </h1>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
              Integrated Attendance Voice Service (Desktop Environment)
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {backendHealth ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
              <span>API: Online · SFU: {backendHealth.livekitStatus === 'reachable' ? 'Ready' : 'Offline'}</span>
              <span style={{ color: '#64748b' }}>•</span>
              <Cpu size={14} color="#38bdf8" />
              <span style={{ color: backendHealth.hasLlmKey ? '#38bdf8' : '#fbbf24', fontWeight: 500 }}>
                {backendHealth.llmEffectiveProvider === 'office'
                  ? `Office LLM (${backendHealth.llmModel})`
                  : backendHealth.llmProvider === 'gemini'
                    ? 'Gemini 2.5 Flash'
                    : 'Demo (AI belum aktif)'}
              </span>
              {!backendHealth.hasLlmKey && (
                <span style={{ color: '#f59e0b', fontSize: '11px' }}>(No Key)</span>
              )}
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '6px 12px',
              borderRadius: '20px',
              backgroundColor: '#3f1d24',
              color: '#f87171'
            }}>
              <AlertCircle size={14} />
              <span>{healthChecked ? 'Backend Offline (Check server)' : 'Memeriksa layanan...'}</span>
            </div>
          )}

          {view === 'in-call' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#1e293b',
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid #3b82f6'
            }}>
              <Clock size={14} color="#60a5fa" />
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>{callDuration}</span>
            </div>
          )}
        </div>
      </header>

      {(callError || syncError || transcriptSaveError || pendingSaves > 0) && <div role="status" style={{ padding: '12px', color: '#fca5a5' }}>
        {callError} {syncError} {transcriptSaveError} {pendingSaves > 0 && <span> Antrean: {pendingSaves} belum tersimpan. </span>}
        {transcriptSaveError && <button onClick={() => saveQueue.retry()}>Coba simpan lagi</button>}
      </div>}
      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {view === 'lobby' && (
          <LobbyView
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
            backendHealth={backendHealth}
            onJoin={handleJoin}
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
            copied={copied}
            onCopy={copyMarkdownSummary}
            onNewCall={() => {
              setToken(null);
              setMeetingId(null);
              setCallError(null);
              setTranscripts([]);
              setSummary(null);
              setView('lobby');
            }}
          />
        )}
      </main>
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
    <div style={{
      backgroundColor: '#0f172a',
      borderRadius: '12px',
      border: '1px solid #1e293b',
      padding: '16px 20px',
      marginBottom: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Volume2 size={18} color="#38bdf8" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            Microphone Hardware Diagnostic & Volume Test
          </span>
        </div>
        <button
          type="button"
          disabled={isRequestingMic}
          onClick={isCapturing ? stopMicTest : startMicTest}
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '4px 12px',
            borderRadius: '6px',
            backgroundColor: isCapturing ? '#dc2626' : '#2563eb',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {isRequestingMic ? 'Meminta izin mikrofon...' : isCapturing ? 'Stop Mic Test' : 'Test Mic Input'}
        </button>
      </div>

      {micError && (
        <div style={{ fontSize: '12px', color: '#f87171', marginBottom: '8px' }}>
          ⚠️ {micError}
        </div>
      )}

      {isCapturing ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
            <span>Device: <strong style={{ color: '#38bdf8' }}>{micName}</strong></span>
            <span>Input Level: <strong style={{ color: volume > 10 ? '#34d399' : '#94a3b8' }}>{volume}%</strong></span>
          </div>

          {/* Real-time VU Volume Level Bar */}
          <div style={{
            height: '10px',
            backgroundColor: '#1e293b',
            borderRadius: '5px',
            overflow: 'hidden',
            display: 'flex',
          }}>
            <div style={{
              width: `${volume}%`,
              backgroundColor: volume > 60 ? '#f59e0b' : volume > 10 ? '#10b981' : '#64748b',
              transition: 'width 0.05s ease-out',
            }} />
          </div>

          <p style={{ fontSize: '11px', color: volume > 10 ? '#34d399' : '#94a3b8', marginTop: '6px' }}>
            {volume > 10 ? '✓ Your voice is actively being detected by the browser!' : 'Speak into your microphone to verify the volume bar responds.'}
          </p>
        </div>
      ) : (
        <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
          Click "Test Mic Input" to confirm your browser can hear your microphone before joining.
        </p>
      )}
    </div>
  );
}

// ==========================================
// 1. LOBBY VIEW
// ==========================================
function LobbyView({
  employeeId,
  setEmployeeId,
  employeeName,
  setEmployeeName,
  department,
  setDepartment,
  roomName,
  setRoomName,
  isJoining,
  joinError,
  onJoin,
}: any) {
  return (
    <div style={{
      maxWidth: '820px',
      margin: '30px auto',
      padding: '0 20px',
      width: '100%',
    }}>
      <div style={{
        backgroundColor: '#131b2e',
        borderRadius: '16px',
        border: '1px solid #273553',
        padding: '36px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
      }}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '14px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#38bdf8', fontSize: '13px', marginBottom: '14px' }}>
            <ShieldCheck size={16} />
            <span>Bali Tower Internal Secure Voice Network</span>
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#f8fafc', marginBottom: '8px' }}>
            Join Voice Conference
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.5' }}>
            Enter your employee credentials to connect to the meeting. Each participant transcribes their own microphone. Check the transcription status during the call; voice transmission and speech recognition use separate services.
          </p>
        </div>

        {/* Live Mic Hardware Tester */}
        <MicrophoneDiagnostic />

        {joinError && (
          <div style={{
            backgroundColor: '#451a1a',
            border: '1px solid #b91c1c',
            borderRadius: '8px',
            padding: '12px 16px',
            color: '#fca5a5',
            fontSize: '14px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertCircle size={18} />
            <span>{joinError}</span>
          </div>
        )}

        {/* Preset Persona Quick Buttons */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
            Quick Select Employee Persona (For Multi-Window Testing)
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
            {PRESET_PERSONAS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setEmployeeId(p.id);
                  setEmployeeName(p.name);
                  setDepartment(p.dept);
                }}
                style={{
                  backgroundColor: employeeId === p.id ? '#1e3a8a' : '#1e293b',
                  border: employeeId === p.id ? '1px solid #3b82f6' : '1px solid #334155',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  color: '#f8fafc',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{p.name}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{p.id}</div>
                <div style={{ fontSize: '10px', color: '#38bdf8', marginTop: '2px' }}>{p.dept}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Input Fields Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#cbd5e1', marginBottom: '6px' }}>
              Employee ID (NIK)
            </label>
            <input
              type="text"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="e.g. BT-10492"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#cbd5e1', marginBottom: '6px' }}>
              Employee Full Name
            </label>
            <input
              type="text"
              value={employeeName}
              onChange={e => setEmployeeName(e.target.value)}
              placeholder="e.g. Rafli Aditya"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#cbd5e1', marginBottom: '6px' }}>
              Department / Division
            </label>
            <select
              value={department}
              onChange={e => setDepartment(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '14px',
                outline: 'none',
              }}
            >
              <option value="NOC & Core Network">NOC & Core Network</option>
              <option value="Field Transmission">Field Transmission</option>
              <option value="Fiber Infrastructure">Fiber Infrastructure</option>
              <option value="Project Management">Project Management</option>
              <option value="IT Operations">IT Operations</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#cbd5e1', marginBottom: '6px' }}>
              Meeting Room Identifier
            </label>
            <input
              type="text"
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
              placeholder="e.g. site-sync-tower-jakarta"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        <button
          onClick={onJoin}
          disabled={isJoining}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: '8px',
            backgroundColor: '#2563eb',
            border: 'none',
            color: '#fff',
            fontWeight: 600,
            fontSize: '16px',
            cursor: isJoining ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
            transition: 'background-color 0.2s',
          }}
        >
          {isJoining ? (
            <span>Connecting to LiveKit Room...</span>
          ) : (
            <>
              <PhoneCall size={20} />
              <span>Connect to Voice Room</span>
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 2. IN-CALL VIEW (LIVEKIT CONTAINER)
// ==========================================
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
  
  const [speechInput, setSpeechInput] = useState('');
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

  return (
    <div style={{ display: 'flex', flex: 1, width: '100%', height: 'calc(100vh - 67px)', overflow: 'hidden' }}>
      {/* Left/Center Area: Participants Grid & Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0b0f19', borderRight: '1px solid #273553' }}>
        {/* Call Info Sub-header */}
        <div style={{
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#101626',
          borderBottom: '1px solid #1e293b'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', backgroundColor: '#172554', padding: '4px 10px', borderRadius: '6px' }}>
              #{roomName}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '12px' }}>
              <Radio size={14} className="live-indicator" />
              <span>Voice: {connectionState}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Live Mic Activity Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#1e293b',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #334155',
              fontSize: '12px'
            }}>
              <Mic size={14} color={micVolume > 10 ? '#34d399' : '#94a3b8'} />
              <span>Mic:</span>
              <div style={{ width: '40px', height: '6px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${micVolume}%`,
                  height: '100%',
                  backgroundColor: micVolume > 10 ? '#10b981' : '#64748b'
                }} />
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: '#1e293b',
              color: '#a5f3fc'
            }}>
              <Sparkles size={14} color="#06b6d4" />
              <span>Transcription: {!connected ? 'Waiting for voice connection' : isMuted ? 'Paused (mic muted)' : saveBlocked ? 'Paused (save failed)' : speechError ? 'Error' : isListeningSpeechApi ? 'Listening' : speechEnabled ? 'Starting' : 'Stopped'}</span>
            </div>
          </div>
        </div>

        {finishError && <div role="alert" style={{ padding: '12px', color: '#fca5a5' }}>{finishError}</div>}
        {/* Interim Speech Banner (Displays words live as you speak!) */}
        {interimText && (
          <div style={{
            backgroundColor: '#1e3a8a',
            borderBottom: '1px solid #3b82f6',
            padding: '8px 24px',
            color: '#bfdbfe',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <Radio size={14} className="live-indicator" color="#60a5fa" />
            <span>Hearing your voice: <strong>"{interimText}"</strong></span>
          </div>
        )}

        {speechError && (
          <div style={{
            backgroundColor: '#451a1a',
            borderBottom: '1px solid #b91c1c',
            padding: '8px 24px',
            color: '#fca5a5',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>⚠️ {speechError}</span>
            <span style={{ fontSize: '11px', color: '#f87171' }}>Use the quick-click lines or text box below to add speech</span>
          </div>
        )}

        {/* Participant Audio Tiles Grid */}
        <div style={{
          flex: 1,
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '20px',
          alignContent: 'start',
          overflowY: 'auto',
        }}>
          {participants.map(p => {
            const isLocal = p === localParticipant;
            const speaking = p.isSpeaking;
            return (
              <div
                key={p.identity}
                className={speaking ? 'speaking-pulse' : ''}
                style={{
                  backgroundColor: '#131b2e',
                  borderRadius: '16px',
                  border: speaking ? '2px solid #3b82f6' : '1px solid #273553',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  minHeight: '200px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  transition: 'border 0.2s',
                }}
              >
                {speaking && (
                  <span style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    fontSize: '11px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: 600,
                  }}>
                    Speaking
                  </span>
                )}

                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  backgroundColor: isLocal ? '#1d4ed8' : '#334155',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 600,
                  marginBottom: '14px',
                  boxShadow: speaking ? '0 0 20px rgba(59,130,246,0.6)' : 'none',
                }}>
                  {(p.name || p.identity).slice(0, 2).toUpperCase()}
                </div>

                <div style={{ fontWeight: 600, fontSize: '16px', color: '#f8fafc', textAlign: 'center' }}>
                  {p.name || p.identity} {isLocal && '(You)'}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  ID: {p.identity}
                </div>

                <div style={{
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: p.isMicrophoneEnabled ? '#34d399' : '#f87171',
                }}>
                  {p.isMicrophoneEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                  <span>{p.isMicrophoneEnabled ? 'Mic Active' : 'Muted'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Voice Simulation / Speech helper */}
        <div style={{
          padding: '12px 24px',
          backgroundColor: '#0f172a',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>
              Live Speech Transcriber:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select aria-label="Layanan transkripsi" value={sttProvider} disabled={finishing || isSummarizing}
                onChange={e => setSttProvider(e.target.value)} style={{ color: '#fff', background: '#1e293b' }}>
                <option value="browser">Browser STT</option>
                <option value="server" disabled={!sttConfigured}>Backend STT{!sttConfigured ? ' (belum dikonfigurasi)' : ''}</option>
              </select>
              <select
                aria-label="Bahasa transkripsi" disabled={finishing || isSummarizing}
                value={speechLanguage}
                onChange={e => setSpeechLanguage(e.target.value as any)}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '11px',
                  padding: '3px 8px',
                }}
              >
                <option value="id-ID">Bahasa Indonesia</option>
                <option value="en-US">English (US)</option>
              </select>

              <button
                onClick={toggleSpeechRecognition}
                disabled={finishing || isSummarizing || !connected || isMuted || saveBlocked}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: isListeningSpeechApi ? '#10b981' : '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Mic size={12} />
                <span>{isMuted ? 'Aktifkan mikrofon dahulu' : speechError ? 'Coba transkripsi lagi' : speechEnabled ? 'Hentikan transkripsi' : 'Mulai transkripsi'}</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {[
              "Fiber optic link site 4A is fully restored, signal is optimal.",
              "Field team reported routine maintenance finished for sector B.",
              "Confirmed. Please file the attendance sync and schedule tower inspection for tomorrow.",
              "Agreed, all issues logged and resolving by 5 PM.",
            ].map((preset, idx) => (
              <button
                key={idx}
                disabled={finishing || isSummarizing || saveBlocked}
                onClick={() => onAddSpeechLine(preset)}
                style={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background-color 0.2s',
                }}
              >
                + Say: "{preset.slice(0, 35)}..."
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              disabled={finishing || isSummarizing || saveBlocked}
              value={speechInput}
              onChange={e => setSpeechInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onAddSpeechLine(speechInput);
                  setSpeechInput('');
                }
              }}
              placeholder="Or type what you say in the meeting to log speech..."
              style={{
                flex: 1,
                padding: '8px 12px',
                backgroundColor: '#131b2e',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              disabled={finishing || isSummarizing || saveBlocked}
              onClick={() => {
                onAddSpeechLine(speechInput);
                setSpeechInput('');
              }}
              style={{
                backgroundColor: '#2563eb',
                border: 'none',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Send size={14} />
              <span>Send Line</span>
            </button>
          </div>
        </div>

        <button disabled={finishing || isSummarizing} onClick={() => void finishMeeting(false)}
          style={{ padding: '8px', color: '#cbd5e1', background: '#1e293b' }}>Keluar tanpa ringkasan</button>
        {/* Bottom Call Control Bar */}
        <div style={{
          padding: '16px 24px',
          backgroundColor: '#131b2e',
          borderTop: '1px solid #273553',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={toggleMute}
              disabled={finishing || isSummarizing}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                backgroundColor: isMuted ? '#ef4444' : '#1e293b',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
            </button>
          </div>

          <button
            onClick={() => void finishMeeting(true)}
            disabled={isSummarizing || finishing}
            style={{
              padding: '10px 22px',
              borderRadius: '8px',
              backgroundColor: '#dc2626',
              border: 'none',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isSummarizing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
            }}
          >
            <PhoneOff size={18} />
            <span>{isSummarizing || finishing ? 'Menyimpan ucapan & membuat ringkasan...' : 'Keluar & Buat Ringkasan'}</span>
          </button>
        </div>
      </div>

      {/* Right Sidebar: Live Transcripts & Attendance Tabs */}
      <div style={{ width: '380px', display: 'flex', flexDirection: 'column', backgroundColor: '#101626' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #273553' }}>
          <button
            onClick={() => setActiveTab('transcript')}
            style={{
              flex: 1,
              padding: '14px',
              backgroundColor: activeTab === 'transcript' ? '#131b2e' : '#101626',
              border: 'none',
              borderBottom: activeTab === 'transcript' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'transcript' ? '#f8fafc' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <FileText size={16} />
            <span>Live Transcript ({transcripts.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            style={{
              flex: 1,
              padding: '14px',
              backgroundColor: activeTab === 'attendance' ? '#131b2e' : '#101626',
              border: 'none',
              borderBottom: activeTab === 'attendance' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'attendance' ? '#f8fafc' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Users size={16} />
            <span>Attendance ({participants.length})</span>
          </button>
        </div>

        {/* Tab 1: Live Transcripts */}
        {activeTab === 'transcript' && (
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {transcripts.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: '60px', fontSize: '13px' }}>
                <Activity size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                <p>Waiting for speech input...</p>
                <p style={{ fontSize: '11px', marginTop: '6px' }}>Speak into your microphone or use the preset lines below.</p>
              </div>
            ) : (
              transcripts.map((t: TranscriptEntry) => {
                const isMe = t.speakerId === employeeId;
                return (
                  <div
                    key={t.id}
                    style={{
                      backgroundColor: isMe ? '#1e293b' : '#131b2e',
                      border: '1px solid #1e293b',
                      borderRadius: '10px',
                      padding: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: isMe ? '#60a5fa' : '#38bdf8' }}>
                        {t.speakerName} ({t.speakerId})
                      </span>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                        {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.4, margin: 0 }}>
                      {t.text}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Tab 2: Attendance */}
        {activeTab === 'attendance' && (
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {participants.map(p => (
              <div
                key={p.identity}
                style={{
                  backgroundColor: '#131b2e',
                  border: '1px solid #1e293b',
                  borderRadius: '10px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '13px',
                }}>
                  {(p.name || p.identity).slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                    {p.name || p.identity}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    NIK: {p.identity}
                  </div>
                </div>
                <span style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  backgroundColor: '#065f46',
                  color: '#6ee7b7',
                }}>
                  Present
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. SUMMARY VIEW (POST-CALL MINUTES)
// ==========================================
function SummaryView({
  summary,
  roomName,
  copied,
  onCopy,
  onNewCall,
}: {
  summary: MeetingSummary;
  roomName: string;
  copied: boolean;
  onCopy: () => void;
  onNewCall: () => void;
}) {
  return (
    <div style={{ maxWidth: '900px', margin: '40px auto', padding: '0 20px', width: '100%' }}>
      <div style={{
        backgroundColor: '#131b2e',
        borderRadius: '16px',
        border: '1px solid #273553',
        padding: '36px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px', backgroundColor: '#1e293b', color: '#38bdf8', fontSize: '12px', marginBottom: '10px' }}>
              <Sparkles size={14} />
              <span>AI Meeting Minutes & Action Items</span>
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f8fafc', margin: '0 0 6px 0' }}>
              {summary.title}
            </h2>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Room: <span style={{ color: '#cbd5e1' }}>#{roomName}</span> • Generated via{' '}
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{summary.provider || 'Office LLM'}</span> on {summary.generatedAt ? new Date(summary.generatedAt).toLocaleString() : '—'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onCopy}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
              <span>{copied ? 'Copied Markdown!' : 'Copy Summary'}</span>
            </button>
            <button
              onClick={onNewCall}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                border: 'none',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Start New Meeting
            </button>
          </div>
        </div>

        {summary.note && (
          <div style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px 14px',
            color: '#fbbf24',
            fontSize: '12px',
            marginBottom: '24px',
          }}>
            💡 {summary.note}
          </div>
        )}

        {/* Executive Summary */}
        <div style={{ marginBottom: '28px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#93c5fd', marginBottom: '8px' }}>
            Executive Summary
          </h3>
          <div style={{
            backgroundColor: '#0f172a',
            borderRadius: '10px',
            border: '1px solid #1e293b',
            padding: '16px',
            fontSize: '14px',
            lineHeight: 1.6,
            color: '#e2e8f0',
          }}>
            {summary.executiveSummary}
          </div>
        </div>

        <div style={{ marginBottom: '28px' }}>
          <h3 style={{ fontSize: '16px', color: '#93c5fd' }}>Poin Pembahasan</h3>
          <ul style={{ padding: '16px 32px', backgroundColor: '#0f172a', borderRadius: '10px', lineHeight: 1.6 }}>
            {summary.keyDiscussionPoints.map((point, index) => <li key={index}>{point}</li>)}
          </ul>
        </div>

        {/* Action Items */}
        <div style={{ marginBottom: '28px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#93c5fd', marginBottom: '12px' }}>
            Action Items & Task Assignment
          </h3>
          <div style={{
            backgroundColor: '#0f172a',
            borderRadius: '10px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#131b2e', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                  <th style={{ padding: '12px 16px' }}>Task</th>
                  <th style={{ padding: '12px 16px' }}>Assignee</th>
                  <th style={{ padding: '12px 16px' }}>Priority</th>
                  <th style={{ padding: '12px 16px' }}>Target Deadline</th>
                </tr>
              </thead>
              <tbody>
                {summary.actionItems.length === 0 && <tr><td colSpan={4} style={{ padding: '12px 16px' }}>Tidak ada tugas tercatat.</td></tr>}
                {summary.actionItems?.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #1e293b', color: '#f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>{item.task}</td>
                    <td style={{ padding: '12px 16px', color: '#38bdf8' }}>{item.assignee}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        backgroundColor: item.priority === 'High' ? '#7f1d1d' : '#1e3a8a',
                        color: item.priority === 'High' ? '#fca5a5' : '#93c5fd',
                      }}>
                        {item.priority}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{item.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Key Decisions & Discussion Points */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '28px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#93c5fd', marginBottom: '10px' }}>
              Key Decisions Agreed
            </h3>
            <ul style={{
              backgroundColor: '#0f172a',
              borderRadius: '10px',
              border: '1px solid #1e293b',
              padding: '16px 16px 16px 32px',
              fontSize: '13px',
              color: '#cbd5e1',
              lineHeight: 1.6,
              margin: 0,
            }}>
              {summary.decisions.length === 0 && <li>Tidak ada keputusan tercatat.</li>}
              {summary.decisions?.map((d, i) => (
                <li key={i} style={{ marginBottom: '6px' }}>{d}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#93c5fd', marginBottom: '10px' }}>
              Peserta yang tercatat terhubung
            </h3>
            <div style={{
              backgroundColor: '#0f172a',
              borderRadius: '10px',
              border: '1px solid #1e293b',
              padding: '16px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
            }}>
              {summary.attendanceSummary?.map((att, i) => (
                <span
                  key={i}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                >
                  ✓ {att}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
