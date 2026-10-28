import {recordingDownloadName} from './recordingDownload';
import {usePostMeetingBatch} from './usePostMeetingBatch';
import type {PostMeetingBatchJob} from './usePostMeetingBatch';
import { useWhisperLiveTranscription } from './useWhisperLiveTranscription.ts';
import { useState, useEffect, useEffectEvent, useRef, useCallback, useId } from 'react';
import { apiRequest, meetingPath, API_BASE, featureError } from './api';
import { SettingsPage } from './SettingsPage';
import { DocumentationPage } from './DocumentationPage';
import { useBackendHealth } from './useBackendHealth';
import { UserAvatar } from './ProfileEditor';
import { NotificationCenter } from './NotificationCenter';
import { EmployeeInvites } from './EmployeeInvites';
import { AIProcessingIndicator } from './AIProcessingIndicator';
import { ScheduleReminders } from './ScheduleReminders';
import { useScheduleFeed } from './useScheduleFeed';
import { usePreferences } from './usePreferences';
import { mediaChoices, resolveTranscriptionPreferences, getRecommendedProvider } from './preferences';
import type { MeetingPreferences } from './preferences';
import { usePreferredAudioOutput } from './usePreferredAudioOutput';
import { createSaveQueue } from './saveQueue';
import { TranscriptRealtimeBridge } from './TranscriptRealtimeBridge';
import { createTranscriptDelivery } from './transcriptDelivery';
import { useBackendTranscription } from './useBackendTranscription';
import { useSpeechTranscription } from './useSpeechTranscription';
import './App.css';
import { upsertSummary, validSummary, normalizeDbSummary, scopedSummaryStorage } from './summaryHistory';
import type { AuthUser } from './AuthGate';
import type { MeetingSummary, TranscriptEntry, SummaryRecord, InProgressRecord } from './summaryHistory';
import {
  routeToHash,
  hashToRoute,
  isSameRoute,
  sanitizeRouteForGuest,
  syncBrowserHistory,
} from './navigation';
import type { AppView, SettingsSection, RouteState } from './navigation';
import { SummaryHistoryView } from './SummaryHistoryView';
import { RecordingUploadView } from './RecordingUploadView';
import { BrandLogo, HomeDashboard, LobbyView, WorkspaceSidebar } from './Workspace';
import { ScheduleView, type ScheduledMeeting } from './ScheduleView';
import { initials } from './presentation';
import { MeetingRoom } from './MeetingRoom';
import { cameraErrorMessage, useCameraControl } from './useCameraControl';
import { useBackgroundBlur } from './useBackgroundBlur';
import { useScreenShareControl } from './useScreenShareControl';
import { useDeviceSettings } from './useDeviceSettings';
import { DeviceSettingsDialog } from './DeviceSettingsDialog';
import { supportsSharedMicrophone, qwenDiarizationForModel } from './preferences';
import type { LiveFinal } from './liveTranscription';
import { SEA_LIVE_MODEL, isLiveTranscriptionModel, liveTranscriptBody, modelPreferencePatch } from './modelSelection';
import { speakerDisplayLabel } from './transcriptSpeakers';
import type { SpeakerNameChange } from './SpeakerNameEditor';
import { mergeTranscripts } from './transcriptMerge';
import { shouldMirrorCamera } from './backgroundEffects';
import { useSpeakerSpotlight } from './useSpeakerSpotlight';
import { useMicrophoneControl } from './useMicrophoneControl';
import { usePreJoinMedia } from './usePreJoinMedia';
import { usePageFocus } from './usePageFocus';
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
  LogOut,
  Copy,
  Check,
  ArrowRight,
  Clock,
  AlertCircle,
  Loader2,
  Search,
  ChevronLeft,
  Home,
  Sparkles,
  Video,
} from 'lucide-react';

type MeetingRole = 'host' | 'co-host' | 'participant';

const PRESET_PERSONAS = [
  { id: 'BT-10492', name: 'Rafli Aditya', dept: 'NOC & Core Network' },
  { id: 'BT-10214', name: 'Budi Santoso', dept: 'Field Transmission' },
  { id: 'BT-10883', name: 'Siti Rahma', dept: 'Project Management' },
  { id: 'BT-10550', name: 'Agus Pratama', dept: 'Fiber Infrastructure' },
];

