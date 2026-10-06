import { useState, useEffect, useRef } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
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
  Cpu,
  Wrench,
  Play,
  Square,
  X,
  Loader2,
  RefreshCw,
  Database
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

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
}

interface DiagnosticLog {
  id: string;
  time: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'event';
  message: string;
  detail?: string;
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
  const [serverUrl, setServerUrl] = useState('ws://127.0.0.1:7880');
  
  // Active call state
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'transcript' | 'attendance'>('transcript');
  const [callDuration, setCallDuration] = useState('00:00');
  const [meetingStartTime, setMeetingStartTime] = useState<number | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Diagnostic Modal state
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);

  // Backend Health and LLM status
  const [backendHealth, setBackendHealth] = useState<{
    status: string;
    llmProvider?: string;
    llmModel?: string;
    llmBaseUrl?: string;
    hasLlmKey?: boolean;
    database?: {
      connected: boolean;
      configured: boolean;
    };
  } | null>(null);

  // Registered employees list from database / directory
  const [employeeDirectory, setEmployeeDirectory] = useState<{ id: string; name: string; dept: string; role?: string }[]>(PRESET_PERSONAS);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(res => res.json())
      .then(data => setBackendHealth(data))
      .catch(() => setBackendHealth(null));

    fetch(`${API_BASE}/employees`)
      .then(res => res.json())
      .then(data => {
        if (data.employees && data.employees.length > 0) {
          setEmployeeDirectory(data.employees.map((e: any) => ({
            id: e.employee_id,
            name: e.name,
            dept: e.department,
            role: e.position,
          })));
        }
      })
      .catch(() => {});
  }, []);

  // Timer logic
  useEffect(() => {
    if (view !== 'in-call' || !meetingStartTime) return;
    const interval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - meetingStartTime) / 1000);
      const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const s = String(elapsedSec % 60).padStart(2, '0');
      setCallDuration(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [view, meetingStartTime]);

  // Fallback periodic sync (merges any missing transcripts for late-joiners or recovery)
  useEffect(() => {
    if (view !== 'in-call') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/meetings/${roomName}/transcript`);
        if (res.ok) {
          const data = await res.json();
          if (data.transcripts && Array.isArray(data.transcripts)) {
            setTranscripts(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              const missing = data.transcripts.filter((t: TranscriptEntry) => !existingIds.has(t.id));
              if (missing.length === 0) return prev;
              return [...prev, ...missing];
            });
          }
        }
      } catch (err) {
        console.error('Failed to sync transcripts:', err);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [view, roomName]);

  const handleJoin = async () => {
    if (!employeeId.trim() || !employeeName.trim() || !roomName.trim()) {
      setJoinError('Please complete all required fields.');
      return;
    }

    // Format validation check (e.g. reject non-ID text such as "ns-12nsunauu")
    const cleanId = employeeId.trim();
    if (!/^BT-\d{4,6}$/i.test(cleanId)) {
      setJoinError('Format ID Salah.');
      return;
    }

    setJoinError(null);
    setIsJoining(true);

    // Ensure completely fresh transcript and summary state for new call
    setTranscripts([]);
    setSummary(null);
    setSummaryError(null);

    try {
      const res = await fetch(`${API_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: roomName.trim(),
          employeeId: employeeId.trim(),
          employeeName: employeeName.trim(),
          department,
          newSession: true, // Guarantees fresh call session on the server
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to obtain room token');
      }

      const data = await res.json();
      setToken(data.token);
      setServerUrl(data.url);
      setMeetingStartTime(Date.now());
      setView('in-call');
    } catch (err: any) {
      setJoinError(err.message || 'Error connecting to server. Make sure server is running.');
    } finally {
      setIsJoining(false);
    }
  };

  const fetchMeetingSummary = async (transcriptList: TranscriptEntry[]) => {
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      if (!transcriptList || transcriptList.length === 0) {
        throw new Error('No dialogue was recorded in this call. Please speak into your mic or submit dialogue lines before ending the meeting.');
      }

      const res = await fetch(`${API_BASE}/meetings/${roomName}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcripts: transcriptList }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to generate summary (HTTP ${res.status})`);
      }

      const data = await res.json();
      setSummary(data.summary);
    } catch (err: any) {
      console.error('Summary generation error:', err);
      setSummaryError(err.message || 'Failed to generate AI meeting summary');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleEndMeeting = () => {
    if (window.confirm('Do you want to end this voice meeting and generate the AI summary?')) {
      const capturedTranscripts = [...transcripts];
      // 1. Immediately leave call & disconnect LiveKit audio session
      setToken(null);
      setView('summary');

      // 2. Asynchronously request AI minutes in the background
      fetchMeetingSummary(capturedTranscripts);
    }
  };

  const handleAddSpeechEntry = async (entry: TranscriptEntry) => {
    // Immediate optimistic local update (deduplicated by entry.id)
    setTranscripts(prev => {
      if (prev.some(t => t.id === entry.id)) return prev;
      return [...prev, entry];
    });

    // Asynchronously persist to server
    try {
      await fetch(`${API_BASE}/meetings/${roomName}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entry.id,
          speakerId: entry.speakerId,
          speakerName: entry.speakerName,
          text: entry.text,
          timestamp: entry.timestamp,
        }),
      });
    } catch (err) {
      console.error('Failed to post speech line to server:', err);
    }
  };

  const handleReceiveRemoteEntry = (entry: TranscriptEntry) => {
    setTranscripts(prev => {
      if (prev.some(t => t.id === entry.id)) return prev;
      return [...prev, entry];
    });
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

    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Diagnostic Button */}
          <button
            onClick={() => setIsDiagnosticOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: '20px',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Wrench size={14} />
            <span>Speech Diagnostics Lab</span>
          </button>

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
              <span>SFU: Active</span>
              <span style={{ color: '#64748b' }}>•</span>
              <Cpu size={14} color="#38bdf8" />
              <span style={{ color: backendHealth.hasLlmKey ? '#38bdf8' : '#fbbf24', fontWeight: 500 }}>
                {backendHealth.llmProvider === 'office'
                  ? `Office LLM (${backendHealth.llmModel})`
                  : backendHealth.llmProvider === 'gemini'
                    ? 'Gemini 2.5 Flash'
                    : 'Smart Demo Engine'}
              </span>
              <span style={{ color: '#64748b' }}>•</span>
              <Database size={14} color={backendHealth.database?.connected ? '#10b981' : '#f59e0b'} />
              <span style={{ color: backendHealth.database?.connected ? '#10b981' : '#94a3b8', fontSize: '11px', fontWeight: 500 }}>
                {backendHealth.database?.connected ? 'DB: Connected' : 'DB: Standby'}
              </span>
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
              <span>Backend Offline (Check server)</span>
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
            employeeDirectory={employeeDirectory}
            onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
            onJoin={handleJoin}
          />
        )}

        {view === 'in-call' && token && (
          <InCallView
            token={token}
            serverUrl={serverUrl}
            roomName={roomName}
            employeeId={employeeId}
            employeeName={employeeName}
            transcripts={transcripts}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onAddSpeechEntry={handleAddSpeechEntry}
            onReceiveRemoteEntry={handleReceiveRemoteEntry}
            onEndMeeting={handleEndMeeting}
            onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
            isSummarizing={isSummarizing}
          />
        )}

        {view === 'summary' && (
          <SummaryView
            summary={summary}
            isSummarizing={isSummarizing}
            summaryError={summaryError}
            transcripts={transcripts}
            roomName={roomName}
            copied={copied}
            onCopy={copyMarkdownSummary}
            onRetry={() => fetchMeetingSummary(transcripts)}
            onNewCall={() => {
              fetch(`${API_BASE}/meetings/${roomName}/reset`, { method: 'POST' }).catch(() => {});
              setToken(null);
              setTranscripts([]);
              setSummary(null);
              setSummaryError(null);
              setView('lobby');
            }}
          />
        )}
      </main>

      {/* Interactive Speech Diagnostics Lab Modal */}
      {isDiagnosticOpen && (
        <SpeechDiagnosticModal onClose={() => setIsDiagnosticOpen(false)} />
      )}
    </div>
  );
}

// ========================================================
// 🧪 SPEECH DIAGNOSTICS LAB & VOICE TESTER MODAL
// ========================================================
function SpeechDiagnosticModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'speech-api' | 'record-playback'>('speech-api');
  const [testLanguage, setTestLanguage] = useState<'id-ID' | 'en-US'>('id-ID');
  const [testContinuous, setTestContinuous] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [verdict, setVerdict] = useState<string | null>(null);

  // Audio recording test states
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const recognitionRef = useRef<any>(null);

  const addLog = (type: DiagnosticLog['type'], message: string, detail?: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(Date.now() % 1000).padStart(3, '0');
    setLogs(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, time, type, message, detail }]);
  };

  const hasSpeechApi = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startSpeechApiTest = () => {
    if (!hasSpeechApi) {
      addLog('error', 'Web Speech API is not supported in this browser.', 'Use Chrome or Edge on desktop.');
      setVerdict('FAILED: Browser lacks window.SpeechRecognition / window.webkitSpeechRecognition.');
      return;
    }

    setLogs([]);
    setFinalTranscript('');
    setInterimText('');
    setVerdict(null);
    setIsTesting(true);

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SpeechRec();

    rec.lang = testLanguage;
    rec.continuous = testContinuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    addLog('info', `Initializing SpeechRecognition (lang: ${testLanguage}, continuous: ${testContinuous})`);

    rec.onstart = () => {
      addLog('event', '🔵 onstart: Speech recognition engine started');
    };

    rec.onaudiostart = () => {
      addLog('event', '🎧 onaudiostart: Audio capture initiated by browser');
    };

    rec.onsoundstart = () => {
      addLog('event', '🔊 onsoundstart: Sound energy detected from your microphone');
    };

    rec.onspeechstart = () => {
      addLog('event', '🗣️ onspeechstart: Human speech phonemes recognized!');
    };

    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const text = item[0].transcript;
        const confidence = Math.round((item[0].confidence || 0) * 100);
        if (item.isFinal) {
          addLog('success', `💬 onresult (FINAL): "${text}" (Confidence: ${confidence}%)`);
          setFinalTranscript(prev => (prev ? prev + ' ' + text : text));
          setVerdict(`SUCCESS! Recognized: "${text}"`);
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
      if (interim) {
        addLog('info', `... Hearing interim: "${interim}"`);
      }
    };

    rec.onspeechend = () => {
      addLog('event', '🛑 onspeechend: Speech pause detected');
    };

    rec.onsoundend = () => {
      addLog('event', '🔇 onsoundend: Sound energy dropped');
    };

    rec.onaudioend = () => {
      addLog('event', '⏹️ onaudioend: Audio stream closed by browser');
    };

    rec.onerror = (event: any) => {
      const err = event.error;
      addLog('error', `⚠️ onerror: [${err}]`, event.message || '');
      
      let explanation = `Error: ${err}.`;
      if (err === 'network') {
        explanation = `❌ ERROR 'network': Chrome cannot connect to Google's Speech Service.
Causes:
1. Windows Privacy Setting: 'Online speech recognition' is DISABLED in Windows Settings > Privacy & Security > Speech.
2. Corporate Network: Company firewall / proxy blocks Google's Speech WebSocket server.
3. Language Pack: Language '${testLanguage}' is not available offline in Windows.`;
      } else if (err === 'not-allowed') {
        explanation = `❌ ERROR 'not-allowed': Microphone permission is blocked or denied in Chrome site settings.`;
      } else if (err === 'audio-capture') {
        explanation = `❌ ERROR 'audio-capture': No microphone hardware was found or another program has an exclusive lock on your microphone.`;
      } else if (err === 'no-speech') {
        explanation = `⚠️ WARNING 'no-speech': No recognizable speech was detected before timeout. Speak closer to the microphone.`;
      }
      setVerdict(explanation);
    };

    rec.onend = () => {
      addLog('event', '⚪ onend: Speech recognition session ended');
      setIsTesting(false);
      setInterimText('');
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      addLog('info', 'Recognition started! Speak into your microphone now...');
    } catch (err: any) {
      addLog('error', `Failed to start recognition: ${err.message}`);
      setIsTesting(false);
    }
  };

  const stopSpeechApiTest = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      setIsTesting(false);
    }
  };

  // Hardware audio record & playback test
  const startRecordingAudio = async () => {
    setRecordedAudioUrl(null);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecordingAudio(true);
    } catch (err: any) {
      alert('Microphone recording error: ' + err.message);
    }
  };

  const stopRecordingAudio = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px',
    }}>
      <div style={{
        backgroundColor: '#131b2e',
        borderRadius: '16px',
        border: '1px solid #273553',
        width: '100%',
        maxWidth: '850px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px',
          borderBottom: '1px solid #273553',
          backgroundColor: '#101626',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wrench size={20} color="#38bdf8" />
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                Speech Transcription Diagnostic Lab
              </h2>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                Diagnose why your browser or PC is not emitting transcriptions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
          <button
            onClick={() => setActiveTab('speech-api')}
            style={{
              padding: '12px 20px',
              backgroundColor: activeTab === 'speech-api' ? '#131b2e' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'speech-api' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'speech-api' ? '#f8fafc' : '#94a3b8',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            1. Web Speech API Event Trace (Live Demo)
          </button>
          <button
            onClick={() => setActiveTab('record-playback')}
            style={{
              padding: '12px 20px',
              backgroundColor: activeTab === 'record-playback' ? '#131b2e' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'record-playback' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'record-playback' ? '#f8fafc' : '#94a3b8',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            2. Hardware Audio Record & Playback
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {activeTab === 'speech-api' && (
            <div>
              {/* Controls */}
              <div style={{
                backgroundColor: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                      Language:
                    </label>
                    <select
                      value={testLanguage}
                      onChange={e => setTestLanguage(e.target.value as any)}
                      disabled={isTesting}
                      style={{
                        padding: '6px 10px',
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                    >
                      <option value="id-ID">Bahasa Indonesia (id-ID)</option>
                      <option value="en-US">English US (en-US)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                      Mode:
                    </label>
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => setTestContinuous(!testContinuous)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        color: '#cbd5e1',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      {testContinuous ? 'Continuous (Long)' : 'Single Utterance (Recommended)'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {isTesting ? (
                    <button
                      onClick={stopSpeechApiTest}
                      style={{
                        padding: '8px 18px',
                        backgroundColor: '#dc2626',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Square size={14} />
                      <span>Stop Listening</span>
                    </button>
                  ) : (
                    <button
                      onClick={startSpeechApiTest}
                      style={{
                        padding: '8px 20px',
                        backgroundColor: '#2563eb',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Play size={14} />
                      <span>Start Speech Test</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Interim Banner */}
              {interimText && (
                <div style={{
                  backgroundColor: '#1e3a8a',
                  border: '1px solid #3b82f6',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  color: '#bfdbfe',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}>
                  Hearing right now: <strong>"{interimText}"</strong>
                </div>
              )}

              {finalTranscript && (
                <div style={{
                  backgroundColor: '#064e3b',
                  border: '1px solid #059669',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  color: '#a7f3d0',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}>
                  Recognized Words: <strong>"{finalTranscript}"</strong>
                </div>
              )}

              {/* Diagnostic Verdict */}
              {verdict && (
                <div style={{
                  backgroundColor: verdict.startsWith('SUCCESS') ? '#064e3b' : '#451a1a',
                  border: verdict.startsWith('SUCCESS') ? '1px solid #059669' : '1px solid #b91c1c',
                  borderRadius: '8px',
                  padding: '14px 18px',
                  color: verdict.startsWith('SUCCESS') ? '#a7f3d0' : '#fecaca',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  marginBottom: '16px',
                  whiteSpace: 'pre-line',
                }}>
                  {verdict}
                </div>
              )}

              {/* Live Terminal Event Log */}
              <div style={{
                backgroundColor: '#0a0e17',
                border: '1px solid #1e293b',
                borderRadius: '10px',
                padding: '16px',
                minHeight: '220px',
                maxHeight: '300px',
                overflowY: 'auto',
                fontFamily: 'Consolas, monospace',
                fontSize: '12px',
              }}>
                <div style={{ color: '#64748b', marginBottom: '8px', borderBottom: '1px solid #1e293b', paddingBottom: '6px' }}>
                  === SpeechRecognition Event Log Terminal ===
                </div>
                {logs.length === 0 ? (
                  <div style={{ color: '#475569', fontStyle: 'italic' }}>
                    Click "Start Speech Test" and speak a phrase (e.g. "Testing one two three" or "Selamat siang")...
                  </div>
                ) : (
                  logs.map(l => (
                    <div key={l.id} style={{
                      marginBottom: '4px',
                      color: l.type === 'error' ? '#f87171' : l.type === 'success' ? '#34d399' : l.type === 'event' ? '#38bdf8' : '#cbd5e1',
                    }}>
                      <span style={{ color: '#64748b' }}>[{l.time}] </span>
                      <span>{l.message}</span>
                      {l.detail && <div style={{ color: '#94a3b8', marginLeft: '16px', fontSize: '11px' }}>{l.detail}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'record-playback' && (
            <div>
              <p style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}>
                This test records raw audio directly using the browser's <code>MediaRecorder</code> API and plays it back to you.
                If you hear your clear voice during playback, your microphone hardware, permissions, and browser audio stack are 100% working!
              </p>

              <div style={{
                backgroundColor: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: '10px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
              }}>
                {isRecordingAudio ? (
                  <button
                    onClick={stopRecordingAudio}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#dc2626',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Square size={16} />
                    <span>Stop Recording (Speak now...)</span>
                  </button>
                ) : (
                  <button
                    onClick={startRecordingAudio}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#2563eb',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Mic size={16} />
                    <span>Record 5s Voice Sample</span>
                  </button>
                )}

                {recordedAudioUrl && (
                  <div style={{ marginTop: '16px', width: '100%', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#10b981', marginBottom: '8px', fontWeight: 600 }}>
                      ✓ Audio Recorded Successfully! Listen below:
                    </div>
                    <audio src={recordedAudioUrl} controls style={{ width: '100%', maxWidth: '400px' }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '14px 24px',
          backgroundColor: '#101626',
          borderTop: '1px solid #273553',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Close Diagnostics
          </button>
        </div>
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

  const startMicTest = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      console.error('Microphone access failed:', err);
      setMicError(err.message || 'Microphone access denied. Please grant permission in your browser.');
    }
  };

  const stopMicTest = () => {
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
          {isCapturing ? 'Stop Mic Test' : 'Test Mic Input'}
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
  employeeDirectory,
  onOpenDiagnostic,
  onJoin,
}: any) {
  const personas = (employeeDirectory && employeeDirectory.length > 0) ? employeeDirectory : PRESET_PERSONAS;

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '14px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#38bdf8', fontSize: '13px' }}>
              <ShieldCheck size={16} />
              <span>Bali Tower Internal Secure Voice Network</span>
            </div>
            <button
              type="button"
              onClick={onOpenDiagnostic}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '14px',
                backgroundColor: '#172554',
                border: '1px solid #2563eb',
                color: '#60a5fa',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <Wrench size={13} />
              <span>Run Speech Diagnostic Demo</span>
            </button>
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#f8fafc', marginBottom: '8px' }}>
            Join Voice Conference
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.5' }}>
            Enter your employee credentials to connect to the meeting. All employee IDs are authenticated against the central database (<span style={{ color: '#38bdf8', fontWeight: 600 }}>balicall_employees</span>) to ensure secure corporate communication.
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
            Registered Employee Roster (Click to Select)
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {personas.map((p: any) => (
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
                <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>{p.id}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{p.dept}</div>
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
                border: (employeeId.trim() && !/^BT-\d{4,6}$/i.test(employeeId.trim())) ? '1px solid #ef4444' : '1px solid #334155',
                color: '#f8fafc',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            {employeeId.trim() && !/^BT-\d{4,6}$/i.test(employeeId.trim()) ? (
              <div style={{ fontSize: '12px', color: '#f87171', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                <AlertCircle size={13} />
                <span>Format ID Salah. Gunakan format 'BT-XXXXX' (contoh: BT-10492).</span>
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={12} />
                <span>Checked against company database (balicall_employees)</span>
              </div>
            )}
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
  token,
  serverUrl,
  roomName,
  employeeId,
  employeeName,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechEntry,
  onReceiveRemoteEntry,
  onEndMeeting,
  onOpenDiagnostic,
  isSummarizing,
}: {
  token: string;
  serverUrl: string;
  roomName: string;
  employeeId: string;
  employeeName: string;
  transcripts: TranscriptEntry[];
  activeTab: 'transcript' | 'attendance';
  setActiveTab: (tab: 'transcript' | 'attendance') => void;
  onAddSpeechEntry: (entry: TranscriptEntry) => void;
  onReceiveRemoteEntry: (entry: TranscriptEntry) => void;
  onEndMeeting: () => void;
  onOpenDiagnostic: () => void;
  isSummarizing: boolean;
}) {
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
    >
      <RoomAudioRenderer />
      <RoomContent
        roomName={roomName}
        employeeId={employeeId}
        employeeName={employeeName}
        transcripts={transcripts}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onAddSpeechEntry={onAddSpeechEntry}
        onReceiveRemoteEntry={onReceiveRemoteEntry}
        onEndMeeting={onEndMeeting}
        onOpenDiagnostic={onOpenDiagnostic}
        isSummarizing={isSummarizing}
      />
    </LiveKitRoom>
  );
}

function RoomContent({
  roomName,
  employeeId,
  employeeName,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechEntry,
  onReceiveRemoteEntry,
  onEndMeeting,
  onOpenDiagnostic,
  isSummarizing: _isSummarizing,
}: {
  roomName: string;
  employeeId: string;
  employeeName: string;
  transcripts: TranscriptEntry[];
  activeTab: 'transcript' | 'attendance';
  setActiveTab: (tab: 'transcript' | 'attendance') => void;
  onAddSpeechEntry: (entry: TranscriptEntry) => void;
  onReceiveRemoteEntry: (entry: TranscriptEntry) => void;
  onEndMeeting: () => void;
  onOpenDiagnostic: () => void;
  isSummarizing: boolean;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  
  const [speechInput, setSpeechInput] = useState('');
  const [isListeningSpeechApi, setIsListeningSpeechApi] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState<'id-ID' | 'en-US'>('id-ID');

  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  // 1. Listen for LiveKit Data Channel messages (<10ms peer-to-peer real-time delivery)
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        if (data.type === 'TRANSCRIPT' && data.entry) {
          onReceiveRemoteEntry(data.entry);
        }
      } catch (err) {
        console.error('Failed to parse incoming data channel packet:', err);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, onReceiveRemoteEntry]);

  // 2. Helper to broadcast speech entry over LiveKit Data Channel AND inform App state/server
  const broadcastAndAddSpeech = async (text: string) => {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    const entry: TranscriptEntry = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      speakerId: employeeId,
      speakerName: employeeName,
      text: cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Broadcast over LiveKit Data Channel to all other connected peers (<10ms)
    if (localParticipant) {
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: 'TRANSCRIPT', entry })
        );
        await localParticipant.publishData(payload, { reliable: true, topic: 'transcript' });
      } catch (dcErr) {
        console.warn('Data channel publish warning (will persist via HTTP):', dcErr);
      }
    }

    // Add locally (0ms) and persist to server
    onAddSpeechEntry(entry);
  };

  const startRecognitionInstance = () => {
    if (!isListeningRef.current) return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechError('Web Speech API is not supported in this browser. Please use Chrome or Edge.');
      isListeningRef.current = false;
      setIsListeningSpeechApi(false);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = speechLanguage;
      rec.continuous = false; // Single sentence mode: fastest response, avoids Chrome buffer timeouts
      rec.interimResults = true;

      rec.onstart = () => {
        setIsListeningSpeechApi(true);
        setSpeechError(null);
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const spokenText = event.results[i][0].transcript;
            if (spokenText && spokenText.trim().length > 0) {
              broadcastAndAddSpeech(spokenText.trim());
              setInterimText('');
            }
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        setInterimText(interim);
      };

      rec.onerror = (err: any) => {
        const code = err.error;
        if (code === 'network') {
          setSpeechError('Speech network error (Google Speech API unreachable or Windows Online Speech is turned off).');
        } else if (code === 'not-allowed') {
          setSpeechError('Microphone permission blocked in browser settings.');
          isListeningRef.current = false;
          setIsListeningSpeechApi(false);
        } else if (code !== 'no-speech') {
          console.warn('Speech error event:', code);
        }
      };

      rec.onend = () => {
        // Continuous Reconnect Loop: If still active, seamlessly restart for next sentence!
        if (isListeningRef.current) {
          setTimeout(() => {
            if (isListeningRef.current) {
              startRecognitionInstance();
            }
          }, 150);
        } else {
          setIsListeningSpeechApi(false);
          setInterimText('');
        }
      };

      rec.start();
      recognitionRef.current = rec;
    } catch (err: any) {
      console.warn('Speech recognition restart exception:', err);
      if (isListeningRef.current) {
        setTimeout(() => {
          if (isListeningRef.current) startRecognitionInstance();
        }, 400);
      }
    }
  };

  const toggleSpeechRecognition = () => {
    if (isListeningRef.current) {
      isListeningRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      setIsListeningSpeechApi(false);
      setInterimText('');
    } else {
      isListeningRef.current = true;
      setIsListeningSpeechApi(true);
      startRecognitionInstance();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  const isMuted = !localParticipant.isMicrophoneEnabled;

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(isMuted);
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
              <span>Voice Room Active</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8', fontSize: '12px', backgroundColor: '#1e293b', padding: '3px 8px', borderRadius: '6px', border: '1px solid #334155' }}>
              <Activity size={13} color="#38bdf8" />
              <span>Data Channel: P2P &lt;10ms</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={toggleSpeechRecognition}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: '6px',
                backgroundColor: isListeningSpeechApi ? '#065f46' : '#1e293b',
                color: isListeningSpeechApi ? '#6ee7b7' : '#94a3b8',
                border: isListeningSpeechApi ? '1px solid #10b981' : '1px solid #334155',
                cursor: 'pointer',
              }}
            >
              <Mic size={14} className={isListeningSpeechApi ? 'live-indicator' : ''} />
              <span>{isListeningSpeechApi ? '● Live Transcribe: ACTIVE' : 'Start Live Transcribe'}</span>
            </button>

            <button
              onClick={onOpenDiagnostic}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #334155',
                cursor: 'pointer',
              }}
            >
              <Wrench size={13} />
              <span>Speech Diagnostics</span>
            </button>

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
              <span>AI Secretary: Ready</span>
            </div>
          </div>
        </div>

        {/* Interim Speech Banner */}
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
            <button
              onClick={onOpenDiagnostic}
              style={{
                fontSize: '11px',
                color: '#60a5fa',
                backgroundColor: 'transparent',
                border: 'underline',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Open Diagnostic Lab
            </button>
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
              Live Speech Transcriber (Speaks directly to AI):
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select
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
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: isListeningSpeechApi ? '#10b981' : '#1e293b',
                  color: '#fff',
                  border: isListeningSpeechApi ? '1px solid #059669' : '1px solid #334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Mic size={12} />
                <span>{isListeningSpeechApi ? 'Transcribing Live (Click to stop)' : 'Start Auto Transcribe'}</span>
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
                onClick={() => broadcastAndAddSpeech(preset)}
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
              value={speechInput}
              onChange={e => setSpeechInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  broadcastAndAddSpeech(speechInput);
                  setSpeechInput('');
                }
              }}
              placeholder="Or type what you say in the meeting to broadcast & log..."
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
              onClick={() => {
                broadcastAndAddSpeech(speechInput);
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

            <button
              onClick={toggleSpeechRecognition}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                backgroundColor: isListeningSpeechApi ? '#065f46' : '#1e293b',
                border: isListeningSpeechApi ? '1px solid #10b981' : '1px solid #334155',
                color: isListeningSpeechApi ? '#6ee7b7' : '#f8fafc',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Mic size={18} className={isListeningSpeechApi ? 'live-indicator' : ''} />
              <span>{isListeningSpeechApi ? 'Live Transcribe: ON' : 'Turn On Live Transcribe'}</span>
            </button>
          </div>

          <button
            onClick={onEndMeeting}
            style={{
              padding: '10px 22px',
              borderRadius: '8px',
              backgroundColor: '#dc2626',
              border: 'none',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
            }}
          >
            <PhoneOff size={18} />
            <span>End Meeting & Generate Minutes</span>
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
                <p style={{ fontSize: '11px', marginTop: '6px' }}>Click "Start Auto Transcribe" or use preset lines.</p>
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
  isSummarizing,
  summaryError,
  transcripts,
  roomName,
  copied,
  onCopy,
  onRetry,
  onNewCall,
}: {
  summary: MeetingSummary | null;
  isSummarizing: boolean;
  summaryError: string | null;
  transcripts: TranscriptEntry[];
  roomName: string;
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onNewCall: () => void;
}) {
  // Case 1: Actively generating AI summary in background after call has disconnected
  if (isSummarizing) {
    return (
      <div style={{ maxWidth: '840px', margin: '40px auto', padding: '0 20px', width: '100%' }}>
        <div style={{
          backgroundColor: '#131b2e',
          borderRadius: '16px',
          border: '1px solid #273553',
          padding: '40px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            backgroundColor: '#1e293b',
            border: '2px solid #38bdf8',
            marginBottom: '20px',
            boxShadow: '0 0 24px rgba(56,189,248,0.3)',
          }}>
            <Loader2 size={34} color="#38bdf8" className="animate-spin" />
          </div>

          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 14px',
            borderRadius: '16px',
            backgroundColor: '#064e3b',
            color: '#6ee7b7',
            fontSize: '12px',
            fontWeight: 600,
            marginBottom: '16px',
          }}>
            <PhoneOff size={14} />
            <span>Call Disconnected • Meeting Completed</span>
          </div>

          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f8fafc', margin: '0 0 10px 0' }}>
            AI Secretary is Synthesizing Minutes...
          </h2>
          <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '580px', margin: '0 auto 24px auto', lineHeight: 1.6 }}>
            The voice session for <span style={{ color: '#38bdf8', fontWeight: 600 }}>#{roomName}</span> has concluded.
            Our enterprise LLM is analyzing all recorded discussion turns to generate the executive summary, key decisions, and action items.
          </p>

          {/* Quick Metrics */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            marginBottom: '28px',
            flexWrap: 'wrap',
          }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '10px 18px', borderRadius: '10px', minWidth: '120px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>ROOM</span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#cbd5e1' }}>#{roomName}</span>
            </div>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '10px 18px', borderRadius: '10px', minWidth: '120px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>TURNS CAPTURED</span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#38bdf8' }}>{transcripts.length} dialogue lines</span>
            </div>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '10px 18px', borderRadius: '10px', minWidth: '120px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>STATUS</span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#10b981' }}>NLP Processing...</span>
            </div>
          </div>

          {/* Dialogue Transcript Preview */}
          {transcripts.length > 0 && (
            <div style={{ textAlign: 'left', marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={14} color="#38bdf8" />
                <span>Captured Discussion Transcripts ({transcripts.length}):</span>
              </div>
              <div style={{
                maxHeight: '180px',
                overflowY: 'auto',
                backgroundColor: '#0b0f19',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {transcripts.map((t, idx) => (
                  <div key={idx} style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: '#38bdf8' }}>[{t.speakerName}]:</span> {t.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <button
              onClick={onNewCall}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Cancel & Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Error generating AI summary
  if (summaryError && !summary) {
    return (
      <div style={{ maxWidth: '840px', margin: '40px auto', padding: '0 20px', width: '100%' }}>
        <div style={{
          backgroundColor: '#131b2e',
          borderRadius: '16px',
          border: '1px solid #7f1d1d',
          padding: '36px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              backgroundColor: '#450a0a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f87171',
              flexShrink: 0,
            }}>
              <AlertCircle size={26} />
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#f87171', margin: '0 0 4px 0' }}>
                AI Summary Generation Notice
              </h2>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                The voice call ended successfully, but the AI synthesis encountered an issue.
              </div>
            </div>
          </div>

          <div style={{
            backgroundColor: '#1f1315',
            border: '1px solid #7f1d1d',
            borderRadius: '8px',
            padding: '14px',
            color: '#fca5a5',
            fontSize: '13px',
            marginBottom: '24px',
            lineHeight: 1.5,
          }}>
            <strong>Details:</strong> {summaryError}
          </div>

          {transcripts.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1', marginBottom: '8px' }}>
                Captured Transcripts ({transcripts.length} items preserved safely):
              </div>
              <div style={{
                maxHeight: '180px',
                overflowY: 'auto',
                backgroundColor: '#0b0f19',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {transcripts.map((t, idx) => (
                  <div key={idx} style={{ fontSize: '12px', color: '#cbd5e1' }}>
                    <span style={{ fontWeight: 600, color: '#38bdf8' }}>[{t.speakerName}]:</span> {t.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={onRetry}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                border: 'none',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} />
              <span>Retry AI Summary Generation</span>
            </button>
            <button
              onClick={onNewCall}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#cbd5e1',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Empty state
  if (!summary) {
    return (
      <div style={{ maxWidth: '840px', margin: '40px auto', padding: '0 20px', width: '100%', textAlign: 'center' }}>
        <div style={{ backgroundColor: '#131b2e', borderRadius: '16px', border: '1px solid #273553', padding: '40px' }}>
          <p style={{ color: '#94a3b8', marginBottom: '20px' }}>No meeting summary available for this session.</p>
          <button
            onClick={onNewCall}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              backgroundColor: '#2563eb',
              border: 'none',
              color: '#fff',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Start New Meeting
          </button>
        </div>
      </div>
    );
  }

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
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{summary.provider || 'Office LLM'}</span> on {new Date().toLocaleString()}
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
              {summary.decisions?.map((d, i) => (
                <li key={i} style={{ marginBottom: '6px' }}>{d}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#93c5fd', marginBottom: '10px' }}>
              Attendees Verified
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
