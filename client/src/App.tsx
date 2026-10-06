import { useState, useEffect, useEffectEvent, useRef, useCallback } from 'react';
import { apiRequest, meetingPath } from './api';
import { createSaveQueue } from './saveQueue';
import { useBackendTranscription } from './useBackendTranscription';
import { useSpeechTranscription } from './useSpeechTranscription';
import './App.css';
import { BrandLogo, HomeDashboard, LobbyView, WorkspaceSidebar } from './Workspace';
import { ScheduleView, type ScheduledMeeting } from './ScheduleView';
import { initials } from './presentation';
import { MeetingRoom } from './MeetingRoom';
import { cameraErrorMessage, useCameraControl } from './useCameraControl';
import { useScreenShareControl } from './useScreenShareControl';
import { useDeviceSettings } from './useDeviceSettings';
import { DeviceSettingsDialog } from './DeviceSettingsDialog';
import { useSpeakerSpotlight } from './useSpeakerSpotlight';
import { useMicrophoneControl } from './useMicrophoneControl';
import { usePreJoinMedia } from './usePreJoinMedia';
import type { JoinMediaChoices } from './usePreJoinMedia';
import { PreJoinPreview } from './PreJoinPreview';
import { Track, ConnectionState, MediaDeviceFailure } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useTrackVolume,
  useConnectionState,
  useTracks,
  useRoomContext,
  isTrackReference,
} from '@livekit/components-react';
import {
  Copy,
  Check,
  ArrowRight,
  Clock,
  AlertCircle,
  Loader2,
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
  dbSummaryId?: number;
}

const PRESET_PERSONAS = [
  { id: 'BT-10492', name: 'Rafli Aditya', dept: 'NOC & Core Network' },
  { id: 'BT-10214', name: 'Budi Santoso', dept: 'Field Transmission' },
  { id: 'BT-10883', name: 'Siti Rahma', dept: 'Project Management' },
  { id: 'BT-10550', name: 'Agus Pratama', dept: 'Fiber Infrastructure' },
];