export default function App({ authUser = null, onLogout, logoutPending = false, onProfileUpdated }: { onProfileUpdated?: (user:AuthUser)=>void; authUser?: AuthUser | null; onLogout?: () => Promise<void>; logoutPending?: boolean }) {
  const isGuest = Boolean(authUser?.isGuest);
  const [guestInviteCode, setGuestInviteCode] = useState('');
  const [summaryStorage] = useState(() => scopedSummaryStorage(authUser?.employeeId || null));
  const { readSummaryHistory, readSummarySession, saveSummaryHistory, saveSummarySession, summaryTokenFor,
    readInProgressSummaries, saveInProgressSummary, removeInProgressSummary, readActiveView, saveActiveView } = summaryStorage;
  const [initialSummaryState] = useState(() => {
    const history = readSummaryHistory();
    const session = readSummarySession();
    const inProgress = readInProgressSummaries();
    const savedActiveView = readActiveView();
    const selected = session?.open ? history.find(item => item.meetingId === session.meetingId) : undefined;
    const matchingInProgress = session?.open ? inProgress.find(item => item.meetingId === session.meetingId) : undefined;
    return {
      history,
      session: (session?.open || savedActiveView === 'summary') ? session : null,
      selected,
      matchingInProgress,
      savedActiveView,
    };
  });

  const [initialRoute] = useState<RouteState>(() => {
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash !== '#' && window.location.hash !== '#/' && !window.location.hash.startsWith('#main-content')) {
      const parsed = hashToRoute(window.location.hash);
      return sanitizeRouteForGuest(parsed, isGuest);
    }
    if (isGuest) return { view: 'lobby', intent: 'join' };
    if (initialSummaryState.savedActiveView === 'summary') return { view: 'summary' };
    if (initialSummaryState.session) return { view: 'summary', meetingId: initialSummaryState.session.meetingId || null };
    return { view: 'home' };
  });

  const routeSummaryRecord = initialRoute.view === 'summary' && initialRoute.meetingId
    ? initialSummaryState.history.find(item => item.meetingId === initialRoute.meetingId)
    : undefined;

  const [inProgressList, setInProgressList] = useState<InProgressRecord[]>(() => readInProgressSummaries());
  const [summaryHistory, setSummaryHistory] = useState(initialSummaryState.history);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(initialRoute.section || 'overview');
  const [recordingId, setRecordingId] = useState<string | null>(initialRoute.recordingId || null);
  const [meetingIntent, setMeetingIntent] = useState<'create' | 'join'>(initialRoute.intent || (isGuest ? 'join' : 'create'));
  const [view, setView] = useState<AppView>(() => {
    if (isGuest) return 'lobby';
    if (initialSummaryState.savedActiveView === 'summary') return 'summary';
    if (initialSummaryState.session) return 'summary';
    return 'home';
  });
  const contentRef = useRef<HTMLElement>(null);
  usePageFocus(`${view}:${view === 'lobby' ? meetingIntent : ''}`, contentRef);
  const [lastMeeting, setLastMeeting] = useState<{ title: string; roomName: string; endedAt: string; transcriptCount: number } | null>(null);
  const scheduleFeed = useScheduleFeed(!isGuest);
  const schedules = scheduleFeed.schedules;
  const setSchedules = scheduleFeed.update;
  
  // Lobby state
  const DEV_EMPLOYEE = {
    employeeId: 'BT-10492',
    name: 'Rafli Aditya',
    email: 'rafli.aditya@balitower.co.id',
    department: 'NOC & Core Network',
    position: 'Network Operations Engineer',
  };

  const [employeeId, setEmployeeId] = useState(
    authUser?.employeeId || (import.meta.env.DEV ? DEV_EMPLOYEE.employeeId : '')
  );
  const [employeeName, setEmployeeName] = useState(
    authUser?.name || (import.meta.env.DEV ? DEV_EMPLOYEE.name : '')
  );
  const [department, setDepartment] = useState(
    authUser?.department || (import.meta.env.DEV ? DEV_EMPLOYEE.department : '')
  );
  const [roomName, setRoomName] = useState(
    authUser?.guestRoomName || (import.meta.env.DEV ? 'Rapat Tim NOC & Core Network' : '')
  );
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [personas, setPersonas] = useState(PRESET_PERSONAS);
  const userPreferences = usePreferences();
  const preJoinMedia = usePreJoinMedia(view === 'lobby', mediaChoices(userPreferences.preferences));
  const [callPreferences, setCallPreferences] = useState<MeetingPreferences>(userPreferences.preferences);
  const summaryGeneration = useRef(0);
  const [joinMedia, setJoinMedia] = useState<JoinMediaChoices>(preJoinMedia.choices);
  const joinGeneration = useRef(0);
  const joinPending = useRef(false);
  const endingMeeting = useRef(false);
  
  // Connection state
  const [token, setToken] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [meetingRole, setMeetingRole] = useState<MeetingRole>('participant');
  const [meetingHostId, setMeetingHostId] = useState<string | null>(null);
  const [meetingCoHostIds, setMeetingCoHostIds] = useState<string[]>([]);
  const [microphoneRestricted, setMicrophoneRestricted] = useState(false);
  const [speakRequestAt, setSpeakRequestAt] = useState<string | null>(null);
  const [pendingSpeakRequests, setPendingSpeakRequests] = useState<Array<{ identity: string; name: string; speakRequestAt: string }>>([]);
  const [speakRequestPending, setSpeakRequestPending] = useState(false);

  const [sttProvider, setSttProvider] = useState<'browser' | 'server'>('browser');
  const [serverUrl, setServerUrl] = useState('ws://127.0.0.1:7880');
  
  // Active call state
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>(initialSummaryState.selected?.transcripts || routeSummaryRecord?.transcripts || initialSummaryState.session?.transcripts || []);
  const [activeTab, setActiveTab] = useState<'transcript' | 'attendance'>('transcript');
  const [callDuration, setCallDuration] = useState('00:00');
  const [meetingStartTime, setMeetingStartTime] = useState<number | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(Boolean(initialSummaryState.session && !initialSummaryState.selected && !routeSummaryRecord));
  const [batchDiarizing, setBatchDiarizing] = useState(false);
  const [summary, setSummary] = useState<MeetingSummary | null>(initialSummaryState.selected?.summary || routeSummaryRecord?.summary || null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryMeetingId, setSummaryMeetingId] = useState<string | null>(initialRoute.meetingId || initialSummaryState.session?.meetingId || null);
  const [summaryToken, setSummaryToken] = useState<string | null>(initialSummaryState.session?.token || (routeSummaryRecord ? summaryTokenFor(routeSummaryRecord.meetingId) : null));
  const [summaryRoomName, setSummaryRoomName] = useState<string>(initialSummaryState.session?.roomName || routeSummaryRecord?.roomName || '');
  const [summaryHasRecording, setSummaryHasRecording] = useState<boolean>(Boolean(initialSummaryState.selected?.hasRecording || routeSummaryRecord?.hasRecording));
  const [copied, setCopied] = useState(false);
  const [transcriptSaveError, setTranscriptSaveError] = useState<string | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [recordingPending, setRecordingPending] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptDelivery] = useState(() => createTranscriptDelivery(entry => setTranscripts(previous => mergeTranscripts(previous, [entry]))));
  const receiveTranscripts = useCallback((entries: TranscriptEntry[]) => setTranscripts(previous => mergeTranscripts(previous, entries)), []);
  const [saveQueue] = useState(() => createSaveQueue<{ entry: TranscriptEntry | null; meetingId: string }>({
    onSaved: transcriptDelivery.saved,
    onChange: (count, error) => { setPendingSaves(count); setTranscriptSaveError(error); },
  }));

  useEffect(() => {
    if (view !== 'in-call' || !meetingId || !token) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    const syncMeetingRole = async () => {
      try {
        const data = await apiRequest<{
          status?: string;
          currentRole?: MeetingRole;
          hostId?: string;
          coHostIds?: string[];
          microphoneRestricted?: boolean;
          speakRequestAt?: string | null;
          pendingSpeakRequests?: Array<{
            identity: string;
            name: string;
            speakRequestAt: string;
          }>;
        }>(meetingPath(meetingId, 'transcript'), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (cancelled) return;

        if (data.status === 'ended' && !endingMeeting.current) {
          void handleEndMeetingRef.current?.(true);
          return;
        }

        setMeetingRole(data.currentRole || 'participant');
        setMeetingHostId(data.hostId || null);
        setMeetingCoHostIds(data.coHostIds || []);
        setMicrophoneRestricted(Boolean(data.microphoneRestricted));
        setSpeakRequestAt(data.speakRequestAt || null);
        setPendingSpeakRequests(data.pendingSpeakRequests || []);
     
      } catch {
        // Abaikan kegagalan polling sementara; coba lagi pada interval berikutnya.
      }

      if (!cancelled) {
        timer = setTimeout(syncMeetingRole, 2000);
      }
    };

    void syncMeetingRole();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [view, meetingId, token]);

  const currentRouteRef = useRef<RouteState>({
    view,
    section: settingsSection,
    meetingId: summaryMeetingId,
    intent: meetingIntent,
    recordingId,
  });
  currentRouteRef.current = {
    view,
    section: settingsSection,
    meetingId: summaryMeetingId,
    intent: meetingIntent,
    recordingId,
  };

  const meetingIdRef = useRef<string | null>(meetingId);
  meetingIdRef.current = meetingId;
  const handleEndMeetingRef = useRef<((generate?: boolean) => Promise<void>) | undefined>(undefined);

  const navigateTo = useCallback((next: RouteState, replace = false) => {
    const sanitized = sanitizeRouteForGuest(next, isGuest);
    const current = currentRouteRef.current;
    if (isSameRoute(current, sanitized)) {
      return;
    }

    if (current.view === 'lobby' && sanitized.view !== 'lobby') {
      joinGeneration.current++;
      joinPending.current = false;
      setIsJoining(false);
      preJoinMedia.stopAll();
    }

    syncBrowserHistory(sanitized, replace);

    setView(sanitized.view);
    if (sanitized.view === 'settings') {
      setSettingsSection(sanitized.section || 'overview');
    }
    if (sanitized.view === 'summary') {
      setSummaryMeetingId(sanitized.meetingId || null);
      if (!sanitized.meetingId) {
        setSummary(null);
        setIsSummarizing(false);
        setSummaryError(null);
      }
    }
    if (sanitized.view === 'recordings') {
      setRecordingId(sanitized.recordingId || null);
    }
    if (sanitized.view === 'lobby') {
      setMeetingIntent(sanitized.intent || (isGuest ? 'join' : 'create'));
    }
  }, [isGuest, preJoinMedia]);

  useEffect(() => {
    syncBrowserHistory(initialRoute, true);
  }, [initialRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = (event: PopStateEvent) => {
      if (currentRouteRef.current.view === 'in-call') {
        const confirmed = window.confirm('Apakah Anda yakin ingin meninggalkan rapat aktif? Percakapan yang sedang berlangsung akan dihentikan.');
        if (!confirmed) {
          const callRoute: RouteState = { view: 'in-call', meetingId: meetingIdRef.current };
          window.history.pushState(callRoute, '', routeToHash(callRoute));
          return;
        }
        void handleEndMeetingRef.current?.(false);
      }

      const rawRoute: RouteState = (event.state && typeof event.state.view === 'string')
        ? event.state
        : hashToRoute(window.location.hash, currentRouteRef.current);

      const nextRoute = sanitizeRouteForGuest(rawRoute, isGuest);

      if (currentRouteRef.current.view === 'lobby' && nextRoute.view !== 'lobby') {
        joinGeneration.current++;
        joinPending.current = false;
        setIsJoining(false);
        preJoinMedia.stopAll();
      }

      setView(nextRoute.view);
      if (nextRoute.view === 'settings') {
        setSettingsSection(nextRoute.section || 'overview');
      }
      if (nextRoute.view === 'summary') {
        const targetMeetingId = nextRoute.meetingId || null;
        setSummaryMeetingId(targetMeetingId);
        if (!targetMeetingId) {
          setSummary(null);
          setIsSummarizing(false);
          setSummaryError(null);
          const session = readSummarySession();
          if (session) saveSummarySession({ ...session, meetingId: '', open: true });
        } else {
          const found = summaryHistory.find(item => item.meetingId === targetMeetingId);
          if (found) {
            setSummary(found.summary);
            setTranscripts(found.transcripts);
            setSummaryRoomName(found.roomName);
            setSummaryToken(summaryTokenFor(found.meetingId));
          } else {
            apiRequest<{ success: boolean; summary?: MeetingSummary; transcripts?: TranscriptEntry[]; meeting?: { room_name?: string } }>(
              `/meetings/db-details/${encodeURIComponent(targetMeetingId)}`
            ).then(details => {
              if (details?.summary) {
                setSummary(details.summary);
                if (details.transcripts) setTranscripts(details.transcripts);
                if (details.meeting?.room_name) setSummaryRoomName(details.meeting.room_name);
              }
            }).catch(() => {});
          }
        }
      }
      if (nextRoute.view === 'recordings') {
        setRecordingId(nextRoute.recordingId || null);
      }
      if (nextRoute.view === 'lobby') {
        setMeetingIntent(nextRoute.intent || (isGuest ? 'join' : 'create'));
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isGuest, summaryHistory, readSummarySession, saveSummarySession, summaryTokenFor]);

  useEffect(() => {
    if (view !== 'in-call') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [view]);

  useEffect(() => {
    if (view !== 'in-call' && view !== 'lobby') {
      saveActiveView(view);
    }
    const session = readSummarySession();
    if (session) saveSummarySession({ ...session, open: view === 'summary' });
  }, [view, readSummarySession, saveSummarySession, saveActiveView]);

  // Robust reload recovery: poll for in-progress summaries without immediately throwing errors
  useEffect(() => {
    const session = initialSummaryState.session;
    if (!session || initialSummaryState.selected || !session.meetingId) return;
    let cancelled = false;
    const controller = new AbortController();
    const generation = ++summaryGeneration.current;
    let pollTimer: ReturnType<typeof setTimeout>;

    const poll = async (attempt = 0) => {
      if (cancelled || generation !== summaryGeneration.current) return;
      try {
        const data = await apiRequest<{
          summary: MeetingSummary | null;
          transcripts: TranscriptEntry[];
          isSummarizing?: boolean;
        }>(meetingPath(session.meetingId, 'transcript'), {
          headers: session.token ? { Authorization: 'Bearer ' + session.token } : {},
          signal: controller.signal,
        });

        if (cancelled || generation !== summaryGeneration.current) return;

        if (validSummary(data.summary)) {
          setSummary(data.summary);
          setTranscripts(data.transcripts);
          setIsSummarizing(false);
          setSummaryError(null);
          const record: SummaryRecord = {
            meetingId: session.meetingId,
            roomName: session.roomName,
            savedAt: data.summary.generatedAt || new Date().toISOString(),
            summary: data.summary,
            transcripts: data.transcripts,
          };
          const next = upsertSummary(readSummaryHistory(), record);
          setSummaryHistory(next);
          saveSummaryHistory(next);
          removeInProgressSummary(session.meetingId);
          setInProgressList(readInProgressSummaries());
          return;
        }

        // Trigger summarize if first attempt and token exists
        if (attempt === 0 && session.token) {
          apiRequest<{ summary: MeetingSummary }>(
            meetingPath(session.meetingId, 'summarize'),
            {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
              body: '{}',
              signal: controller.signal,
            },
            125000
          ).then(res => {
            if (cancelled || generation !== summaryGeneration.current) return;
            if (validSummary(res.summary)) {
              setSummary(res.summary);
              setTranscripts(data.transcripts.length ? data.transcripts : session.transcripts);
              setIsSummarizing(false);
              setSummaryError(null);
              const record: SummaryRecord = {
                meetingId: session.meetingId,
                roomName: session.roomName,
                savedAt: res.summary.generatedAt || new Date().toISOString(),
                summary: res.summary,
                transcripts: data.transcripts.length ? data.transcripts : session.transcripts,
              };
              const next = upsertSummary(readSummaryHistory(), record);
              setSummaryHistory(next);
              saveSummaryHistory(next);
              removeInProgressSummary(session.meetingId);
              setInProgressList(readInProgressSummaries());
            }
          }).catch(err => {
            if (cancelled || generation !== summaryGeneration.current) return;
            console.warn('Summarize re-trigger note:', err);
          });
        }

        if (attempt < 30) {
          pollTimer = setTimeout(() => void poll(attempt + 1), 3000);
        } else {
          setSummaryError('Waktu proses notulen melebihi batas. Silakan coba buat notulen lagi.');
          setIsSummarizing(false);
        }
      } catch (error) {
        if (cancelled || generation !== summaryGeneration.current) return;
        if (attempt < 5) {
          pollTimer = setTimeout(() => void poll(attempt + 1), 3000);
        } else {
          setSummaryError(error instanceof Error ? error.message : 'Gagal memulihkan proses notulen.');
          setIsSummarizing(false);
        }
      }
    };

    void poll(0);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(pollTimer);
    };
  }, [initialSummaryState, readSummaryHistory, removeInProgressSummary, saveSummaryHistory, readInProgressSummaries]);

  const openSavedSummary = (record: SummaryRecord) => {
    summaryGeneration.current++;
    setIsSummarizing(false);
    setSummaryError(null);
    setCopied(false);
    setSummary(record.summary);
    setTranscripts(record.transcripts);
    setSummaryMeetingId(record.meetingId);
    setSummaryRoomName(record.roomName);
    setSummaryHasRecording(Boolean(record.hasRecording));
    const savedToken = summaryTokenFor(record.meetingId);
    setSummaryToken(savedToken);
    saveSummarySession({
      meetingId: record.meetingId,
      roomName: record.roomName,
      token: savedToken,
      transcripts: record.transcripts,
      open: true,
      isSummarizing: false,
    });
    saveActiveView('summary');
    navigateTo({ view: 'summary', meetingId: record.meetingId });

    // If record lacks transcripts, load from DB
    if (!record.transcripts || record.transcripts.length === 0) {
      apiRequest<{ success: boolean; transcripts: TranscriptEntry[]; hasRecording?: boolean }>(`/meetings/db-details/${encodeURIComponent(record.meetingId)}`)
        .then(details => {
          if (details?.transcripts && details.transcripts.length > 0) {
            setTranscripts(details.transcripts);
          }
          if (details?.hasRecording) {
            setSummaryHasRecording(true);
          }
        })
        .catch(() => {});
    }
  };

  const openInProgressSummary = (record: InProgressRecord) => {
    summaryGeneration.current++;
    setIsSummarizing(true);
    setSummary(null);
    setSummaryError(null);
    setSummaryMeetingId(record.meetingId);
    setSummaryRoomName(record.roomName);
    const savedToken = record.token || summaryTokenFor(record.meetingId);
    setSummaryToken(savedToken);
    setTranscripts(record.transcripts);
    saveSummarySession({
      meetingId: record.meetingId,
      roomName: record.roomName,
      token: savedToken,
      transcripts: record.transcripts,
      open: true,
      isSummarizing: true,
    });
    saveActiveView('summary');
    navigateTo({ view: 'summary', meetingId: record.meetingId });
    void triggerSummarize(record.meetingId, savedToken, record.roomName, record.transcripts);
  };

  const healthStatus = useBackendHealth();
  const backendHealth = healthStatus.health;
  const healthChecked = healthStatus.checked;

  useEffect(() => {
    let cancelled = false;
    if (!isGuest) apiRequest<{ employees?: { employee_id: string; name: string; department: string }[] }>('/employees', {}, 5000)
      .then(data => {
        if (!cancelled && data?.employees && data.employees.length > 0) {
          setPersonas(data.employees.map(employee => ({ id: employee.employee_id, name: employee.name, dept: employee.department })));
        }
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [isGuest]);

  const fetchDbSummaries = useCallback(async () => {
    try {
      setIsLoadingDb(true);
      const data = await apiRequest<{ success: boolean; summaries: any[]; inProgress?: any[] }>('/meetings/db-summaries', {}, 5000);
      if (data?.summaries && Array.isArray(data.summaries)) {
        const dbRecords = data.summaries.map(normalizeDbSummary);
        setSummaryHistory(prev => {
          let merged = [...prev];
          for (const rec of dbRecords) {
            merged = upsertSummary(merged, rec);
          }
          saveSummaryHistory(merged);
          return merged;
        });
        setHistoryNotice('Arsip notulen berhasil disinkronkan dengan server.');
        setTimeout(() => setHistoryNotice(null), 3500);
      }
    } catch (err) {
      console.warn('DB summaries fetch note:', err);
      setHistoryNotice('Menggunakan arsip notulen lokal (database standby).');
      setTimeout(() => setHistoryNotice(null), 3500);
    } finally {
      setIsLoadingDb(false);
    }
  }, [saveSummaryHistory]);

  useEffect(() => {
    if (!isGuest) void fetchDbSummaries();
  }, [fetchDbSummaries, isGuest]);

  useEffect(() => {
    if (view !== 'in-call' || !meetingStartTime) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
      setCallDuration(String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0'));
    }, 1000);
    return () => clearInterval(interval);
  }, [view, meetingStartTime]);


  useEffect(() => {
    if (!pendingSaves) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingSaves]);

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

  const applyPostMeetingBatch = useCallback((job: PostMeetingBatchJob) => {
    if (!summaryMeetingId || !validSummary(job.summary) || !job.transcripts?.length) return;
    summaryGeneration.current++;
    setSummary(job.summary);
    setTranscripts(job.transcripts);
    setIsSummarizing(false);
    setSummaryError(null);
    setSummaryHasRecording(true);
    const previous = readSummaryHistory().find(record => record.meetingId === summaryMeetingId);
    const record: SummaryRecord = {...previous, meetingId:summaryMeetingId, roomName:summaryRoomName, hasRecording:true,
      summary:job.summary, transcripts:job.transcripts, savedAt:job.summary.generatedAt || new Date().toISOString()};
    const next = upsertSummary(readSummaryHistory(), record);
    setSummaryHistory(next); saveSummaryHistory(next);
    removeInProgressSummary(summaryMeetingId);
    setInProgressList(readInProgressSummaries());
  }, [summaryMeetingId, summaryRoomName, readSummaryHistory, saveSummaryHistory, removeInProgressSummary, readInProgressSummaries]);
  const postMeetingBatchState = usePostMeetingBatch({meetingId:summaryMeetingId, token:summaryToken,
    enabled:view === 'summary', onResult:applyPostMeetingBatch});

  const handleCancelSchedule = async (id: string) => {
    await apiRequest<{ success: boolean }>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  const handleReschedule = async (id: string, updateData: {
    scheduledStart: string;
    scheduledEnd: string;
    title?: string;
    description?: string;
    roomName?: string;
  }) => {
    const data = await apiRequest<{ success: boolean; schedule: ScheduledMeeting }>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    });
    if (data.schedule) {
      setSchedules(prev => prev.map(s => s.id === id ? data.schedule : s).sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)));
    }
  };

  const handleJoinScheduledRoom = (scheduledRoomName: string) => {
    setRoomName(scheduledRoomName);
    openLobby('join');
  };

  const openSchedule = () => {
    joinGeneration.current++; joinPending.current = false; setIsJoining(false); preJoinMedia.stopAll();
    saveActiveView('schedule');
    navigateTo({ view: 'schedule' });
  };

  const handleJoin = async () => {
    if (joinPending.current) return;
    const userDept = department.trim() || 'General';
    if (!employeeId.trim() || !employeeName.trim() || !roomName.trim()) {
      setJoinError('Lengkapi identitas dan nama ruang.'); return;
    }
    const cleanId = employeeId.trim();

    // DISABLED ID FORMAT CHECK (saved for future re-enabling):
    /*
    if (!isGuest && !/^BT-\d{4,6}$/i.test(cleanId)) {
      setJoinError('Format ID Salah.');
      return;
    }
    */

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
        body: JSON.stringify({ roomName: roomName.trim(), employeeId: cleanId, employeeName: employeeName.trim(), department: userDept }),
      });
      if (generation !== joinGeneration.current) return;
      endingMeeting.current = false;
      summaryGeneration.current++;
      // Old summary work must not pause ASR or lock controls in the new room.
      setIsSummarizing(false);
      setBatchDiarizing(false);
      setCallPreferences({
        ...userPreferences.preferences,
        sharedRoomMic: mediaChoices.sharedRoomMic ?? userPreferences.preferences.sharedRoomMic ?? false,
        liveDiarization: mediaChoices.liveDiarization ?? userPreferences.preferences.liveDiarization ?? true,
        batchDiarization: mediaChoices.batchDiarization ?? userPreferences.preferences.batchDiarization ?? true,
      });
      setJoinMedia(mediaChoices);
      transcriptDelivery.beginMeeting(data.meetingId);
      const recommended = getRecommendedProvider(backendHealth?.sttConfigured || false);
      const defaultProvider = userPreferences.preferences.transcriptionProvider === 'auto' ? recommended : data.sttProvider;
      setToken(data.token); setMeetingId(data.meetingId); setServerUrl(data.url); setSttProvider(resolveTranscriptionPreferences(userPreferences.preferences, backendHealth?.sttConfigured || false, backendHealth?.sttModels || [], backendHealth?.sttModel || '', defaultProvider).provider);
      setTranscripts([]); setCallDuration('00:00'); setMeetingStartTime(Date.now()); setRecordingError(null); setIsRecording(false);
      setGuestInviteCode('');
      setSummary(null); setSummaryError(null); setSummaryMeetingId(null); setSummaryToken(null); setSummaryRoomName('');
      navigateTo({ view: 'in-call', meetingId: data.meetingId });
    } catch (error) { if (generation === joinGeneration.current) setJoinError(error instanceof Error ? error.message : 'Gagal bergabung'); }
    finally { if (generation === joinGeneration.current) { joinPending.current = false; setIsJoining(false); } }
  };

  const triggerSummarize = async (
    targetMeetingId: string,
    targetToken: string,
    targetRoomName: string,
    fallbackTranscripts: TranscriptEntry[],
    leavePromise?: Promise<{ status: string } | void>,
    batchDiarize: boolean = false
  ) => {
    const generation = ++summaryGeneration.current;
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const left = leavePromise ? await leavePromise : null;
      const data = await apiRequest<{ summary: MeetingSummary; meetingStatus?: string; transcripts?: TranscriptEntry[] }>(
        meetingPath(targetMeetingId, `summarize${batchDiarize ? '?batchDiarize=true' : ''}`),
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchDiarize }),
        },
        180000
      );
      if (generation !== summaryGeneration.current) return;
      const resultTranscripts = data.transcripts?.length ? data.transcripts : fallbackTranscripts;
      if (data.transcripts?.length) {
        setTranscripts(data.transcripts);
      }
      setLastMeeting({
        title: data.summary.title,
        roomName: targetRoomName,
        endedAt: data.summary.generatedAt || new Date().toISOString(),
        transcriptCount: data.summary.transcriptCount || resultTranscripts.length,
      });
      const isOtherActive = left && typeof left === 'object' && 'status' in left && left.status === 'active';
      const completedSummary =
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
          : data.summary;
      setSummary(completedSummary);
      removeInProgressSummary(targetMeetingId);
      setInProgressList(readInProgressSummaries());
      const hadRecording = Boolean((data as any).hasRecording || isRecording);
      setSummaryHasRecording(hadRecording);
      const record: SummaryRecord = {
        meetingId: targetMeetingId,
        roomName: targetRoomName,
        savedAt: data.summary.generatedAt || new Date().toISOString(),
        summary: completedSummary,
        transcripts: resultTranscripts,
        hostId: employeeId,
        hostName: employeeName,
        department,
        hasRecording: hadRecording,
        ...((data as any).recordingSize ? { recordingSize: (data as any).recordingSize } : {}),
      };
      if (callPreferences.saveSummaryOffline !== false) {
        const next = upsertSummary(readSummaryHistory(), record);
        setSummaryHistory(next);
        if (!saveSummaryHistory(next)) setHistoryNotice('Riwayat belum tersimpan di browser. Unduh atau salin notulen sebelum menutup tab.');
      }
      if (callPreferences.autoCopySummary) {
        try {
          const md = `# Notulen BaliTower Sentra: ${completedSummary.title}\n**Tanggal:** ${new Date(completedSummary.generatedAt || Date.now()).toLocaleDateString('id-ID')} | **Ruang:** ${targetRoomName}\n**Peserta:** ${completedSummary.attendanceSummary?.join(', ') || 'Belum tercatat'}\n**Layanan ringkasan:** ${completedSummary.provider || 'Tidak diketahui'}\n\n---\n### Ringkasan\n${completedSummary.executiveSummary}\n\n### Poin Pembahasan\n${completedSummary.keyDiscussionPoints.map(p => `- ${p}`).join('\n')}\n\n### Keputusan\n${completedSummary.decisions.map(d => `- ${d}`).join('\n')}\n\n### Tindak Lanjut\n${completedSummary.actionItems.map(a => `- [${a.priority}] ${a.task} (@${a.assignee}) - Batas: ${a.deadline}`).join('\n')}`;
          void navigator.clipboard?.writeText(md);
        } catch {
          // ignore clipboard write failure
        }
      }
    } catch (error) {
      if (generation !== summaryGeneration.current) return;
      const rawMessage = error instanceof Error ? error.message : '';
      const message = rawMessage.includes('No saved speech to summarize')
        ? 'Belum ada rekaman percakapan untuk dibuat notulen. Silakan berbicara terlebih dahulu saat rapat.'
        : rawMessage || 'Gagal membuat notulen AI. Silakan coba lagi.';
      setSummaryError(message);
    } finally {
      if (generation === summaryGeneration.current) setIsSummarizing(false);
    }
  };

  const handleEndMeeting = async (generate = true) => {
    if (isGuest) generate = false;
    if (!meetingId || !token || endingMeeting.current) return;
    endingMeeting.current = true;
    const currentMeetingId = meetingId;
    const currentToken = token;
    const currentRoomName = roomName;
    const capturedTranscripts = [...transcripts];

    // 1. Terminate call media session immediately (turns off microphone, camera, and screen share)
    setToken(null);
    setMeetingStartTime(null);
    setCallDuration('00:00');
    setRecordingPending(false);
    setRecordingError(null);
    setIsRecording(false);

    if (!generate) {
      setMeetingId(null);
      setTranscripts([]);
      saveActiveView('home');
      navigateTo({ view: isGuest ? 'lobby' : 'home', intent: isGuest ? 'join' : undefined });
      void (async () => {
        try { await saveQueue.flush(); } catch (err) { console.warn('Background flush note:', err); }
        const leaveData = await apiRequest<{ status?: string }>(meetingPath(currentMeetingId, 'leave'), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(err => {
          console.warn('Leave request note:', err);
          return { status: 'ended' };
        });
        endingMeeting.current = false;
        if (!isGuest && leaveData?.status === 'ended' && currentRouteRef.current.view === 'home') {
          openInProgressSummary({
            meetingId: currentMeetingId,
            roomName: currentRoomName,
            token: currentToken,
            transcripts: capturedTranscripts,
            startedAt: new Date().toISOString(),
            hostId: employeeId,
            hostName: employeeName,
            department,
          });
        }
      })();
      return;
    }

    // 2. Immediately transition to summary view with loading card
    const inProgressRecord: InProgressRecord = {
      meetingId: currentMeetingId,
      roomName: currentRoomName,
      token: currentToken,
      transcripts: capturedTranscripts,
      startedAt: new Date().toISOString(),
      hostId: employeeId,
      hostName: employeeName,
      department,
    };
    saveInProgressSummary(inProgressRecord);
    setInProgressList(readInProgressSummaries());

    if (!saveSummarySession({
      meetingId: currentMeetingId,
      roomName: currentRoomName,
      token: currentToken,
      transcripts: capturedTranscripts,
      open: true,
      isSummarizing: true,
    })) {
      setHistoryNotice('Browser memblokir penyimpanan sesi. Refresh belum dapat memulihkan halaman ini.');
    }
    saveActiveView('summary');
    navigateTo({ view: 'summary', meetingId: currentMeetingId });
    setIsSummarizing(true);
    setSummary(null);
    setSummaryError(null);
    setSummaryMeetingId(currentMeetingId);
    setSummaryToken(currentToken);
    setSummaryRoomName(currentRoomName);

    // 3. In background: process any queued audio transcripts from Whisper first, then notify leave, then summarize!
    void (async () => {
      try {
        await saveQueue.flush();
      } catch (flushErr) {
        console.warn('Background transcript flush warning:', flushErr);
      }

      // Fetch the latest finalized transcripts from server
      let finalTranscripts = capturedTranscripts;
      try {
        const transcriptData = await apiRequest<{ transcripts: TranscriptEntry[] }>(
          meetingPath(currentMeetingId, 'transcript'),
          { headers: { Authorization: 'Bearer ' + currentToken } }
        );
        if (transcriptData?.transcripts) {
          finalTranscripts = transcriptData.transcripts;
          setTranscripts(finalTranscripts);
        }
      } catch {
        // Fallback to capturedTranscripts
      }

      // Notify backend of leave in background
      const leavePromise = apiRequest<{ status: string }>(meetingPath(currentMeetingId, 'leave'), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(err => {
        console.warn('Leave request note:', err);
        return { status: 'ended' };
      });

      // Update in-progress record with all finalized transcripts
      const updatedRecord: InProgressRecord = {
        meetingId: currentMeetingId,
        roomName: currentRoomName,
        token: currentToken,
        transcripts: finalTranscripts,
        startedAt: inProgressRecord.startedAt,
        hostId: employeeId,
        hostName: employeeName,
        department,
      };
      saveInProgressSummary(updatedRecord);
      setInProgressList(readInProgressSummaries());
      saveSummarySession({
        meetingId: currentMeetingId,
        roomName: currentRoomName,
        token: currentToken,
        transcripts: finalTranscripts,
        open: true,
        isSummarizing: true,
      });

      // 4. Request summary in the background with complete transcripts
      const isSharedMic = Boolean(callPreferences.sharedRoomMic || joinMedia.sharedRoomMic);
      const useBatchDiarize = !callPreferences.transcriptionModel.startsWith('qwen3-asr-') && isSharedMic && (callPreferences.batchDiarization ?? joinMedia.batchDiarization ?? true);
      try {
        await triggerSummarize(currentMeetingId, currentToken, currentRoomName, finalTranscripts, leavePromise, useBatchDiarize);
      } finally {
        endingMeeting.current = false;
      }
    })();
  };

  useEffect(() => {
    handleEndMeetingRef.current = handleEndMeeting;
  });

  const handleRetrySummarize = () => {
    if (summaryMeetingId && summaryToken) {
      void triggerSummarize(summaryMeetingId, summaryToken, summaryRoomName || roomName, transcripts);
    } else {
      setSummaryError('Sesi akses rapat sudah tidak tersedia. Hasil yang tersimpan masih dapat dibaca dan disalin dari riwayat.');
    }
  };

  const handleBatchDiarize = async () => {
    const targetMeetingId = summaryMeetingId || meetingId;
    const targetToken = summaryToken || token;
    if (!targetMeetingId || !targetToken || batchDiarizing) return;
    setBatchDiarizing(true);
    setSummaryError(null);
    try {
      const generation = joinGeneration.current;
      type BatchJob = { status: string; error?: string; transcripts?: TranscriptEntry[] };
      const path = meetingPath(targetMeetingId, 'post-meeting-batch');
      const headers = { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' };
      let { job } = await apiRequest<{ job: BatchJob }>(path, {
        method: 'POST', headers, body: JSON.stringify({ language: callPreferences.speechLanguage === 'en-US' ? 'en' : 'id' }),
      });
      const deadline = Date.now() + 4 * 60 * 60 * 1000;
      while (job.status !== 'done') {
        if (generation !== joinGeneration.current) return;
        if (job.status === 'failed') throw new Error(job.error || 'Batch gagal. Transkrip live tetap tersedia.');
        if (Date.now() > deadline) throw new Error('Pemrosesan masih berlangsung. Buka kembali hasil rapat untuk memeriksa status.');
        await new Promise(resolve => setTimeout(resolve, 3000));
        ({ job } = await apiRequest<{ job: BatchJob }>(path, { headers }));
        if (!job) throw new Error('Status batch tidak ditemukan.');
      }
      if (generation === joinGeneration.current && job.transcripts?.length) {
        setTranscripts(job.transcripts);
        await triggerSummarize(targetMeetingId, targetToken, summaryRoomName || roomName, job.transcripts);
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Gagal melakukan batch diarization.');
    } finally {
      setBatchDiarizing(false);
    }
  };

  const handleUploadAudioBatch = async (file: File) => {
    if (batchDiarizing || isSummarizing) return;
    setBatchDiarizing(true);
    setIsSummarizing(true);
    setSummary(null);
    setSummaryError(null);
    saveActiveView('summary');
    navigateTo({ view: 'summary' });
    const formData = new FormData();
    formData.append('audio', file);
    try {
      const res = await fetch(`${API_BASE}/audio/batch-diarize`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Upload gagal (${res.status})`);
      }
      const data = await res.json();
      if (data.transcripts?.length) {
        setTranscripts(data.transcripts);
      }
      if (data.meetingId) {
        setSummaryMeetingId(data.meetingId);
        navigateTo({ view: 'summary', meetingId: data.meetingId }, true);
      }
      if (data.token) {
        setSummaryToken(data.token);
      }
      setSummaryRoomName(data.roomName || file.name);
      if (data.summary) {
        setSummary(data.summary);
        const record: SummaryRecord = {
          meetingId: data.meetingId || `batch-${Date.now()}`,
          roomName: data.roomName || file.name,
          savedAt: data.summary.generatedAt || new Date().toISOString(),
          summary: data.summary,
          transcripts: data.transcripts || [],
          hostId: employeeId,
          hostName: employeeName,
          department,
        };
        const next = upsertSummary(readSummaryHistory(), record);
        setSummaryHistory(next);
        saveSummaryHistory(next);
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Gagal memproses file audio batch.');
    } finally {
      setBatchDiarizing(false);
      setIsSummarizing(false);
    }
  };

  const handleRenameSpeaker = async (change: SpeakerNameChange) => {
    const targetMeeting=meetingId,targetToken=token;
    if (!targetMeeting || !targetToken) throw new Error('Akses rapat tidak tersedia.');
    const data=await apiRequest<{updatedEntries:TranscriptEntry[]}>(meetingPath(targetMeeting,'speaker-name'),{
      method:'POST',headers:{Authorization:'Bearer '+targetToken,'Content-Type':'application/json'},body:JSON.stringify(change),
    });
    for (const entry of data.updatedEntries) transcriptDelivery.saved({meetingId:targetMeeting,entry});
  };

  const handleAddSpeechLine = (value: LiveFinal, model = 'qwen3-asr-0.6b-live') => {
    const text = typeof value === 'string' ? value : value.text;
    if (!text.trim() || !meetingId || !token) return;
    const path = meetingPath(meetingId, 'transcript');
    saveQueue.enqueue(requestId => apiRequest<{ entry: TranscriptEntry | null }>(path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(liveTranscriptBody(value, model, requestId)),
    }).then(result => ({ ...result, meetingId })));
  };

  const manageParticipant = async (
    participantId: string,
    action: 'promote' | 'demote' | 'mute' | 'remove' | 'approve-speak'
  ) => {
    if (!meetingId || !token) return;

    const participantPath = meetingPath(
      meetingId,
      `participants/${encodeURIComponent(participantId)}`
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (action === 'promote' || action === 'demote') {
      headers['Content-Type'] = 'application/json';

      await apiRequest(`${participantPath}/role`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          role: action === 'promote' ? 'co-host' : 'participant',
        }),
      });
    } else if (action === 'mute') {
      headers['Content-Type'] = 'application/json';

      await apiRequest(`${participantPath}/mute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
    } else if (action === 'approve-speak') {
      await apiRequest(
        `${participantPath}/approve-speak`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }); 
    } else {
      await apiRequest(participantPath, {
        method: 'DELETE',
        headers,
      });
    }
  };

  const requestToSpeak = async () => {
    if (!meetingId || !token || speakRequestPending) return;

    setSpeakRequestPending(true);

    try {
      await apiRequest(
        meetingPath(meetingId, 'request-to-speak'),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    } catch (error) {
      setCallError(
        error instanceof Error
          ? error.message
          : 'Permintaan izin bicara gagal dikirim.'
      );
    } finally {
      setSpeakRequestPending(false);
    }
  };

  const handleCreateLiveSession = (language: string, model = 'whisperlivekit-small', diarize = false, streamId?: string) => {
    if (!meetingId || !token) return Promise.reject(new Error('Akses rapat tidak tersedia.'));
    return apiRequest<{ url: string }>(meetingPath(meetingId, 'live-session'), {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, diarize, language: language.split('-')[0], ...(streamId?{streamId}:{}) }),
    });
  };

  const handleAddAudio = (audio: Blob, language: string, model?: string) => {
    if (!meetingId || !token) return;
    const path = meetingPath(meetingId, 'audio');
    const isSharedMic = supportsSharedMicrophone(model || backendHealth?.sttModel, qwenDiarizationForModel(model || backendHealth?.sttModel, backendHealth)) && Boolean(callPreferences.sharedRoomMic || joinMedia.sharedRoomMic);
    const useLiveDiarize = isSharedMic && (callPreferences.liveDiarization ?? joinMedia.liveDiarization ?? true);
    saveQueue.enqueue(requestId => apiRequest<{ entry: TranscriptEntry | null }>(path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': audio.type,
        'X-Request-Id': requestId, 'X-Speech-Language': language.split('-')[0], ...(model ? { 'X-Speech-Model': model } : {}),
        'X-Speech-Diarize': useLiveDiarize ? 'true' : 'false' }, body: audio,
    }, 125000).then(result => ({ ...result, meetingId })));
  };

  const handlePresence = async (connected: boolean) => {
    if (!meetingId || !token || endingMeeting.current) return;
    const generation = joinGeneration.current;
    try { await apiRequest(meetingPath(meetingId, 'presence'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ connected }),
    }, 5000); } catch { if (connected && !endingMeeting.current && generation === joinGeneration.current) setSyncError('Kehadiran belum tersinkron. Periksa koneksi layanan.'); }
  };
  const handleToggleRecording = async (enabled: boolean, postMeetingBatch = false) => {
    if (!meetingId || !token || recordingPending) return;
    const generation = joinGeneration.current;
    setRecordingPending(true); setRecordingError(null);
    try {
      const action = enabled ? 'start' : 'stop';
      const data = await apiRequest<{ success: boolean; recording?: { status: string } }>(meetingPath(meetingId, `recording/${action}`), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ postMeetingBatch, language: callPreferences.speechLanguage === 'en-US' ? 'en' : 'id' }),
      }, 15000);
      if (generation === joinGeneration.current) {
        setIsRecording(data?.recording?.status === 'active');
      }
    } catch (error) {
      if (generation === joinGeneration.current) setRecordingError(featureError(enabled?'Memulai rekaman':'Menghentikan rekaman',error));
    } finally {
      if (generation === joinGeneration.current) setRecordingPending(false);
    }
  };

  const handleToggleSharedMic = useCallback((enabled: boolean) => {
    setCallPreferences(prev => ({ ...prev, sharedRoomMic: enabled }));
    setJoinMedia(prev => ({ ...prev, sharedRoomMic: enabled }));
  }, []);

  const handleToggleLiveDiarization = useCallback((enabled: boolean) => {
    setCallPreferences(prev => ({ ...prev, liveDiarization: enabled }));
    setJoinMedia(prev => ({ ...prev, liveDiarization: enabled }));
  }, []);

  const handleToggleBatchDiarization = useCallback((enabled: boolean) => {
    setCallPreferences(prev => ({ ...prev, batchDiarization: enabled }));
    setJoinMedia(prev => ({ ...prev, batchDiarization: enabled }));
  }, []);

  const copyMarkdownSummary = () => {
    if (!summary) return;
    const md = `
# Notulen BaliTower Sentra: ${summary.title}
**Tanggal:** ${new Date(summary?.generatedAt || Date.now()).toLocaleDateString('id-ID')} | **Ruang:** ${summaryRoomName || roomName}
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
| No | Tugas | PIC / Penanggung jawab | Prioritas | Tenggat / Syarat |
| --- | --- | --- | --- | --- |
${summary.actionItems?.map((a, idx) => `| ${idx + 1} | ${a.task} | ${a.assignee || 'Belum ditentukan'} | ${a.priority} | ${a.deadline || '-'} |`).join('\n')}

---
*Dibuat oleh BaliTower Sentra Meeting*
    `.trim();

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCallError('Tidak dapat menyalin ringkasan. Periksa izin clipboard browser.'));
  };

  const openLobby = (intent: 'create' | 'join', preferences = userPreferences.preferences) => {
    joinGeneration.current++; joinPending.current = false; setIsJoining(false);
    preJoinMedia.resetLobby();
    preJoinMedia.applyChoices(mediaChoices(preferences, qwenDiarizationForModel(preferences.transcriptionModel, backendHealth)));
    setMeetingIntent(isGuest ? 'join' : intent);
    setJoinError(null);
    navigateTo({ view: 'lobby', intent: isGuest ? 'join' : intent });
  };

  return (
    <div className={`app-root ${view === 'in-call' ? 'in-call-layout' : ''} ${userPreferences.preferences.reduceMotion ? 'reduce-motion' : ''}`}>
      <a className="skip-link" href="#main-content">Lewati navigasi ke konten</a>
      {view !== 'in-call' && (
        <WorkspaceSidebar
          isGuest={isGuest} authUser={authUser}
          view={view}
          intent={meetingIntent}
          employeeName={employeeName}
          hasSummary={summaryHistory.length > 0 || inProgressList.length > 0 || Boolean(summary) || isSummarizing || Boolean(summaryError)}
          onHome={() => {
            saveActiveView('home');
            navigateTo({ view: 'home' });
          }}
          onCreate={() => openLobby('create')}
          onJoin={() => openLobby('join')}
          onSchedule={openSchedule}
          onSettings={() => {
            saveActiveView('settings');
            navigateTo({ view: 'settings', section: 'overview' });
          }}
          onDocumentation={() => {
            saveActiveView('documentation');
            navigateTo({ view: 'documentation' });
          }}
          onSummary={() => {
            saveActiveView('summary');
            navigateTo({ view: 'summary', meetingId: null });
            if (!summary && !isSummarizing) {
              setSummaryMeetingId(null);
            }
          }}
        />
      )}
      <div className="workspace-body">
      <header className={`app-header ${view === 'in-call' ? 'app-header-call' : ''}`}>
        {view === 'in-call' ? (
          <div className="call-brand"><BrandLogo inverse /><span>Bali Tower Sentra</span></div>
        ) : (
          <div className="page-identity">
            <span>Workspace / {view === 'home' ? 'Beranda' : view === 'lobby' ? 'Ruang rapat' : view === 'schedule' ? 'Jadwalkan rapat' : view === 'settings' ?'Pengaturan' : view === 'documentation' ? 'Dokumentasi' : view === 'recordings' ? 'Rekaman' : 'Notulen'}</span>
            <strong>Internal Meeting & AI Minutes</strong>
          </div>
        )}

        <div className="header-meta">
          {authUser&&!isGuest&&<NotificationCenter onJoin={room=>{if(view==='in-call'){setCallError('Keluar dari rapat aktif sebelum membuka undangan lain.');return;}setRoomName(room);openLobby('join');}} onSummary={()=>{if(view==='in-call'){setCallError('Buka notulen setelah keluar dari rapat aktif.');return;}void fetchDbSummaries();navigateTo({ view: 'summary', meetingId: null });}}/>}
          {authUser&&!isGuest&&view==='in-call'&&meetingId&&token&&<EmployeeInvites meetingId={meetingId} token={token}/>}
          {view === 'in-call' && authUser && !isGuest && <button className="button-secondary" type="button" onClick={() => {
            void apiRequest<{inviteCode:string}>(meetingPath(meetingId!, 'guest-invite'), {method:'POST',headers:{Authorization:'Bearer '+token}})
              .then(data => setGuestInviteCode(data.inviteCode)).catch(error => setCallError(featureError('Membuat undangan tamu',error)));
          }}>Undang tamu</button>}
          {isGuest && <span className="service-status">Akses tamu</span>}
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
          {view !== 'in-call' && <button type="button" className="header-account-logout" disabled={logoutPending || !onLogout} onClick={() => void onLogout?.()} title={!onLogout ? 'Mode tanpa login: tidak ada sesi akun untuk dikeluarkan' : 'Keluar dari akun BaliCall'} aria-label="Keluar akun" aria-busy={logoutPending}>
            {logoutPending ? <Loader2 className="ui-spinner" size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}<span>{logoutPending ? 'Keluar…' : 'Keluar akun'}</span>
          </button>}
          <span className="user-avatar" title={employeeName || 'Bali Tower Sentra'}>{authUser&&!isGuest?<UserAvatar user={authUser}/>:initials(employeeName)}</span>
        </div>
      </header>
      {view === 'in-call' && guestInviteCode && <div className="guest-invite-strip" role="status"><label>Kode undangan tamu <input readOnly value={guestInviteCode} onFocus={event=>event.currentTarget.select()} /></label><button className="button-secondary" type="button" onClick={()=>void navigator.clipboard.writeText(guestInviteCode).catch(()=>setCallError('Salin kode undangan dari kolom di atas.'))}>Salin kode</button><button className="text-button" type="button" onClick={()=>setGuestInviteCode('')}>Tutup</button></div>}

      <ScheduleReminders schedules={schedules} enabled={userPreferences.preferences.scheduleReminders}
        available={scheduleFeed.available} failed={scheduleFeed.error} suppressed={view === 'in-call'}
        onOpenSchedule={openSchedule}
        onRetry={() => void scheduleFeed.refresh()} />

      {(callError || syncError || transcriptSaveError || pendingSaves > 0) && <div className="app-alert" role="status" aria-live="polite" aria-busy={pendingSaves > 0}>
        {pendingSaves > 0 && <Loader2 className="ui-spinner" size={15} aria-hidden="true" />}
        {callError && <span>{callError}</span>}
        {syncError && <span>Sinkronisasi rapat: {syncError}</span>}
        {transcriptSaveError && <span>Penyimpanan transkrip: {transcriptSaveError}</span>}
        {pendingSaves > 0 && <span>{pendingSaves} ucapan menunggu tersimpan.</span>}
        {transcriptSaveError && <button className="text-button" onClick={() => saveQueue.retry()}>Coba simpan lagi</button>}
      </div>}
      <main ref={contentRef} id="main-content" className="app-main" tabIndex={-1} aria-label={{home:'Beranda',lobby:meetingIntent === 'create'?'Buat rapat':'Gabung rapat','in-call':'Ruang rapat',summary:'Notulen rapat',schedule:'Jadwal rapat',settings:'Pengaturan',documentation:'Dokumentasi',recordings:'Rekaman terunggah'}[view]}>
        {view === 'home' && <HomeDashboard
          backendHealth={backendHealth}
          lastMeeting={lastMeeting}
          employeeName={employeeName}
          onCreate={() => openLobby('create')}
          onJoin={(code?: string) => { if (code) setRoomName(code); openLobby('join'); }}
          onSchedule={openSchedule}
          upcomingSchedules={schedules}
        />}
        {view === 'schedule' && (
          <ScheduleView
            schedules={schedules}
            employeeId={employeeId}
            employeeName={employeeName}
            department={department}
            onBack={() => {
              if (typeof window !== 'undefined' && window.history.state?.view && window.history.state.view !== 'schedule') {
                window.history.back();
              } else {
                navigateTo({ view: 'home' });
              }
            }}
            onCreateSchedule={handleCreateSchedule}
            onReschedule={handleReschedule}
            onCancelSchedule={handleCancelSchedule}
            onJoinRoom={handleJoinScheduledRoom}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            section={settingsSection}
            onSectionChange={nextSection => {
              if (nextSection === 'overview' && typeof window !== 'undefined' && window.history.state?.view === 'settings' && window.history.state?.section && window.history.state.section !== 'overview') {
                window.history.back();
              } else {
                navigateTo({ view: 'settings', section: nextSection });
              }
            }}
            aiStatus={healthStatus}
            transcription={backendHealth ? { configured: Boolean(backendHealth.sttConfigured), models: backendHealth.sttModels || [], defaultModel: backendHealth.sttModel || '' } : null}
            authUser={isGuest ? null : authUser}
            onProfileUpdated={user => { setEmployeeName(user.name); onProfileUpdated?.(user); }}
            preferences={userPreferences.preferences}
            notice={userPreferences.notice}
            employeeId={employeeId}
            employeeName={employeeName}
            department={department}
            onSave={userPreferences.save}
            onCheckDevices={next => openLobby('create', next)}
            onOpenRecordings={isGuest ? undefined : () => { saveActiveView('recordings'); navigateTo({ view: 'recordings' }); }}
            onLogout={onLogout}
            logoutPending={logoutPending}
          />
        )}
        {view === 'documentation' && <DocumentationPage />}

        {view === 'lobby' && (
          <LobbyView
            isGuest={isGuest}
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
            mediaPreview={<PreJoinPreview
              media={preJoinMedia}
              employeeName={employeeName}
              blocked={isJoining}
              mirror={userPreferences.preferences.mirrorLocalVideo}
              onToggleSharedMic={enabled => userPreferences.save({ ...userPreferences.preferences, sharedRoomMic: enabled })}
              onToggleLiveDiarization={enabled => userPreferences.save({ ...userPreferences.preferences, liveDiarization: enabled })}
              onToggleBatchDiarization={enabled => userPreferences.save({ ...userPreferences.preferences, batchDiarization: enabled })}
              transcriptionProvider={userPreferences.preferences.transcriptionProvider}
              onChangeTranscriptionProvider={provider => userPreferences.save({ ...userPreferences.preferences, transcriptionProvider: provider })}
              transcriptionModel={resolveTranscriptionPreferences(userPreferences.preferences, Boolean(backendHealth?.sttConfigured), backendHealth?.sttModels || [], backendHealth?.sttModel || '', 'server').model}
              onChangeTranscriptionModel={model => userPreferences.save({ ...userPreferences.preferences, ...modelPreferencePatch(model) })}
              sttConfigured={backendHealth?.sttConfigured ?? false}
              qwenDiarizationReady={qwenDiarizationForModel(userPreferences.preferences.transcriptionModel, backendHealth)}
              sttModels={backendHealth?.sttModels ?? []}
            />}
            // DISABLED IDENTITY LOCK (saved for future re-enabling):
            // identityLocked={Boolean(authUser)}
            identityLocked={false}
            personas={authUser ? [] : personas}
          />
        )}

        {view === 'summary' && postMeetingBatchState && <p role="status" className="settings-notice">
          {postMeetingBatchState.status === 'done' ? 'Batch audio Qwen + Nemotron selesai. Transkrip dan notulen batch tersimpan.'
            : postMeetingBatchState.status === 'waiting' ? 'Batch audio menunggu seluruh peserta keluar dan rekaman Egress selesai.'
            : postMeetingBatchState.status === 'failed' || postMeetingBatchState.status === 'timeout' ? `Batch audio belum berhasil: ${postMeetingBatchState.error || 'Coba kembali setelah layanan siap.'} Transkrip live tetap tersedia.`
            : postMeetingBatchState.status === 'reconnecting' ? 'Koneksi status batch terputus. Mencoba kembali; proses server tetap berjalan.'
            : postMeetingBatchState.status === 'summarizing' ? 'Qwen selesai mentranskripsi. AI sedang menyusun notulen batch audio.'
            : 'Qwen + Nemotron sedang memproses rekaman audio seluruh peserta.'}
        </p>}

        {view === 'in-call' && token && (
          <InCallView qwenBatchConfigured={backendHealth?.qwenBatchConfigured} callDuration={callDuration}
            meetingId={meetingId!} onTranscriptEntries={receiveTranscripts} onTranscriptSyncError={setSyncError} registerTranscriptPublisher={transcriptDelivery.register}
            meetingRole={meetingRole}
            meetingHostId={meetingHostId}
            meetingCoHostIds={meetingCoHostIds}
            onManageParticipant={manageParticipant}
            joinMedia={joinMedia}
            recordingPending={recordingPending}
            recordingError={recordingError}
            isRecording={isRecording}
            onToggleRecording={handleToggleRecording}
            onRecordingSync={(rec: { status: string } | null) => {
              if (rec?.status === 'active') setIsRecording(true);
              else if (rec?.status === 'stopped') setIsRecording(false);
            }}
            callPreferences={callPreferences}
            onSttModelChanged={(model: string) => setCallPreferences(prev => ({ ...prev, ...modelPreferencePatch(model) }))}
            qwenDiarizationReady={qwenDiarizationForModel(callPreferences.transcriptionModel, backendHealth)}
            onToggleSharedMic={handleToggleSharedMic}
            onToggleLiveDiarization={handleToggleLiveDiarization}
            onToggleBatchDiarization={handleToggleBatchDiarization}
            token={token}
            sttProvider={sttProvider}
            setSttProvider={setSttProvider}
            sttConfigured={backendHealth?.sttConfigured || false}
            sttModels={backendHealth?.sttModels || []}
            defaultSttModel={backendHealth?.sttModel || ''}
            pendingSaves={pendingSaves}
            saveBlocked={Boolean(transcriptSaveError)}
            onAddAudio={handleAddAudio} onCreateLiveSession={handleCreateLiveSession}
            onPresence={handlePresence}
            serverUrl={serverUrl}
            roomName={roomName}
            employeeId={employeeId}
            employeeName={employeeName}
            transcripts={transcripts}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onAddSpeechLine={handleAddSpeechLine}
            onRenameSpeaker={handleRenameSpeaker}
            onEndMeeting={handleEndMeeting}
            isSummarizing={isSummarizing}
            microphoneRestricted={microphoneRestricted}
            speakRequestPending={speakRequestPending}
            speakRequestAt={speakRequestAt}
            pendingSpeakRequests={pendingSpeakRequests}
            onRequestToSpeak={requestToSpeak}
          />
        )}
        
        {view === 'recordings' && !isGuest && (
          <RecordingUploadView
            recordingId={recordingId}
            onRecordingChange={recId => navigateTo({ view: 'recordings', recordingId: recId })}
            onBack={() => {
              if (typeof window !== 'undefined' && window.history.state?.view && window.history.state.view !== 'recordings') {
                window.history.back();
              } else {
                saveActiveView('summary');
                navigateTo({ view: 'summary', meetingId: null });
              }
            }}
          />
        )}

        {view === 'summary' && !summaryMeetingId && !isSummarizing && (
          <SummaryHistoryView
            summaryHistory={summaryHistory}
            inProgressList={inProgressList}
            employeeId={employeeId}
            employeeName={employeeName}
            department={department}
            onSelectSummary={openSavedSummary}
            onSelectInProgress={openInProgressSummary}
            onBackToHome={() => {
              if (typeof window !== 'undefined' && window.history.state?.view && window.history.state.view !== 'summary') {
                window.history.back();
              } else {
                saveActiveView('home');
                navigateTo({ view: 'home' });
              }
            }}
            onRefreshData={fetchDbSummaries}
            isLoadingDb={isLoadingDb}
            notice={historyNotice}
            onUploadAudio={handleUploadAudioBatch}
            onOpenRecordings={isGuest ? undefined : () => { saveActiveView('recordings'); navigateTo({ view: 'recordings' }); }}
          />
        )}

        {view === 'summary' && (summaryMeetingId || isSummarizing) && (
          <SummaryView
            key={summaryMeetingId || 'active-summary'}
            summary={summary}
            roomName={summaryRoomName || roomName}
            meetingId={summaryMeetingId || meetingId || ''}
            token={summaryToken || token || ''}
            transcripts={transcripts}
            copied={copied}
            onCopy={copyMarkdownSummary}
            isSummarizing={isSummarizing}
            hasRecording={summaryHasRecording}
            batchDiarizing={batchDiarizing}
            onBatchDiarize={handleBatchDiarize}
            pendingSaves={pendingSaves}
            summaryError={summaryError}
            onRetry={handleRetrySummarize}
            onBackToHistory={() => {
              if (typeof window !== 'undefined' && window.history.state?.view === 'summary' && window.history.state?.meetingId) {
                window.history.back();
              } else {
                setSummaryMeetingId(null);
                setSummary(null);
                setIsSummarizing(false);
                setSummaryError(null);
                const session = readSummarySession();
                if (session) saveSummarySession({ ...session, meetingId: '', open: true });
                navigateTo({ view: 'summary', meetingId: null });
              }
            }}
            onNewCall={() => {
              summaryGeneration.current++;
              setIsSummarizing(false);
              setToken(null);
              setMeetingId(null);
              setCallError(null);
              setTranscripts([]);
              setSummary(null);
              setSummaryError(null);
              setSummaryMeetingId(null);
              setSummaryToken(null);
              setSummaryRoomName('');
              saveActiveView('home');
              navigateTo({ view: 'home' });
            }}
          />
        )}
      </main>
      </div>
    </div>
  );
}

function InCallView({ callDuration,
  qwenDiarizationReady, onSttModelChanged,
  meetingId, onTranscriptEntries, onTranscriptSyncError, registerTranscriptPublisher,
  sttModels, defaultSttModel, onCreateLiveSession,
  joinMedia, callPreferences,
  recordingPending, recordingError, isRecording, onToggleRecording, onRecordingSync, qwenBatchConfigured,
  sttProvider, setSttProvider, sttConfigured, saveBlocked, pendingSaves, onAddAudio, onPresence,
  microphoneRestricted, speakRequestPending, speakRequestAt, pendingSpeakRequests,
  onRequestToSpeak,
  token,
  serverUrl,
  roomName,
  employeeId,
  employeeName,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechLine,
  onRenameSpeaker,
  onEndMeeting,
  isSummarizing,
  meetingRole,
  meetingHostId,
  meetingCoHostIds,
  onManageParticipant,
  onToggleSharedMic,
  onToggleLiveDiarization,
  onToggleBatchDiarization,
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
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
    {connectionError && <div role="alert" style={{ padding: '12px', color: '#fca5a5' }}>{connectionError}</div>}
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      onError={onRoomError}
      onConnected={onConnected}
      audio={joinMedia.microphoneEnabled}
      options={mediaOptions}
      style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}
    >
      <RoomAudioRenderer />
      <TranscriptRealtimeBridge meetingId={meetingId} token={token} onEntries={onTranscriptEntries} onError={onTranscriptSyncError} onRecordingSync={onRecordingSync} register={registerTranscriptPublisher} />
      <RoomContent callDuration={callDuration}
        qwenDiarizationReady={qwenDiarizationReady} onSttModelChanged={onSttModelChanged}
        sttModels={sttModels} defaultSttModel={defaultSttModel} onCreateLiveSession={onCreateLiveSession}
        startWithCamera={joinMedia.cameraEnabled}
        qwenBatchConfigured={qwenBatchConfigured}
        recordingPending={recordingPending}
        recordingError={recordingError}
        isRecording={isRecording}
        onToggleRecording={onToggleRecording}
        callPreferences={callPreferences}
        onToggleSharedMic={onToggleSharedMic}
        onToggleLiveDiarization={onToggleLiveDiarization}
        onToggleBatchDiarization={onToggleBatchDiarization}
        sttProvider={sttProvider} setSttProvider={setSttProvider} sttConfigured={sttConfigured}
        pendingSaves={pendingSaves}
        saveBlocked={saveBlocked} onAddAudio={onAddAudio} onPresence={onPresence}
        roomName={roomName}
        employeeId={employeeId}
        employeeName={employeeName}
        transcripts={transcripts}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onAddSpeechLine={onAddSpeechLine} onRenameSpeaker={onRenameSpeaker}
        onEndMeeting={onEndMeeting}
        isSummarizing={isSummarizing}
        meetingRole={meetingRole}
        meetingHostId={meetingHostId}
        meetingCoHostIds={meetingCoHostIds}
        onManageParticipant={onManageParticipant}
        microphoneRestricted={microphoneRestricted}
        speakRequestPending={speakRequestPending}
        speakRequestAt={speakRequestAt}
        pendingSpeakRequests={pendingSpeakRequests}
        onRequestToSpeak={onRequestToSpeak}
      />
    </LiveKitRoom>
    </div>
  );
}