export default function App() {
  const [view, setView] = useState<'home' | 'lobby' | 'in-call' | 'summary' | 'schedule'>('home');
  const [meetingIntent, setMeetingIntent] = useState<'create' | 'join'>('create');
  const [lastMeeting, setLastMeeting] = useState<{ title: string; roomName: string; endedAt: string; transcriptCount: number } | null>(null);
  const [schedules, setSchedules] = useState<ScheduledMeeting[]>([]);
  
  // Lobby state
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [department, setDepartment] = useState('');
  const [roomName, setRoomName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [personas, setPersonas] = useState(PRESET_PERSONAS);
  const preJoinMedia = usePreJoinMedia(view === 'lobby');
  const [joinMedia, setJoinMedia] = useState<JoinMediaChoices>(preJoinMedia.choices);
  const joinGeneration = useRef(0);
  const joinPending = useRef(false);
  const endingMeeting = useRef(false);
  
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
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryMeetingId, setSummaryMeetingId] = useState<string | null>(null);
  const [summaryToken, setSummaryToken] = useState<string | null>(null);
  const [summaryRoomName, setSummaryRoomName] = useState<string>('');
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
    database?: {
      connected: boolean;
      configured: boolean;
    };
    outboundWebhookConfigured?: boolean;
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

    // Fetch authorized employee directory from backend / PostgreSQL
    apiRequest<{ employees?: { employee_id: string; name: string; department: string }[] }>('/employees', {}, 5000)
      .then(data => {
        if (!cancelled && data?.employees && data.employees.length > 0) {
          setPersonas(data.employees.map(e => ({
            id: e.employee_id,
            name: e.name,
            dept: e.department,
          })));
        }
      })
      .catch(() => {});

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

  const fetchSchedules = useCallback(async () => {
    try {
      const data = await apiRequest<{ success: boolean; schedules: ScheduledMeeting[] }>('/schedules', { method: 'GET' }, 10000);
      if (data && Array.isArray(data.schedules)) {
        setSchedules(data.schedules);
      }
    } catch (err) {
      console.warn('Failed to fetch schedules:', err);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleCreateSchedule = async (scheduleData: {
    title: string;
    roomName: string;
    description: string;
    hostId: string;
    hostName: string;
    department: string;
    scheduledStart: string;
    scheduledEnd: string;
  }) => {
    const data = await apiRequest<{ success: boolean; schedule: ScheduledMeeting }>('/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduleData),
    });
    if (data.schedule) {
      setSchedules(prev => [data.schedule, ...prev].sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)));
    }
  };

  const handleCancelSchedule = async (id: string) => {
    await apiRequest<{ success: boolean }>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  const handleJoinScheduledRoom = (scheduledRoomName: string) => {
    setRoomName(scheduledRoomName);
    openLobby('join');
  };

  const handleJoin = async () => {
    if (joinPending.current) return;
    if (!employeeId.trim() || !employeeName.trim() || !roomName.trim() || !department.trim()) {
      setJoinError('Lengkapi identitas, departemen, dan nama ruang.'); return;
    }
    // Format validation check (e.g. reject non-ID text such as "ns-12nsunauu")
    const cleanId = employeeId.trim();
    if (!/^BT-\d{4,6}$/i.test(cleanId)) {
      setJoinError('Format ID Salah.');
      return;
    }

    const mediaChoices = preJoinMedia.prepareJoin();
    if ((mediaChoices.microphoneEnabled || mediaChoices.cameraEnabled) && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
      setJoinError('Mikrofon membutuhkan HTTPS atau localhost. Untuk PC lain, gunakan alamat HTTPS aplikasi.'); return;
    }
    const generation = ++joinGeneration.current;
    joinPending.current = true;
    setJoinError(null); setCallError(null); setSyncError(null); setIsJoining(true);
    try {
      const data = await apiRequest<{ token: string; url: string; meetingId: string; sttProvider: 'browser' | 'server' }>('/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomName.trim(), employeeId: cleanId, employeeName: employeeName.trim(), department }),
      });
      if (generation !== joinGeneration.current) return;
      endingMeeting.current = false;
      setJoinMedia(mediaChoices);
      setToken(data.token); setMeetingId(data.meetingId); setServerUrl(data.url); setSttProvider(data.sttProvider);
      setTranscripts([]); setCallDuration('00:00'); setMeetingStartTime(Date.now());
      setSummary(null); setSummaryError(null); setSummaryMeetingId(null); setSummaryToken(null); setSummaryRoomName('');
      setView('in-call');
    } catch (error) { if (generation === joinGeneration.current) setJoinError(error instanceof Error ? error.message : 'Gagal bergabung'); }
    finally { if (generation === joinGeneration.current) { joinPending.current = false; setIsJoining(false); } }
  };

  const triggerSummarize = async (
    targetMeetingId: string,
    targetToken: string,
    targetRoomName: string,
    fallbackTranscripts: TranscriptEntry[],
    leavePromise?: Promise<{ status: string } | void>
  ) => {
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const left = leavePromise ? await leavePromise : null;
      const data = await apiRequest<{ summary: MeetingSummary; meetingStatus?: string }>(
        meetingPath(targetMeetingId, 'summarize'),
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' },
          body: '{}',
        },
        125000
      );
      setLastMeeting({
        title: data.summary.title,
        roomName: targetRoomName,
        endedAt: data.summary.generatedAt || new Date().toISOString(),
        transcriptCount: data.summary.transcriptCount || fallbackTranscripts.length,
      });
      const isOtherActive = left && typeof left === 'object' && 'status' in left && left.status === 'active';
      setSummary(
        isOtherActive
          ? {
              ...data.summary,
              note: [
                data.summary.note,
                'Peserta lain masih berada di meeting. Ringkasan ini memakai transkrip saat permintaan ringkasan dikirim.',
              ]
                .filter(Boolean)
                .join(' '),
            }
          : data.summary
      );
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : 'Gagal membuat notulen AI. Silakan coba lagi.'
      );
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleEndMeeting = async (generate = true) => {
    if (!meetingId || !token || endingMeeting.current) return;
    endingMeeting.current = true;
    const currentMeetingId = meetingId;
    const currentToken = token;
    const currentRoomName = roomName;
    const capturedTranscripts = [...transcripts];

    // Flush any pending utterances in the save queue
    try {
      await saveQueue.flush();
    } catch (flushErr) {
      console.warn('Transcript flush note:', flushErr);
    }

    // 1. Terminate call media session immediately (turns off microphone, camera, and screen share)
    setToken(null);
    setMeetingStartTime(null);
    setCallDuration('00:00');

    // 2. Notify backend of leave in background
    const leavePromise = apiRequest<{ status: string }>(meetingPath(currentMeetingId, 'leave'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(err => {
      console.warn('Leave request note:', err);
      return { status: 'ended' };
    });

    if (!generate) {
      setMeetingId(null);
      setTranscripts([]);
      setView('home');
      return;
    }

    // 3. Immediately transition to summary view with loading card
    setView('summary');
    setIsSummarizing(true);
    setSummary(null);
    setSummaryError(null);
    setSummaryMeetingId(currentMeetingId);
    setSummaryToken(currentToken);
    setSummaryRoomName(currentRoomName);

    // 4. Request summary in the background
    try {
      await triggerSummarize(currentMeetingId, currentToken, currentRoomName, capturedTranscripts, leavePromise);
    } finally {
      endingMeeting.current = false;
    }
  };

  const handleRetrySummarize = () => {
    if (summaryMeetingId && summaryToken) {
      void triggerSummarize(summaryMeetingId, summaryToken, summaryRoomName || roomName, transcripts);
    }
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
    if (!meetingId || !token || endingMeeting.current) return;
    const generation = joinGeneration.current;
    try { await apiRequest(meetingPath(meetingId, 'presence'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ connected }),
    }, 5000); } catch { if (connected && !endingMeeting.current && generation === joinGeneration.current) setSyncError('Kehadiran belum tersinkron. Periksa koneksi layanan.'); }
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
    joinGeneration.current++; joinPending.current = false; setIsJoining(false);
    preJoinMedia.resetLobby();
    setMeetingIntent(intent);
    setJoinError(null);
    setView('lobby');
  };

  return (
    <div className={`app-root ${view === 'in-call' ? 'in-call-layout' : ''}`}>
      {view !== 'in-call' && (
        <WorkspaceSidebar
          view={view}
          intent={meetingIntent}
          employeeName={employeeName}
          hasSummary={Boolean(summary) || isSummarizing}
          onHome={() => { joinGeneration.current++; joinPending.current = false; setIsJoining(false); preJoinMedia.stopAll(); setView('home'); }}
          onCreate={() => openLobby('create')}
          onJoin={() => openLobby('join')}
          onSchedule={() => { joinGeneration.current++; joinPending.current = false; setIsJoining(false); preJoinMedia.stopAll(); setView('schedule'); }}
          onSummary={() => { joinGeneration.current++; joinPending.current = false; setIsJoining(false); preJoinMedia.stopAll(); setView('summary'); }}
        />
      )}
      <div className="workspace-body">
      <header className={`app-header ${view === 'in-call' ? 'app-header-call' : ''}`}>
        {view === 'in-call' ? (
          <div className="call-brand"><BrandLogo inverse /><span>Bali Tower Sentra</span></div>
        ) : (
          <div className="page-identity">
            <span>Workspace / {view === 'home' ? 'Beranda' : view === 'lobby' ? 'Ruang rapat' : view === 'schedule' ? 'Jadwal rapat' : 'Notulen'}</span>
            <strong>Internal Meeting & AI Minutes</strong>
          </div>
        )}

        <div className="header-meta">
          {view === 'in-call' ? <div className="call-clock"><Clock size={15} />{callDuration}</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className={`service-status ${backendHealth ? 'is-online' : healthChecked ? 'is-offline' : 'is-checking'}`} role="status">
                <span className="status-dot" />
                {backendHealth ? `Layanan ${backendHealth.livekitStatus === 'reachable' ? 'siap' : 'terbatas'}` : healthChecked ? 'Layanan tidak tersambung' : 'Memeriksa layanan'}
              </div>
              {backendHealth?.database && (
                <div className={`service-status ${backendHealth.database.connected ? 'is-online' : 'is-checking'}`} title={backendHealth.database.connected ? 'Database PostgreSQL Terhubung' : 'Database PostgreSQL Standby'} style={{ fontSize: '11px', padding: '4px 8px' }}>
                  <span className="status-dot" style={{ backgroundColor: backendHealth.database.connected ? '#10b981' : '#f59e0b' }} />
                  {backendHealth.database.connected ? 'DB: Aktif' : 'DB: Standby'}
                </div>
              )}
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
          onSchedule={() => setView('schedule')}
          upcomingSchedules={schedules}
        />}
        {view === 'schedule' && (
          <ScheduleView
            schedules={schedules}
            employeeId={employeeId}
            employeeName={employeeName}
            department={department}
            onBack={() => setView('home')}
            onCreateSchedule={handleCreateSchedule}
            onCancelSchedule={handleCancelSchedule}
            onJoinRoom={handleJoinScheduledRoom}
          />
        )}
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
            mediaPreview={<PreJoinPreview media={preJoinMedia} employeeName={employeeName} blocked={isJoining} />}
            personas={personas}
          />
        )}

        {view === 'in-call' && token && (
          <InCallView
            joinMedia={joinMedia}
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
            roomName={summaryRoomName || roomName}
            meetingId={summaryMeetingId || meetingId || ''}
            token={summaryToken || token || ''}
            transcripts={transcripts}
            copied={copied}
            onCopy={copyMarkdownSummary}
            isSummarizing={isSummarizing}
            summaryError={summaryError}
            onRetry={handleRetrySummarize}
            onNewCall={() => {
              setToken(null);
              setMeetingId(null);
              setCallError(null);
              setTranscripts([]);
              setSummary(null);
              setSummaryError(null);
              setSummaryMeetingId(null);
              setSummaryToken(null);
              setSummaryRoomName('');
              setView('home');
            }}
          />
        )}
      </main>
      </div>
    </div>
  );
}