function RoomContent({
  qwenDiarizationReady, onSttModelChanged,
  callDuration,
  sttModels,
  defaultSttModel,
  onCreateLiveSession,
  startWithCamera,
  callPreferences,
  onToggleSharedMic,
  onToggleLiveDiarization,
  onToggleBatchDiarization,
  recordingPending,
  qwenBatchConfigured,
  recordingError,
  isRecording,
  onToggleRecording,
  sttProvider,
  setSttProvider,
  sttConfigured,
  saveBlocked,
  pendingSaves,
  onAddAudio,
  onPresence,
  roomName,
  meetingRole,
  meetingHostId,
  meetingCoHostIds,
  onManageParticipant,
  employeeId,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechLine,
  onRenameSpeaker,
  onEndMeeting,
  isSummarizing,
  microphoneRestricted,
  speakRequestPending,
  speakRequestAt,
  pendingSpeakRequests,
  onRequestToSpeak,
}: any) {
  const participants = useParticipants();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack, isCameraEnabled, isScreenShareEnabled, lastCameraError, lastMicrophoneError } = useLocalParticipant();
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).filter(isTrackReference).filter(track => !track.publication.isMuted);
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const spotlightIdentity = useSpeakerSpotlight(room, connected);
  const preferredOutputError = usePreferredAudioOutput(room, connected, callPreferences.outputId);
  const camera = useCameraControl(localParticipant, connected, startWithCamera);
  const blur = useBackgroundBlur(localParticipant, isCameraEnabled, connected);
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
  const [speechLanguage, setSpeechLanguage] = useState<'id-ID' | 'en-US'>(() => callPreferences.speechLanguage);
  const [selectedSttModel, setSelectedSttModel] = useState<string | null>(() => resolveTranscriptionPreferences(callPreferences, sttConfigured, sttModels, defaultSttModel, sttProvider).model || null);
  const [transcriptionNotice, setTranscriptionNotice] = useState(() => resolveTranscriptionPreferences(callPreferences, sttConfigured, sttModels, defaultSttModel, sttProvider).notice);
  const [modelPending, setModelPending] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const sttModel = selectedSttModel || defaultSttModel;
  const isLiveModel = isLiveTranscriptionModel(sttModel);
  const paused = isMuted || !connected || isSummarizing || saveBlocked;
  const browserSpeech = useSpeechTranscription({ language: speechLanguage, muted: paused || sttProvider !== 'browser', onFinal: onAddSpeechLine });
  const backendSpeech = useBackendTranscription({ language: speechLanguage, model: sttModel, muted: paused || sttProvider !== 'server' || isLiveModel,
    track: microphoneTrack?.track?.mediaStreamTrack, volume, sharedRoomMic: Boolean(callPreferences.sharedRoomMic), onAudio: onAddAudio });
  const liveSpeech = useWhisperLiveTranscription({ language: speechLanguage,
    muted: paused || sttProvider !== 'server' || !isLiveModel,
    track: microphoneTrack?.track?.mediaStreamTrack, createSession: onCreateLiveSession, onFinal: value => onAddSpeechLine(value, sttModel),
    model: sttModel, diarize: ['qwen3-asr-0.6b-live',SEA_LIVE_MODEL].includes(sttModel) && Boolean(callPreferences.sharedRoomMic) && (callPreferences.liveDiarization ?? true) });
  const serverSpeech = isLiveModel ? liveSpeech : backendSpeech;
  const changeSttModel = async (model: string) => {
    if (modelPending || finishing || isSummarizing || microphone.pending || model === sttModel || !sttModels.includes(model)) return;
    setModelPending(true); setModelError(null);
    try {
      await serverSpeech.prepareTrackChange();
      setSelectedSttModel(model);
      if (model === SEA_LIVE_MODEL) setSpeechLanguage('id-ID');
      onSttModelChanged?.(model);
      setTranscriptionNotice(null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'Gagal mengganti model transkripsi.');
    } finally {
      serverSpeech.resumeTrackChange();
      setModelPending(false);
    }
  };
  const { prepareTrackChange, resumeTrackChange } = serverSpeech;
  const changeSpeechSettings = async (apply: () => void) => {
    if (modelPending || finishing || isSummarizing || microphone.pending) return;
    setModelPending(true); setModelError(null);
    try {
      if (sttProvider === 'server') await prepareTrackChange();
      apply();
      setTranscriptionNotice(null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'Gagal mengganti pengaturan transkripsi.');
    } finally {
      resumeTrackChange(); setModelPending(false);
    }
  };
  const prepareMicrophoneChange = useCallback(async () => {
    if (sttProvider === 'server') await prepareTrackChange();
  }, [sttProvider, prepareTrackChange]);
  const resumeMicrophoneChange = useCallback(() => {
    resumeTrackChange();
  }, [resumeTrackChange]);
  const deviceSettings = useDeviceSettings(room, connected, finishing || isSummarizing || modelPending || camera.pending || microphone.pending, prepareMicrophoneChange, resumeMicrophoneChange);
  const { isListeningSpeechApi, interimText, speechError, toggleSpeechRecognition, speechEnabled, finishTranscription } =
    sttProvider === 'server' ? serverSpeech : browserSpeech;
  const finishMeeting = async (generate: boolean) => {
    if (finishRequest.current) return;
    finishRequest.current = true;
    setFinishing(true); setFinishError(null);
    try {
      const isLastUser = participants.length <= 1 || participants.filter((p: any) => !p.isLocal).length === 0;
      const shouldGenerate = (generate || isLastUser) && !employeeId.startsWith('GUEST-');
      await finishTranscription();
      await onEndMeeting(shouldGenerate);
    }
    catch (error) { setFinishError(featureError('Menyelesaikan rapat',error)); }
    finally { finishRequest.current = false; setFinishing(false); }
  };

  return (
    <>
      {transcriptionNotice && (
        <div className="settings-notice" role="status">
          {transcriptionNotice}
        </div>
      )}

      <MeetingRoom
        qwenDiarizationReady={qwenDiarizationReady}
        callDuration={callDuration}
        meetingRole={meetingRole}
        meetingHostId={meetingHostId}
        meetingCoHostIds={meetingCoHostIds}
        onManageParticipant={onManageParticipant}
        microphoneRestricted={microphoneRestricted}
        speakRequestPending={speakRequestPending}
        speakRequestAt={speakRequestAt}
        onRequestToSpeak={onRequestToSpeak}
        pendingSpeakRequests={pendingSpeakRequests}
        participants={participants}
        roomName={roomName}
        employeeId={employeeId}
        cameraTracks={cameraTracks}
        isCameraEnabled={isCameraEnabled}
        cameraPending={camera.pending || blur.blurPending}
        cameraError={cameraError}
        microphoneError={microphoneError}
        onToggleCamera={camera.toggleCamera}
        microphonePending={microphone.pending}
        connectionState={connectionState}
        screenTracks={screenTracks}
        isScreenShareEnabled={isScreenShareEnabled}
        screenSharePending={screenShare.pending}
        screenShareError={screenShare.error}
        screenShareSupported={screenShareSupported}
        onToggleScreenShare={screenShare.toggleScreenShare}
        devicePending={deviceSettings.pendingKind !== null}
        deviceError={
          devicesOpen
            ? null
            : deviceSettings.error || preferredOutputError
        }
        onOpenDevices={() => setDevicesOpen(true)}
        spotlightIdentity={spotlightIdentity}
        callPreferences={callPreferences}
        mirrorLocalVideo={callPreferences.mirrorLocalVideo}
        connected={connected}
        isMuted={isMuted}
        micVolume={micVolume}
        finishing={finishing}
        isSummarizing={isSummarizing}
        finishError={finishError}
        speechError={speechError}
        speechWarning={sttProvider === 'server' ? serverSpeech.speechWarning : null}
        pendingSaves={pendingSaves}
        interimText={interimText}
        isListening={isListeningSpeechApi}
        speechEnabled={speechEnabled}
        saveBlocked={saveBlocked}
        sttProvider={sttProvider}
        sttConfigured={sttConfigured}
        setSttProvider={provider =>
          void changeSpeechSettings(() => setSttProvider(provider))
        }
        speechLanguage={speechLanguage}
        setSpeechLanguage={language =>
          sttModel === SEA_LIVE_MODEL && language !== 'id-ID'
              ? setModelError('SEA Live hanya mendukung Bahasa Indonesia.')
              : void changeSpeechSettings(() => setSpeechLanguage(language))
        }
        sttModel={sttModel}
        sttModels={sttModels}
        onChangeSttModel={changeSttModel}
        modelPending={modelPending}
        modelError={modelError}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        transcripts={transcripts}
        qwenBatchConfigured={qwenBatchConfigured}
        recordingPending={recordingPending}
        recordingError={recordingError}
        isRecording={isRecording}
        onToggleRecording={onToggleRecording}
        onToggleMute={microphone.toggleMicrophone}
        onToggleTranscription={toggleSpeechRecognition}
        onFinish={finishMeeting}
        onAddSpeechLine={onAddSpeechLine} onRenameSpeaker={onRenameSpeaker}
        backgroundControl={blur}
        isCameraBlur={blur.isBlurEnabled}
        cameraBlurPending={blur.blurPending}
        cameraBlurSupported={blur.blurSupported}
        cameraBlurError={blur.blurError}
        onToggleCameraBlur={blur.toggleBlur}
        onClearCameraBlurError={blur.clearBlurError}
      />

      {devicesOpen && (
        <DeviceSettingsDialog
          settings={deviceSettings}
          connected={connected}
          blocked={
            finishing ||
            isSummarizing ||
            camera.pending ||
            microphone.pending ||
            blur.blurPending
          }
          micVolume={micVolume}
          sttProvider={sttProvider}
          mirror={shouldMirrorCamera(
            callPreferences.mirrorLocalVideo,
            blur.selection
          )}
          sharedRoomMic={callPreferences.sharedRoomMic}
          sharedMicSupported={sttProvider === 'server' && supportsSharedMicrophone(sttModel, qwenDiarizationReady)}
          batchSupported={!sttModel.startsWith('qwen3-asr-') && sttModel !== SEA_LIVE_MODEL}
          onToggleSharedMic={onToggleSharedMic}
          liveDiarization={callPreferences.liveDiarization ?? true}
          onToggleLiveDiarization={onToggleLiveDiarization}
          batchDiarization={callPreferences.batchDiarization ?? true}
          onToggleBatchDiarization={onToggleBatchDiarization}
          onClose={closeDevices}
        />
      )}
    </>
  );
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
  batchDiarizing = false,
  pendingSaves = 0,
  summaryError = null,
  onRetry,
  onBackToHistory,
  onBatchDiarize,
  hasRecording = false,
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
  batchDiarizing?: boolean;
  pendingSaves?: number;
  summaryError?: string | null;
  onRetry?: () => void;
  onBackToHistory?: () => void;
  onBatchDiarize?: () => void;
  hasRecording?: boolean;
}) {
  const [tab, setTab] = useState<'summary' | 'decisions' | 'actions' | 'transcript'>('summary');
  const tabsId = useId();
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'json' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [hasRec, setHasRec] = useState<boolean>(Boolean(hasRecording));
  const [downloadingRecording, setDownloadingRecording] = useState(false);
  const [recordingDownloadError, setRecordingDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (hasRecording) {
      setHasRec(true);
      return;
    }
    if (meetingId) {
      const cleanId = meetingId.replace(/^meeting-/, '');
      fetch(`${API_BASE}/meetings/${cleanId}/recording`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.hasRecording) setHasRec(true);
        })
        .catch(() => {});
    }
  }, [meetingId, hasRecording]);

  const downloadRecording = async () => {
    setDownloadingRecording(true);
    setRecordingDownloadError(null);
    const cleanId = meetingId.replace(/^meeting-/, '');
    const url = `${API_BASE}/meetings/${encodeURIComponent(cleanId)}/recording/download`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        let msg = 'Gagal mengunduh rekaman rapat.';
        try {
          const errData = await res.json();
          if (errData?.error) msg = errData.error;
        } catch { /* ignore non-JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = recordingDownloadName(res, cleanId);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setRecordingDownloadError(err?.message || 'Gagal mengunduh rekaman rapat.');
    } finally {
      setDownloadingRecording(false);
    }
  };

  const downloadExport = async (format: 'pdf' | 'json') => {
    setExporting(format);
    setExportError(null);

    try {
      if (!token && format === 'json') {
        const blob = new Blob([JSON.stringify({ meetingId, roomName, summary, transcripts, source: 'browser-history' }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `balicall-meeting-${meetingId}.json`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
        return;
      }
      if (!token) throw new Error('Sesi akses unduhan server sudah berakhir. Salin notulen atau unduh JSON dari riwayat browser.');
      const response = await fetch(
        `${API_BASE}${meetingPath(meetingId, `export/${format}`)}`,
        {
          method: 'GET',
          credentials: 'include',
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
  const filteredTranscripts = transcripts.filter(entry => {
    const q = query.trim().toLocaleLowerCase('id-ID');
    if (!q) return true;
    if (`${entry.speakerName} ${entry.text}`.toLocaleLowerCase('id-ID').includes(q)) return true;
    if (entry.segments?.some(s => `${s.speaker} ${s.text}`.toLocaleLowerCase('id-ID').includes(q))) return true;
    return false;
  });

  if (isSummarizing && !summary) {
    return (
      <div className="summary-page">
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          {onBackToHistory && (
            <button className="back-link" onClick={onBackToHistory} style={{ margin: 0 }}>
              <ChevronLeft size={16} /> Riwayat notulen
            </button>
          )}
          <button className="back-link" onClick={onNewCall} style={{ margin: 0 }}>
            <Home size={15} /> Kembali ke beranda
          </button>
        </div>
        <section className="summary-card">
          <header className="summary-heading" style={{ borderBottom: '1px solid #e3ebf6', paddingBottom: '20px' }}>
            <div>
              <AIProcessingIndicator />
              <h1 style={{ marginTop: '12px' }}>
                {batchDiarizing
                  ? 'Sedang menjalankan batch diarization & transkripsi…'
                  : pendingSaves > 0
                  ? 'Menyelesaikan transkripsi sisa ucapan…'
                  : 'AI sedang menyusun notulen'}
              </h1>
              <p className="summary-meta">
                Panggilan telah diakhiri · Ruang <strong>#{roomName}</strong> · <strong>{transcripts.length} ucapan</strong> direkam
                {pendingSaves > 0 && <span> · <strong>{pendingSaves} potongan suara</strong> sedang diproses…</span>}
              </p>
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
                {batchDiarizing
                  ? 'Sistem sedang menganalisis seluruh aliran audio rekaman secara menyeluruh dengan model diarization untuk membedakan setiap pembicara (Pembicara 1, Pembicara 2, dst) secara konsisten dari awal hingga akhir rapat.'
                  : pendingSaves > 0
                  ? `Sistem sedang menyelesaikan pengenalan suara untuk ${pendingSaves} potongan audio terakhir. Setelah selesai, AI akan langsung membuat notulen rapat secara otomatis.`
                  : 'Panggilan telah selesai. AI sedang menganalisis seluruh percakapan yang terekam untuk menyusun ringkasan eksekutif, pokok pembahasan, keputusan, dan daftar tindak lanjut (action items).'}
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
                {transcripts.flatMap(entry => (
                  entry.segments && entry.segments.length > 0 ? (
                    entry.segments.map((segment, sIdx) => (
                      <article className="recap-transcript-entry diarized" data-speaker={segment.speaker} key={`${entry.id}-${sIdx}`}>
                        <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                        <div>
                          <strong className="transcript-username">{entry.speakerName}</strong>
                          <div className="transcript-diarized-row">
                            <span className="transcript-diarized-speaker" data-speaker={segment.speaker}>{speakerDisplayLabel(segment, entry.speakerName)}</span>
                            <span className="segment-time-pill">{segment.start.toFixed(1)}s–{segment.end.toFixed(1)}s</span>
                          </div>
                          <p>{segment.text}</p>
                        </div>
                      </article>
                    ))
                  ) : [
                    <article className="recap-transcript-entry" key={entry.id}>
                      <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                      <div>
                        <strong>{entry.speakerName}</strong>
                        <p>{entry.text}</p>
                      </div>
                    </article>
                  ]
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
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          {onBackToHistory && (
            <button className="back-link" onClick={onBackToHistory} style={{ margin: 0 }}>
              <ChevronLeft size={16} /> Riwayat notulen
            </button>
          )}
          <button className="back-link" onClick={onNewCall} style={{ margin: 0 }}>
            <Home size={15} /> Kembali ke beranda
          </button>
        </div>
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
                {transcripts.flatMap(entry => (
                  entry.segments && entry.segments.length > 0 ? (
                    entry.segments.map((segment, sIdx) => (
                      <article className="recap-transcript-entry diarized" data-speaker={segment.speaker} key={`${entry.id}-${sIdx}`}>
                        <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                        <div>
                          <strong className="transcript-username">{entry.speakerName}</strong>
                          <div className="transcript-diarized-row">
                            <span className="transcript-diarized-speaker" data-speaker={segment.speaker}>{speakerDisplayLabel(segment, entry.speakerName)}</span>
                            <span className="segment-time-pill">{segment.start.toFixed(1)}s–{segment.end.toFixed(1)}s</span>
                          </div>
                          <p>{segment.text}</p>
                        </div>
                      </article>
                    ))
                  ) : [
                    <article className="recap-transcript-entry" key={entry.id}>
                      <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                      <div>
                        <strong>{entry.speakerName}</strong>
                        <p>{entry.text}</p>
                      </div>
                    </article>
                  ]
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
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          {onBackToHistory && (
            <button className="back-link" onClick={onBackToHistory} style={{ margin: 0 }}>
              <ChevronLeft size={16} /> Riwayat notulen
            </button>
          )}
          <button className="back-link" onClick={onNewCall} style={{ margin: 0 }}>
            <Home size={15} /> Kembali ke beranda
          </button>
        </div>
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
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        {onBackToHistory && (
          <button className="back-link" onClick={onBackToHistory} style={{ margin: 0 }}>
            <ChevronLeft size={16} /> Kembali ke riwayat notulen
          </button>
        )}
        <button className="back-link" onClick={onNewCall} style={{ margin: 0 }}>
          <Home size={15} /> Beranda
        </button>
      </div>
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
            {onBatchDiarize && token && (
              <button
                className="button-secondary"
                onClick={onBatchDiarize}
                disabled={batchDiarizing || isSummarizing}
                title="Qwen + Nemotron memproses satu rekaman LiveKit seluruh peserta. Rekam sejak awal dan tunggu semua peserta keluar."
              >
                {batchDiarizing ? <Loader2 className="ui-spinner" size={15} /> : <Sparkles size={15} />}
                <span>{batchDiarizing ? 'Memproses batch Qwen…' : 'Batch Qwen + Nemotron'}</span>
              </button>
            )}
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

            {hasRec && (
              <button
                type="button"
                className="button-secondary"
                onClick={downloadRecording}
                disabled={downloadingRecording}
                title="Unduh rekaman rapat dalam format aslinya (MP4 video atau OGG audio)"
              >
                {downloadingRecording ? <Loader2 className="ui-spinner" size={15} /> : <Video size={15} />}
                <span>{downloadingRecording ? 'Menyiapkan Rekaman...' : 'Unduh Rekaman'}</span>
              </button>
            )}

            <button className="button-primary" onClick={onNewCall}> Rapat baru <ArrowRight size={15} /></button>
          </div>
        </header>

        {summary.note && <div className="summary-note"><AlertCircle size={16} />{summary.note}</div>}
        {!token && <div className="summary-note">Hasil ini dibuka dari riwayat browser. Salin notulen atau unduh JSON; PDF server memerlukan sesi akses rapat yang masih berlaku.</div>}

        {exportError && (
          <div className="summary-note" role="alert">
            <AlertCircle size={16} />
            {exportError}
          </div>
        )}

        {recordingDownloadError && (
          <div className="summary-note" role="alert">
            <AlertCircle size={16} />
            {recordingDownloadError}
          </div>
        )}
        <nav className="summary-tabs" aria-label="Bagian notulen" role="tablist" onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const current = buttons.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          setTab(tabs[next].id);
          buttons[next].focus();
          buttons[next].scrollIntoView({block:'nearest',inline:'nearest'});
        }}>
          {tabs.map(item => <button key={item.id} type="button" role="tab" id={`${tabsId}-${item.id}`} aria-controls={`${tabsId}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={`summary-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>

        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} tabIndex={0}>
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

        {tab === 'actions' && <div className="summary-panel"><section className="summary-section"><h2>Tindak lanjut</h2>{summary.actionItems?.length ? <div className="action-table-wrap"><table className="action-table"><thead><tr><th style={{ width: '40px' }}>No</th><th>Tugas</th><th>PIC / Penanggung jawab</th><th>Prioritas</th><th>Tenggat / Syarat</th></tr></thead><tbody>{summary.actionItems.map((item, index) => <tr key={index}><td>{index + 1}</td><td>{item.task}</td><td>{item.assignee || 'Belum ditentukan'}</td><td><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.deadline || 'Belum ditentukan'}</td></tr>)}</tbody></table></div> : <p>Belum ada tindak lanjut yang tercatat.</p>}</section></div>}

        {tab === 'transcript' && <div className="summary-panel"><section className="summary-section">
          <div className="transcript-heading"><div><h2>Transkrip lengkap</h2><p>{filteredTranscripts.length} dari {transcripts.length} ucapan</p></div><label className="transcript-search"><Search size={15} /><input aria-label="Cari transkrip" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau isi ucapan" /></label></div>
          {filteredTranscripts.length ? <div className="recap-transcript-list">{filteredTranscripts.flatMap(entry => (
            entry.segments && entry.segments.length > 0 ? (
              entry.segments.map((segment, sIdx) => (
                <article className="recap-transcript-entry diarized" data-speaker={segment.speaker} key={`${entry.id}-${sIdx}`}>
                  <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                  <div>
                    <strong className="transcript-username">{entry.speakerName}</strong>
                    <div className="transcript-diarized-row">
                      <span className="transcript-diarized-speaker" data-speaker={segment.speaker}>{speakerDisplayLabel(segment, entry.speakerName)}</span>
                      <span className="segment-time-pill">{segment.start.toFixed(1)}s–{segment.end.toFixed(1)}s</span>
                    </div>
                    <p>{segment.text}</p>
                  </div>
                </article>
              ))
            ) : [
              <article className="recap-transcript-entry" key={entry.id}>
                <time>{new Date(entry.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
                <div>
                  <strong>{entry.speakerName}</strong>
                  <p>{entry.text}</p>
                </div>
              </article>
            ]
          ))}</div> : <p className="empty-transcript">{transcripts.length ? 'Tidak ada ucapan yang cocok dengan pencarian.' : 'Belum ada transkrip untuk rapat ini.'}</p>}
        </section></div>}
        </div>
      </section>
    </div>
  );
}