function InCallView({
  joinMedia,
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
  const [mediaOptions] = useState(() => ({
    audioCaptureDefaults: { deviceId: joinMedia.microphoneId === 'default' ? undefined : { exact: joinMedia.microphoneId } },
    videoCaptureDefaults: { deviceId: joinMedia.cameraId === 'default' ? undefined : { exact: joinMedia.cameraId } },
  }));
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const onRoomError = useCallback((error: Error) => {
    // Camera access errors are handled separately; audio can remain connected.
    const failure = MediaDeviceFailure.getFailure(error);
    if (!failure || failure === MediaDeviceFailure.Other) setConnectionError('Koneksi rapat bermasalah: ' + error.message);
  }, []);
  const onConnected = useCallback(() => setConnectionError(null), []);
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
    {connectionError && <div role="alert" style={{ padding: '12px', color: '#fca5a5' }}>{connectionError}</div>}
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      onError={onRoomError}
      onConnected={onConnected}
      audio={joinMedia.microphoneEnabled}
      options={mediaOptions}
      style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
    >
      <RoomAudioRenderer />
      <RoomContent
        startWithCamera={joinMedia.cameraEnabled}
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
  startWithCamera,
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
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack, isCameraEnabled, isScreenShareEnabled, lastCameraError, lastMicrophoneError } = useLocalParticipant();
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).filter(isTrackReference).filter(track => !track.publication.isMuted);
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const spotlightIdentity = useSpeakerSpotlight(room, connected);
  const camera = useCameraControl(localParticipant, connected, startWithCamera);
  const microphone = useMicrophoneControl(localParticipant, connected);
  const screenShareSupported = window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const screenShare = useScreenShareControl(localParticipant, connected, screenShareSupported);
  const cameraError = isCameraEnabled ? null : camera.error || (lastCameraError ? cameraErrorMessage(lastCameraError) : null);
  const microphoneError = microphone.error || (!isMicrophoneEnabled && lastMicrophoneError ? 'Mikrofon tidak tersedia. Periksa perangkat dan izin browser.' : null);
  const isMuted = !isMicrophoneEnabled;
  const [finishing, setFinishing] = useState(false);
  const finishRequest = useRef(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const closeDevices = useCallback(() => setDevicesOpen(false), []);
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
  const { prepareTrackChange, resumeTrackChange } = backendSpeech;
  const prepareMicrophoneChange = useCallback(async () => {
    if (sttProvider === 'server') await prepareTrackChange();
  }, [sttProvider, prepareTrackChange]);
  const resumeMicrophoneChange = useCallback(() => {
    resumeTrackChange();
  }, [resumeTrackChange]);
  const deviceSettings = useDeviceSettings(room, connected, finishing || isSummarizing || camera.pending || microphone.pending, prepareMicrophoneChange, resumeMicrophoneChange);
  const { isListeningSpeechApi, interimText, speechError, toggleSpeechRecognition, speechEnabled, finishTranscription } =
    sttProvider === 'server' ? backendSpeech : browserSpeech;
  const finishMeeting = async (generate: boolean) => {
    if (finishRequest.current) return;
    finishRequest.current = true;
    setFinishing(true); setFinishError(null);
    try { await finishTranscription(); await onEndMeeting(generate); }
    catch (error) { setFinishError(error instanceof Error ? error.message : 'Gagal menyelesaikan transkripsi'); }
    finally { finishRequest.current = false; setFinishing(false); }
  };

  return <><MeetingRoom
    participants={participants} roomName={roomName} employeeId={employeeId}
    cameraTracks={cameraTracks} isCameraEnabled={isCameraEnabled} cameraPending={camera.pending}
    cameraError={cameraError} microphoneError={microphoneError} onToggleCamera={camera.toggleCamera}
    microphonePending={microphone.pending} connectionState={connectionState}
    screenTracks={screenTracks} isScreenShareEnabled={isScreenShareEnabled} screenSharePending={screenShare.pending}
    screenShareError={screenShare.error} screenShareSupported={screenShareSupported} onToggleScreenShare={screenShare.toggleScreenShare}
    devicePending={deviceSettings.pendingKind !== null} deviceError={devicesOpen ? null : deviceSettings.error} onOpenDevices={() => setDevicesOpen(true)}
    spotlightIdentity={spotlightIdentity}
    connected={connected} isMuted={isMuted} micVolume={micVolume} finishing={finishing} isSummarizing={isSummarizing}
    finishError={finishError} speechError={speechError} interimText={interimText} isListening={isListeningSpeechApi}
    speechEnabled={speechEnabled} saveBlocked={saveBlocked} sttProvider={sttProvider} sttConfigured={sttConfigured}
    setSttProvider={setSttProvider} speechLanguage={speechLanguage} setSpeechLanguage={setSpeechLanguage}
    activeTab={activeTab} setActiveTab={setActiveTab} transcripts={transcripts}
    onToggleMute={microphone.toggleMicrophone} onToggleTranscription={toggleSpeechRecognition} onFinish={finishMeeting} onAddSpeechLine={onAddSpeechLine}
  />{devicesOpen && <DeviceSettingsDialog settings={deviceSettings} connected={connected} blocked={finishing || isSummarizing || camera.pending || microphone.pending} micVolume={micVolume} sttProvider={sttProvider} onClose={closeDevices} />}</>;
}

function SummaryView({
  summary,
  roomName,
  meetingId,
  token,
  transcripts,
  copied,
  onCopy,
  onNewCall,
  isSummarizing = false,
  summaryError = null,
  onRetry,
}: {
  summary: MeetingSummary | null;
  roomName: string;
  meetingId: string;
  token: string;
  transcripts: TranscriptEntry[];
  copied: boolean;
  onCopy: () => void;
  onNewCall: () => void;
  isSummarizing?: boolean;
  summaryError?: string | null;
  onRetry?: () => void;
}) {
  const [tab, setTab] = useState<'summary' | 'decisions' | 'actions' | 'transcript'>('summary');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'json' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const downloadExport = async (format: 'pdf' | 'json') => {
    setExporting(format);
    setExportError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'}/meetings/${encodeURIComponent(meetingId)}/export/${format}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        let message = `Gagal mengunduh ${format.toUpperCase()}.`;

        try {
          const errorData = await response.json();
          if (errorData?.error) message = errorData.error;
        } catch {
          // Keep the default message when the server response is not JSON.
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `balicall-meeting-${meetingId}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : `Gagal mengunduh ${format.toUpperCase()}.`,
      );
    } finally {
      setExporting(null);
    }
  };
  const filteredTranscripts = transcripts.filter(entry =>
    `${entry.speakerName} ${entry.text}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))
  );

  if (isSummarizing && !summary) {
    return (
      <div className="summary-page">
        <button className="back-link" onClick={onNewCall}><ChevronLeft size={16} /> Kembali ke beranda</button>
        <section className="summary-card">
          <header className="summary-heading" style={{ borderBottom: '1px solid #e3ebf6', paddingBottom: '20px' }}>
            <div>
              <div className="ai-processing-pill">
                <Loader2 size={14} className="ui-spinner" />
                <span>MEMPROSES NOTULEN AI</span>
              </div>
              <h1 style={{ marginTop: '12px' }}>Menyusun Notulen & Ringkasan Rapat...</h1>
              <p className="summary-meta">Panggilan telah diakhiri · Ruang <strong>#{roomName}</strong> · <strong>{transcripts.length} ucapan</strong> direkam</p>
            </div>
            <div className="summary-actions">
              <button className="button-secondary" onClick={onNewCall}>Kembali ke beranda</button>
            </div>
          </header>

          <div className="summary-processing-notice">
            <Clock size={24} style={{ color: '#2563eb', flexShrink: 0 }} />
            <div>
              <strong>Kamera dan mikrofon Anda telah dinonaktifkan.</strong>
              <p>
                Panggilan telah selesai. AI sedang menganalisis seluruh percakapan yang terekam untuk menyusun
                ringkasan eksekutif, pokok pembahasan, keputusan, dan daftar tindak lanjut (action items).
              </p>
            </div>
          </div>

          <section className="summary-section" style={{ marginTop: '20px' }}>
            <div className="transcript-heading">
              <div>
                <h2>Transkrip Percakapan ({transcripts.length} ucapan)</h2>
                <p>Pratinjau percakapan yang sedang diproses oleh AI</p>
              </div>
            </div>
            {transcripts.length > 0 ? (
              <div className="recap-transcript-list" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {transcripts.map(entry => (
                  <article className="recap-transcript-entry" key={entry.id}>
                    <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                    <div>
                      <strong>{entry.speakerName}</strong>
                      <p>{entry.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-transcript">Belum ada transkrip ucapan yang terekam.</p>
            )}
          </section>
        </section>
      </div>
    );
  }

  if (summaryError && !summary) {
    return (
      <div className="summary-page">
        <button className="back-link" onClick={onNewCall}><ChevronLeft size={16} /> Kembali ke beranda</button>
        <section className="summary-card">
          <header className="summary-heading" style={{ borderBottom: '1px solid #fed7d7', paddingBottom: '20px' }}>
            <div>
              <div className="ai-error-pill">
                <AlertCircle size={14} />
                <span>GAGAL MEMBUAT NOTULEN</span>
              </div>
              <h1 style={{ marginTop: '12px', color: '#b91c1c' }}>Notulen Rapat Belum Dapat Dibuat</h1>
              <p className="summary-meta">Ruang <strong>#{roomName}</strong> · Panggilan telah diakhiri · {transcripts.length} ucapan tersimpan</p>
            </div>
            <div className="summary-actions">
              {onRetry && (
                <button className="button-primary" onClick={onRetry}>
                  🔄 Coba Buat Notulen Lagi
                </button>
              )}
              <button className="button-secondary" onClick={onNewCall}>Kembali ke beranda</button>
            </div>
          </header>

          <div className="summary-error-notice">
            <AlertCircle size={22} style={{ color: '#dc2626', flexShrink: 0 }} />
            <div>
              <strong>Terjadi kendala saat menghubungi asisten AI:</strong>
              <p>{summaryError}</p>
            </div>
          </div>

          <section className="summary-section" style={{ marginTop: '20px' }}>
            <div className="transcript-heading">
              <div>
                <h2>Transkrip Percakapan ({transcripts.length} ucapan)</h2>
                <p>Transkrip Anda tetap aman dan dapat dibaca di bawah:</p>
              </div>
            </div>
            {transcripts.length > 0 ? (
              <div className="recap-transcript-list" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {transcripts.map(entry => (
                  <article className="recap-transcript-entry" key={entry.id}>
                    <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                    <div>
                      <strong>{entry.speakerName}</strong>
                      <p>{entry.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-transcript">Tidak ada transkrip ucapan pada rapat ini.</p>
            )}
          </section>
        </section>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="summary-page">
        <button className="back-link" onClick={onNewCall}><ChevronLeft size={16} /> Kembali ke beranda</button>
        <section className="summary-card">
          <p>Belum ada notulen yang tersedia.</p>
        </section>
      </div>
    );
  }

  const tabs = [
    { id: 'summary', label: 'Ringkasan' },
    { id: 'decisions', label: `Keputusan (${summary.decisions?.length || 0})` },
    { id: 'actions', label: `Tindak lanjut (${summary.actionItems?.length || 0})` },
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
            <p className="summary-meta">
              Ruang <strong>#{roomName}</strong> · {summary.generatedAt ? new Date(summary.generatedAt).toLocaleString('id-ID') : 'Waktu tidak tersedia'} · {transcripts.length} ucapan
              {summary.dbSummaryId && <span className="db-badge">💾 Tersimpan di Database (ID: #{summary.dbSummaryId})</span>}
            </p>
          </div>
          <div className="summary-actions">
            <button className="button-secondary" onClick={onCopy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Tersalin' : 'Salin notulen'}
            </button>

            <button className="button-secondary" onClick={() => void downloadExport('json')} disabled={exporting !== null}>
              {exporting === 'json' ? <Loader2 className="ui-spinner" size={15} /> : null}
              {exporting === 'json' ? 'Menyiapkan JSON...' : 'Export JSON'}
            </button>

            <button className="button-secondary" onClick={() => void downloadExport('pdf')} disabled={exporting !== null}>
              {exporting === 'pdf' ? <Loader2 className="ui-spinner" size={15} /> : null}
              {exporting === 'pdf' ? 'Menyiapkan PDF...' : 'Export PDF'}
            </button>

            <button className="button-primary" onClick={onNewCall}> Rapat baru <ArrowRight size={15} /></button>
          </div>
        </header>

        {summary.note && <div className="summary-note"><AlertCircle size={16} />{summary.note}</div>}

        {exportError && (
          <div className="summary-note" role="alert">
            <AlertCircle size={16} />
            {exportError}
          </div>
        )}
        <nav className="summary-tabs" aria-label="Bagian notulen" role="tablist">
          {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`summary-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>

        {tab === 'summary' && <div className="summary-panel">
          <section className="summary-section"><h2>Ringkasan rapat</h2><p>{summary.executiveSummary || 'Belum ada ringkasan yang tersedia.'}</p></section>
          <div className="summary-preview-grid">
            <section className="summary-section"><h2>Keputusan</h2>{summary.decisions?.length ? <ol className="summary-list">{summary.decisions.slice(0, 3).map((decision, index) => <li key={index}>{decision}</li>)}</ol> : <p>Belum ada keputusan yang tercatat.</p>}</section>
            <section className="summary-section"><h2>Tindak lanjut</h2>{summary.actionItems?.length ? <ol className="summary-list">{summary.actionItems.slice(0, 3).map((item, index) => <li key={index}><strong>{item.assignee}</strong> · {item.task}</li>)}</ol> : <p>Belum ada tindak lanjut yang tercatat.</p>}</section>
          </div>
          <section className="summary-section"><h2>Pokok pembahasan</h2>{summary.keyDiscussionPoints?.length ? <ul className="summary-list">{summary.keyDiscussionPoints.map((point, index) => <li key={index}>{point}</li>)}</ul> : <p>Belum ada pokok pembahasan.</p>}</section>
          <section className="summary-section"><h2>Peserta</h2><div className="attendee-list">{summary.attendanceSummary?.length ? summary.attendanceSummary.map((attendee, index) => <span key={index}>{attendee}</span>) : <span>Data peserta tidak tersedia</span>}</div></section>
        </div>}

        {tab === 'decisions' && <div className="summary-panel"><section className="summary-section"><h2>Keputusan rapat</h2>{summary.decisions?.length ? <ol className="summary-list ordered">{summary.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ol> : <p>Belum ada keputusan yang tercatat.</p>}</section></div>}

        {tab === 'actions' && <div className="summary-panel"><section className="summary-section"><h2>Tindak lanjut</h2>{summary.actionItems?.length ? <div className="action-table-wrap"><table className="action-table"><thead><tr><th>Tugas</th><th>Penanggung jawab</th><th>Prioritas</th><th>Tenggat</th></tr></thead><tbody>{summary.actionItems.map((item, index) => <tr key={index}><td>{item.task}</td><td>{item.assignee || 'Belum ditentukan'}</td><td><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.deadline || 'Belum ditentukan'}</td></tr>)}</tbody></table></div> : <p>Belum ada tindak lanjut yang tercatat.</p>}</section></div>}

        {tab === 'transcript' && <div className="summary-panel"><section className="summary-section">
          <div className="transcript-heading"><div><h2>Transkrip lengkap</h2><p>{filteredTranscripts.length} dari {transcripts.length} ucapan</p></div><label className="transcript-search"><Search size={15} /><input aria-label="Cari transkrip" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau isi ucapan" /></label></div>
          {filteredTranscripts.length ? <div className="recap-transcript-list">{filteredTranscripts.map(entry => <article className="recap-transcript-entry" key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{entry.speakerName}</strong><p>{entry.text}</p></div></article>)}</div> : <p className="empty-transcript">{transcripts.length ? 'Tidak ada ucapan yang cocok dengan pencarian.' : 'Belum ada transkrip untuk rapat ini.'}</p>}
        </section></div>}
      </section>
    </div>
  );
}
