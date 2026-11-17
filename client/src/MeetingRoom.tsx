import { TranscriptionStatus } from './TranscriptionFeedback';
import { transcriptionStatus } from './transcriptionStatus';
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore } from 'react';
import { QWEN_TRANSCRIPTION_NOTICE, QWEN_DIARIZATION_NOTICE, QWEN_LIVE_DIARIZATION_NOTICE } from './preferences';
import type { MeetingPreferences } from './preferences';
import { TranscriptionModelOptions } from './TranscriptionModelOptions';
import { SEA_LIVE_MODEL, SEA_LIVE_NOTICE, MING_LIVE_MODEL, MING_LIVE_NOTICE, QWEN_GGUF_LIVE_MODEL, QWEN_GGUF_LIVE_NOTICE } from './modelSelection';
import { speakerDisplayLabel } from './transcriptSpeakers';
import { SpeakerNameEditor } from './SpeakerNameEditor';
import type { SpeakerNameChange } from './SpeakerNameEditor';
import type { KeyboardEvent } from 'react';
import type { Participant } from 'livekit-client';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import {
  AudioLines,
  Check,
  ChevronDown,
  Download,
  FileText,
  MessageSquare,
  MessageSquareText,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Users,
  VideoOff,
  Grid2X2,
  Hand,
  MoreVertical,
  UserRound,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  SlidersHorizontal,
  ShieldCheck,
  Info,
  X,
} from 'lucide-react';
import { API_BASE, apiRequest } from './api';
import { StartAudio, useRoomContext } from '@livekit/components-react';
import { BackgroundSettingsDialog } from './BackgroundSettingsDialog';
import { LeaveConfirmDialog } from './LeaveConfirmDialog';
import { shouldMirrorCamera } from './backgroundEffects';
import type { BackgroundBlurControl } from './useBackgroundBlur';
import { MeetingControls } from './MeetingControls';
import { initials } from './presentation';
import { ParticipantLayout } from './ParticipantLayout';
import { MeetingPanel } from './MeetingPanel';
import { useMeasuredBox, useCompactMeeting } from './useMeetingGeometry';
import { orderParticipants, participantPage } from './meetingLayout';
import './MeetingLayout.css';
import { ScreenShareStage } from './ScreenShareStage';
import type { ScreenShareResolution } from './preferences';
import { usePresentationView } from './usePresentationView';
import { usePresentationFullscreen } from './usePresentationFullscreen';
import { usePresentationEscape } from './usePresentationEscape';
import {
  downloadMeetingFile,
  fetchMeetingFiles,
  formatFileSize,
  MEETING_FILE_TOPIC,
  uploadMeetingFile,
  type MeetingFile,
} from './meetingFiles';

interface Transcript {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  timestamp: string;
  segments?: {
    text: string;
    speaker: string;
    start: number;
    end: number;
    sourceId?: string; sessionId?: string; attribution?: string; speakerName?: string;
  }[];
}

type MeetingRole = 'host' | 'co-host' | 'participant';

type ParticipantAction =
  | 'promote'
  | 'demote'
  | 'transfer-host'
  | 'mute'
  | 'remove'
  | 'approve-speak';

interface MeetingRoomProps {
  callDuration?: string;
  isRecording?: boolean;
  backgroundControl?: BackgroundBlurControl;

  participants: Participant[];
  meetingId?: string;
  token?: string;
  isSuperAdmin?: boolean;
  screenSharePolicy?: 'all' | 'co-hosts' | 'host';
  chatDisabled?: boolean;
  onUpdatePermissions?: (patch: { screenSharePolicy?: 'all' | 'co-hosts' | 'host'; chatDisabled?: boolean }) => Promise<void>;
  onKicked?: () => void;
  roomName: string;
  roomCode?: string;
  employeeId: string;
  connected: boolean;
  isMuted: boolean;
  micVolume: number;

  finishing: boolean;
  isSummarizing: boolean;
  finishError: string | null;
  speechError: string | null;
  speechWarning?: string | null;
  pendingSaves?: number;
  interimText: string;
  isListening: boolean;
  speechEnabled: boolean;
  saveBlocked: boolean;

  sttProvider: 'browser' | 'server';
  sttConfigured: boolean;
  qwenDiarizationReady?: boolean;
  setSttProvider: (provider: 'browser' | 'server') => void;

  sttModel: string;
  sttModels: string[];
  onChangeSttModel: (model: string) => Promise<void>;
  modelPending: boolean;
  modelError: string | null;

  speechLanguage: 'id-ID' | 'en-US';
  setSpeechLanguage: (language: 'id-ID' | 'en-US') => void;

  activeTab: 'transcript' | 'attendance';
  setActiveTab: (tab: 'transcript' | 'attendance') => void;
  transcripts: Transcript[];

  onToggleMute: () => Promise<void>;
  onToggleTranscription: () => void;
  onFinish: (generate: boolean) => Promise<void>;
  onAddSpeechLine: (text: string) => void;
  onRenameSpeaker?: (change: SpeakerNameChange) => Promise<void>;

  cameraTracks: TrackReferenceOrPlaceholder[];
  isCameraEnabled: boolean;
  cameraPending: boolean;
  cameraError: string | null;
  microphoneError: string | null;
  onToggleCamera: () => Promise<void>;

  screenTracks: TrackReference[];
  isScreenShareEnabled: boolean;
  screenSharePending: boolean;
  screenShareError: string | null;
  screenShareSupported: boolean;
  onToggleScreenShare: () => Promise<void>;
  screenShareResolution?: ScreenShareResolution;
  onSelectScreenShareResolution?: (resolution: ScreenShareResolution) => void;

  devicePending: boolean;
  deviceError: string | null;
  onOpenDevices: () => void;

  spotlightIdentity: string | null;
  microphonePending: boolean;
  connectionState: ConnectionState;
  mirrorLocalVideo?: boolean;
  callPreferences?: MeetingPreferences;

  recordingPending: boolean;
  recordingError: string | null;
  onToggleRecording: (enabled: boolean, postMeetingBatch?: boolean) => Promise<void>;
  qwenBatchConfigured?: boolean;

  isCameraBlur?: boolean;
  cameraBlurPending?: boolean;
  cameraBlurSupported?: boolean;
  cameraBlurError?: string | null;
  onToggleCameraBlur?: () => Promise<void>;
  onClearCameraBlurError?: () => void;

  meetingRole: MeetingRole;
  meetingHostId: string | null;
  participantPanelRequest?: number;
  meetingCoHostIds: string[];
  microphoneRestricted: boolean;
  speakRequestPending: boolean;
  onRequestToSpeak: () => Promise<void>;
  pendingSpeakRequests: Array<{
    identity: string;
    name: string;
    speakRequestAt: string;
  }>;
  speakRequestAt: string | null;
  onManageParticipant: (
    participantId: string,
    action: ParticipantAction
  ) => Promise<void>;
}

export function MeetingRoom({
  callDuration,
  participants,
  roomName,
  roomCode,
  employeeId,
  connected,
  isMuted,
  micVolume,
  finishing,
  isSummarizing,
  finishError,
  speechError,
  speechWarning,
  pendingSaves = 0,
  interimText,
  isListening,
  speechEnabled,
  saveBlocked,
  sttProvider,
  sttConfigured,
  qwenDiarizationReady = false,
  setSttProvider,
  sttModel,
  sttModels,
  onChangeSttModel,
  modelPending,
  modelError,
  speechLanguage,
  setSpeechLanguage,
  activeTab,
  setActiveTab,
  transcripts,
  onToggleMute,
  onToggleTranscription,
  onFinish,
  onAddSpeechLine,
  onRenameSpeaker,
  cameraTracks,
  isCameraEnabled,
  cameraPending,
  cameraError,
  microphoneError,
  onToggleCamera,
  screenTracks,
  isScreenShareEnabled,
  screenSharePending,
  screenShareError,
  screenShareSupported,
  onToggleScreenShare,
  screenShareResolution = '1080p',
  onSelectScreenShareResolution,
  devicePending,
  deviceError,
  onOpenDevices,
  spotlightIdentity,
  microphonePending,
  connectionState,
  mirrorLocalVideo = true,
  callPreferences,
  recordingPending,
  recordingError,
  isRecording,
  onToggleRecording,
  qwenBatchConfigured = false,
  isCameraBlur = false,
  cameraBlurPending = false,
  cameraBlurSupported = true,
  cameraBlurError = null,
  onToggleCameraBlur,
  onClearCameraBlurError,
  backgroundControl,
  meetingRole,
  meetingHostId,
  participantPanelRequest,
  meetingCoHostIds,
  onRequestToSpeak,
  speakRequestPending,
  speakRequestAt,
  pendingSpeakRequests,
  microphoneRestricted,
  onManageParticipant,
  meetingId,
  token,
  isSuperAdmin = false,
  screenSharePolicy = 'all',
  chatDisabled = false,
  onUpdatePermissions,
  onKicked,
}: MeetingRoomProps) {
  const room = useRoomContext();
  const [meetingFiles, setMeetingFiles] = useState<MeetingFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [waitingUsers, setWaitingUsers] = useState<{ id: string; name: string; department?: string; isGuest?: boolean; requestedAt: string }[]>([]);
  const [waitingPopups, setWaitingPopups] = useState<{ id: string; name: string }[]>([]);
  const [waitingBusyId, setWaitingBusyId] = useState<string | null>(null);
  const seenWaitingIdsRef = useRef<Set<string>>(new Set());
  const [raisedHands, setRaisedHands] = useState<Record<string, number>>({});
  const [raiseHandNotices, setRaiseHandNotices] = useState<{ id: string; text: string; timestamp: string }[]>([]);
  const [openParticipantMenuId, setOpenParticipantMenuId] = useState<string | null>(null);
  const [livePermissions, setLivePermissions] = useState<{ screenSharePolicy: 'all' | 'co-hosts' | 'host'; chatDisabled: boolean }>({
    screenSharePolicy,
    chatDisabled,
  });

  useEffect(() => {
    setLivePermissions({ screenSharePolicy, chatDisabled });
  }, [screenSharePolicy, chatDisabled]);
  const RAISE_HAND_TOPIC = 'balicall.raise_hand.v1';
  const RAISE_HAND_DURATION_MS = 180_000;
  const raisedHandsRef = useRef<Record<string, number>>({});
  raisedHandsRef.current = raisedHands;

  useEffect(() => {
    if (!openParticipantMenuId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.attendance-more-wrap')) setOpenParticipantMenuId(null);
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpenParticipantMenuId(null);
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openParticipantMenuId]);

  useEffect(() => {
    if (!room) return;
    const handleRaiseData = (payload: Uint8Array, _participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== RAISE_HAND_TOPIC) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { identity?: string; name?: string; raisedAt?: number | null };
        if (!msg?.identity) return;
        const id = msg.identity;
        const raisedAt = typeof msg.raisedAt === 'number' && msg.raisedAt > 0 ? msg.raisedAt : null;
        if (raisedAt && Date.now() - raisedAt < RAISE_HAND_DURATION_MS) {
          setRaisedHands(prev => {
            if (prev[id] === raisedAt) return prev;
            return { ...prev, [id]: raisedAt };
          });
          setRaiseHandNotices(prev => {
            const noticeId = `hand-${id}-${raisedAt}`;
            if (prev.some(n => n.id === noticeId)) return prev;
            return [...prev, { id: noticeId, text: `${msg.name || id} raised a hand`, timestamp: new Date(raisedAt).toISOString() }];
          });
        } else {
          setRaisedHands(prev => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      } catch {
        /* ignore malformed raise-hand payload */
      }
    };
    const handlePeerConnected = () => {
      const localRaisedAt = raisedHandsRef.current[employeeId];
      if (localRaisedAt && Date.now() - localRaisedAt < RAISE_HAND_DURATION_MS && room.localParticipant?.publishData) {
        const localName = room.localParticipant.name || employeeId;
        const encoded = new TextEncoder().encode(JSON.stringify({ identity: employeeId, name: localName, raisedAt: localRaisedAt }));
        room.localParticipant.publishData(encoded, { reliable: true, topic: RAISE_HAND_TOPIC }).catch(() => {});
      }
    };
    const handleKickData = (payload: Uint8Array, _participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== 'balicall.kicked.v1') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { targetId?: string };
        if (msg?.targetId === employeeId) {
          onKicked?.();
        }
      } catch {
        /* ignore malformed kick payload */
      }
    };
    const handlePermData = (payload: Uint8Array, _participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== 'balicall.permissions.v1') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          screenSharePolicy?: 'all' | 'co-hosts' | 'host';
          chatDisabled?: boolean;
        };
        setLivePermissions(prev => ({
          screenSharePolicy: msg.screenSharePolicy ?? prev.screenSharePolicy,
          chatDisabled: typeof msg.chatDisabled === 'boolean' ? msg.chatDisabled : prev.chatDisabled,
        }));
      } catch {
        /* ignore malformed permissions payload */
      }
    };
    room.on(RoomEvent.DataReceived, handleRaiseData);
    room.on(RoomEvent.DataReceived, handleKickData);
    room.on(RoomEvent.DataReceived, handlePermData);
    room.on(RoomEvent.ParticipantConnected, handlePeerConnected);
    return () => {
      room.off(RoomEvent.DataReceived, handleRaiseData);
      room.off(RoomEvent.DataReceived, handleKickData);
      room.off(RoomEvent.DataReceived, handlePermData);
      room.off(RoomEvent.ParticipantConnected, handlePeerConnected);
    };
  }, [room, employeeId, onKicked]);

  useEffect(() => {
    const entries = Object.entries(raisedHands);
    if (!entries.length) return;
    const now = Date.now();
    const nextExpiry = Math.min(...entries.map(([, ts]) => Math.max(250, ts + RAISE_HAND_DURATION_MS - now)));
    const timer = setTimeout(() => {
      const cutoff = Date.now() - RAISE_HAND_DURATION_MS;
      const localWasRaised = Boolean(raisedHandsRef.current[employeeId] && raisedHandsRef.current[employeeId] <= cutoff);
      setRaisedHands(prev => {
        let changed = false;
        const next: Record<string, number> = {};
        for (const [id, ts] of Object.entries(prev)) {
          if (ts > cutoff) next[id] = ts;
          else changed = true;
        }
        return changed ? next : prev;
      });
      if (localWasRaised && room?.localParticipant?.publishData) {
        const localName = room.localParticipant.name || employeeId;
        const encoded = new TextEncoder().encode(JSON.stringify({ identity: employeeId, name: localName, raisedAt: null }));
        room.localParticipant.publishData(encoded, { reliable: true, topic: RAISE_HAND_TOPIC }).catch(() => {});
      }
    }, nextExpiry);
    return () => clearTimeout(timer);
  }, [raisedHands, employeeId, room]);

  const effectiveScreenSharePolicy = livePermissions.screenSharePolicy;
  const effectiveChatDisabled = livePermissions.chatDisabled;
  const canShareScreenByPolicy =
    effectiveScreenSharePolicy === 'all' ||
    meetingRole === 'host' ||
    (effectiveScreenSharePolicy === 'co-hosts' && meetingRole === 'co-host');
  const canSendChatByPolicy =
    !effectiveChatDisabled || meetingRole === 'host' || meetingRole === 'co-host';

  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const prevScreenSharePolicyRef = useRef(effectiveScreenSharePolicy);
  const toggleScreenShareRef = useRef(onToggleScreenShare);
  toggleScreenShareRef.current = onToggleScreenShare;
  const screenShareEnabledRef = useRef(isScreenShareEnabled);
  screenShareEnabledRef.current = isScreenShareEnabled;

  useEffect(() => {
    if (prevScreenSharePolicyRef.current === effectiveScreenSharePolicy) return;
    prevScreenSharePolicyRef.current = effectiveScreenSharePolicy;

    const policyMessage =
      effectiveScreenSharePolicy === 'host'
        ? 'The host has enabled screen sharing for hosts only.'
        : effectiveScreenSharePolicy === 'co-hosts'
          ? 'The host has enabled screen sharing for hosts and co-hosts only.'
          : 'The host has enabled screen sharing for all participants.';

    if (screenShareEnabledRef.current && !canShareScreenByPolicy) {
      void toggleScreenShareRef.current?.();
      setPolicyNotice(
        effectiveScreenSharePolicy === 'host'
          ? 'The host disabled screen sharing for non-hosts. Your screen share was stopped.'
          : 'The host restricted screen sharing to hosts and co-hosts only. Your screen share was stopped.'
      );
    } else {
      setPolicyNotice(policyMessage);
    }
  }, [effectiveScreenSharePolicy, canShareScreenByPolicy]);

  useEffect(() => {
    if (!policyNotice) return;
    const timer = setTimeout(() => setPolicyNotice(null), 5500);
    return () => clearTimeout(timer);
  }, [policyNotice]);

  const handleUpdatePermissions = useCallback(
    async (patch: { screenSharePolicy?: 'all' | 'co-hosts' | 'host'; chatDisabled?: boolean }) => {
      if (!onUpdatePermissions) return;
      const next = {
        screenSharePolicy: patch.screenSharePolicy ?? livePermissions.screenSharePolicy,
        chatDisabled: patch.chatDisabled ?? livePermissions.chatDisabled,
      };
      setLivePermissions(next);
      if (room?.localParticipant?.publishData) {
        const encoded = new TextEncoder().encode(JSON.stringify(next));
        room.localParticipant.publishData(encoded, { reliable: true, topic: 'balicall.permissions.v1' }).catch(() => {});
      }
      try {
        await onUpdatePermissions(patch);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Gagal memperbarui izin rapat.');
      }
    },
    [onUpdatePermissions, livePermissions, room]
  );

  const toggleRaiseHand = useCallback(() => {
    const currentlyRaised = Boolean(raisedHandsRef.current[employeeId]);
    const localName = room?.localParticipant?.name || employeeId;
    const nextRaisedAt = currentlyRaised ? null : Date.now();
    setRaisedHands(prev => {
      if (!nextRaisedAt) {
        if (!prev[employeeId]) return prev;
        const next = { ...prev };
        delete next[employeeId];
        return next;
      }
      return { ...prev, [employeeId]: nextRaisedAt };
    });
    if (nextRaisedAt) {
      setRaiseHandNotices(prev => [
        ...prev,
        { id: `hand-${employeeId}-${nextRaisedAt}`, text: `${localName} raised a hand`, timestamp: new Date(nextRaisedAt).toISOString() },
      ]);
    }
    if (room?.localParticipant?.publishData) {
      const encoded = new TextEncoder().encode(JSON.stringify({ identity: employeeId, name: localName, raisedAt: nextRaisedAt }));
      room.localParticipant.publishData(encoded, { reliable: true, topic: RAISE_HAND_TOPIC }).catch(() => {});
    }
  }, [employeeId, room]);

  const isManager = meetingRole === 'host' || meetingRole === 'co-host';

  useEffect(() => {
    if (!isManager || !meetingId || !token) return;
    let active = true;
    const applyWaitingPayload = (res: {
      waitingRoom?: boolean;
      waitingUsers?: { id: string; name: string; department?: string; isGuest?: boolean; requestedAt: string }[];
    }) => {
      if (!active) return;
      setWaitingRoomEnabled(Boolean(res.waitingRoom));
      const list = Array.isArray(res.waitingUsers) ? res.waitingUsers : [];
      setWaitingUsers(list);
      const newEntries = list.filter(u => !seenWaitingIdsRef.current.has(u.id));
      if (newEntries.length) {
        for (const entry of newEntries) seenWaitingIdsRef.current.add(entry.id);
        setWaitingPopups(prev => [
          ...prev,
          ...newEntries.filter(entry => !prev.some(p => p.id === entry.id)).map(entry => ({ id: entry.id, name: entry.name })),
        ]);
      }
      const activeIds = new Set(list.map(u => u.id));
      for (const id of [...seenWaitingIdsRef.current]) {
        if (!activeIds.has(id)) seenWaitingIdsRef.current.delete(id);
      }
      setWaitingPopups(prev => prev.filter(p => activeIds.has(p.id)));
    };
    const pollWaiting = async () => {
      try {
        const res = await apiRequest<{
          waitingRoom: boolean;
          waitingUsers: { id: string; name: string; department?: string; isGuest?: boolean; requestedAt: string }[];
        }>(`/meetings/${encodeURIComponent(meetingId)}/waiting-room`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        applyWaitingPayload(res);
      } catch {
        /* ignore transient waiting-room poll errors */
      }
    };
    let source: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(
        `${API_BASE}/meetings/${encodeURIComponent(meetingId)}/waiting-events?token=${encodeURIComponent(token)}`,
        { withCredentials: true }
      );
      source.addEventListener('waiting-room', event => {
        try {
          applyWaitingPayload(JSON.parse((event as MessageEvent).data));
        } catch {
          /* ignore malformed event */
        }
      });
    }
    void pollWaiting();
    const timer = setInterval(() => void pollWaiting(), 8000);
    return () => {
      active = false;
      source?.close();
      clearInterval(timer);
    };
  }, [isManager, meetingId, token]);

  const handleWaitingAction = async (userId: string, action: 'admit' | 'deny') => {
    if (!meetingId || !token || waitingBusyId) return;
    setWaitingBusyId(userId);
    try {
      const res = await apiRequest<{
        ok: boolean;
        waitingUsers: { id: string; name: string; department?: string; isGuest?: boolean; requestedAt: string }[];
      }>(`/meetings/${encodeURIComponent(meetingId)}/waiting-room/${encodeURIComponent(userId)}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setWaitingUsers(Array.isArray(res.waitingUsers) ? res.waitingUsers : []);
      setWaitingPopups(prev => prev.filter(p => p.id !== userId));
      seenWaitingIdsRef.current.delete(userId);
    } catch {
      /* ignore */
    } finally {
      setWaitingBusyId(null);
    }
  };

  useEffect(() => {
    if (!meetingId || !token) return;
    let active = true;
    fetchMeetingFiles(meetingId, token)
      .then(files => {
        if (active) setMeetingFiles(files);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [meetingId, token]);

  useEffect(() => {
    if (!room) return;
    const handleData = (payload: Uint8Array, _participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_FILE_TOPIC) return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as { file?: MeetingFile };
        const incoming = parsed?.file;
        if (!incoming?.id) return;
        setMeetingFiles(prev => (prev.some(item => item.id === incoming.id) ? prev : [...prev, incoming]));
      } catch {
        /* ignore malformed file broadcast */
      }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  const handleChatFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (!selectedFile || !meetingId || !token || uploadingFile) return;
    setUploadingFile(true);
    setFileError(null);
    try {
      const uploaded = await uploadMeetingFile(meetingId, token, selectedFile);
      setMeetingFiles(prev => (prev.some(item => item.id === uploaded.id) ? prev : [...prev, uploaded]));
      if (room?.localParticipant?.publishData) {
        const encoded = new TextEncoder().encode(JSON.stringify({ file: uploaded }));
        room.localParticipant.publishData(encoded, { reliable: true, topic: MEETING_FILE_TOPIC }).catch(() => {});
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Gagal mengirim file.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDownloadChatFile = async (file: MeetingFile) => {
    if (!meetingId || downloadingFileId) return;
    setDownloadingFileId(file.id);
    setFileError(null);
    try {
      await downloadMeetingFile(meetingId, file.id, file.originalFilename, token);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Gagal mengunduh file.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  const subscribeRecording = useCallback(
    (notify: () => void) => {
      room.on(RoomEvent.RecordingStatusChanged, notify);

      return () => {
        room.off(RoomEvent.RecordingStatusChanged, notify);
      };
    },
    [room]
  );

  const livekitRecording = useSyncExternalStore(
    subscribeRecording,
    () => room.isRecording,
    () => false
  );

  // Gunakan status recording yang sudah dikonfirmasi.
  const recording = livekitRecording || isRecording === true;

  const handleToggleRecording = async () => {
    if (callPreferences?.recordingConsentPrompt && !recording) {
      if (!window.confirm('Mulai merekam rapat ini? Seluruh peserta akan menerima pemberitahuan visual bahwa sesi ini sedang direkam.')) {
        return;
      }
    }
    await onToggleRecording(!recording);
  };

  const autoRecordDone = useRef(false);
  useEffect(() => {
    if (callPreferences?.autoRecordMeeting && connected && meetingRole === 'host' && !recording && !recordingPending && !autoRecordDone.current) {
      autoRecordDone.current = true;
      onToggleRecording(true);
    }
  }, [callPreferences?.autoRecordMeeting, connected, meetingRole, recording, recordingPending, onToggleRecording]);
  const [backgroundsOpen, setBackgroundsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'speaker'>('grid');
  const compact = useCompactMeeting();
  const [panelOpen, setPanelOpen] = useState(() => !compact);
  const [panelPercent, setPanelPercent] = useState(25);
  const [requestedPage, setRequestedPage] = useState(0);
  const { ref: roomRef, width: roomWidth } = useMeasuredBox<HTMLDivElement>();

  const sharing=screenTracks.length>0;
  const presentation=usePresentationView(sharing,panelOpen);
  const fullScreen=usePresentationFullscreen(roomRef,sharing);
  usePresentationEscape(presentation.focused, presentation.toggleFocus);
  const panelVisible=presentation.panelVisible;
  const changePanel=(value:boolean)=>{if(sharing)presentation.setPanelVisible(value);else setPanelOpen(value);};
  const showParticipantPanel = useEffectEvent(() => {
    changePanel(true);
    setActiveTab('attendance');
  });
  useEffect(() => {
    if (participantPanelRequest) showParticipantPanel();
  }, [participantPanelRequest]);
  const minPercent = Math.max(20, roomWidth ? 280 / roomWidth * 100 : 20);
  const panelWidth = Math.max(minPercent, Math.min(42, panelPercent));

  const resizePanel = (value: number) =>
    setPanelPercent(Math.max(minPercent, Math.min(42, value)));

  const orderedParticipants = orderParticipants(participants, raisedHands);

  const closePanel = () => {
    changePanel(false);

    if (!compact) {
      document.getElementById('toggle-meeting-transcript')?.focus();
    }
  };

  const [manualText, setManualText] = useState('');
  const tabId = useId();

  const transcriptTab = useRef<HTMLButtonElement>(null);
  const attendanceTab = useRef<HTMLButtonElement>(null);
  const transcriptListRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottomRef = useRef(true);
  const hasInitialScrolledRef = useRef(false);

  const handleTranscriptScroll = () => {
    const el = transcriptListRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    isScrolledToBottomRef.current = atBottom;
  };

  useEffect(() => {
    const el = transcriptListRef.current;
    if (!el) return;
    if (isScrolledToBottomRef.current) {
      const behavior = hasInitialScrolledRef.current ? 'smooth' : 'auto';
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
      if (transcripts.length > 0) {
        hasInitialScrolledRef.current = true;
      }
    }
  }, [transcripts, interimText]);

  useEffect(() => {
    if (panelVisible && activeTab === 'transcript') {
      const el = transcriptListRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        isScrolledToBottomRef.current = true;
      }
    }
  }, [panelVisible, activeTab]);

  const activateTab = (tab: 'transcript' | 'attendance') => {
    setActiveTab(tab);
    (tab === 'transcript' ? transcriptTab : attendanceTab).current?.focus();
  };

  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();

    activateTab(
      event.key === 'Home'
        ? 'transcript'
        : event.key === 'End'
          ? 'attendance'
          : activeTab === 'transcript'
            ? 'attendance'
            : 'transcript'
    );
  };

  const [finishMode, setFinishMode] = useState<'summary' | 'leave' | null>(null);

  const busy = finishing || isSummarizing || modelPending;
  const reconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  const connectionLabel = connected
    ? 'Terhubung'
    : reconnecting
      ? 'Menyambungkan kembali'
      : connectionState === ConnectionState.Disconnected
        ? 'Koneksi terputus'
        : 'Menghubungkan';

  const camerasByIdentity = new Map(
    cameraTracks.map(track => [track.participant.identity, track])
  );

  const mirrorCamera = shouldMirrorCamera(
    mirrorLocalVideo,
    backgroundControl?.selection
  );

  const spotlight =
    orderedParticipants.find(
      participant => participant.identity === spotlightIdentity
    ) || orderedParticipants[0];

  const showingSpeaker =
    viewMode === 'speaker' &&
    screenTracks.length === 0 &&
    Boolean(spotlight);

  const videoWidth =
    roomWidth * (panelVisible && !compact ? 1 - panelWidth / 100 : 1) - 50;

  const stripCapacity = Math.max(
    1,
    Math.min(showingSpeaker ? 8 : 9, Math.floor((videoWidth + 10) / 150))
  );

  const paging = participantPage(
    showingSpeaker
      ? orderedParticipants.filter(
          participant => participant.identity !== spotlight?.identity
        )
      : orderedParticipants,
    requestedPage,
    screenTracks.length || showingSpeaker ? stripCapacity : 9
  );

  const isVoiceActive = connected && !isMuted && micVolume > 5;

  const finishLabel = !busy
    ? null
    : finishing && !isSummarizing
      ? 'Menyimpan transkrip…'
      : finishMode === 'summary'
        ? 'Menyiapkan notulen…'
        : 'Menyimpan rapat…';

  const isGuest = employeeId.startsWith('GUEST-');
  const isLastUser = participants.length <= 1 || participants.filter(p => !p.isLocal).length === 0;
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<'leave' | 'summary'>('leave');

  const requestFinish = (generate: boolean) => {
    setLeaveIntent(generate ? 'summary' : 'leave');
    setConfirmLeaveOpen(true);
  };

  const handleConfirmLeave = () => {
    setConfirmLeaveOpen(false);
    const shouldGenerate = (leaveIntent === 'summary' || isLastUser) && !isGuest;
    setFinishMode(shouldGenerate ? 'summary' : 'leave');
    void onFinish(shouldGenerate).finally(() => setFinishMode(null));
  };

  const handleCancelLeave = () => {
    setConfirmLeaveOpen(false);
  };

  const transcriptionState = { connected, isMuted, saveBlocked, speechError, isListening, speechEnabled, interimText, pendingSaves };
  const currentTranscriptionStatus = transcriptionStatus(transcriptionState);

  const handleParticipantAction = async (
    participantId: string,
    action: ParticipantAction
  ) => {
    try {
      await onManageParticipant(participantId, action);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : 'Tindakan terhadap peserta gagal.'
      );
    }
  };

  return (
    <div
      ref={roomRef}
      className={`call-room meeting-layout ${
        panelVisible && !compact ? 'panel-open' : 'panel-closed'
      } ${presentation.focused ? 'presentation-focused' : ''}`}
      style={{
        gridTemplateColumns:
          panelVisible && !compact
            ? `minmax(0, 1fr) 10px ${panelWidth}%`
            : 'minmax(0, 1fr)',
      }}
    >
      <section className={`call-stage ${screenTracks.length ? 'has-screen-share' : ''}`}>
        {policyNotice && (
          <div className="stage-policy-notice" role="status" aria-live="polite">
            <span>{policyNotice}</span>
            <button
              type="button"
              className="stage-policy-notice-close"
              aria-label="Tutup notifikasi"
              onClick={() => setPolicyNotice(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}
        {isManager && waitingPopups.length > 0 && (
          <div className="waiting-room-popups" role="region" aria-label="Notifikasi waiting room">
            {waitingPopups.map(popup => (
              <div className="waiting-room-popup" key={popup.id} role="alert">
                <span><strong>{popup.name}</strong> is in the waiting room.</span>
                <div className="waiting-room-popup-actions">
                  <button
                    type="button"
                    className="waiting-btn admit"
                    disabled={waitingBusyId === popup.id}
                    aria-label={`Terima ${popup.name}`}
                    title="Terima"
                    onClick={() => void handleWaitingAction(popup.id, 'admit')}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    className="waiting-btn deny"
                    disabled={waitingBusyId === popup.id}
                    aria-label={`Tolak ${popup.name}`}
                    title="Tolak"
                    onClick={() => void handleWaitingAction(popup.id, 'deny')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="call-info-bar">
          <div>
            <span className="room-label">#{roomName}</span>
            {roomCode && (
              <span className="room-code-badge" title="5 digit kode ruang rapat">
                Kode: <strong>{roomCode}</strong>
              </span>
            )}
            <span className="call-connection" role="status">
              <i className={connected ? 'status-dot online' : 'status-dot offline'} />
              {connectionLabel}
            </span>
          </div>

          {sharing && (
            <span className="presentation-clock" aria-label="Durasi rapat">
              BaliCall · {callDuration}
            </span>
          )}

          <span className="participant-count">
            <Users size={16} />
            {participants.length} peserta
          </span>
        </div>

        <div className="meeting-view-bar">
          <div className="meeting-view-toggle" role="group" aria-label="Tampilan peserta">
            <button
              type="button"
              aria-pressed={viewMode === 'grid'}
              onClick={() => {
                setViewMode('grid');
                setRequestedPage(0);
              }}
            >
              <Grid2X2 size={16} />
              Grid
            </button>

            <button
              type="button"
              aria-pressed={viewMode === 'speaker'}
              onClick={() => {
                setViewMode('speaker');
                setRequestedPage(0);
              }}
            >
              <UserRound size={16} />
              Speaker
            </button>
          </div>

          <div className="meeting-state-chips">
            <span className={recording ? 'recording-active' : ''} role="status">
              {recording ? '● Merekam' : 'Tidak merekam'}
            </span>
            <span role="status">Transkripsi · {currentTranscriptionStatus.label}</span>
            {callPreferences?.showSecurityBadge !== false && (
              <span role="status" title="Koneksi media WebRTC diamankan dengan enkripsi DTLS-SRTP">
                <ShieldCheck size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
                Terenkripsi
              </span>
            )}
          </div>
        </div>

        {!connected && (
          <div className="connection-notice" role="status">
            {reconnecting
              ? 'Koneksi sedang dipulihkan. Kontrol media tersedia lagi setelah tersambung.'
              : connectionState === ConnectionState.Disconnected
                ? 'Koneksi rapat terputus. Keluar lalu gabung kembali untuk melanjutkan.'
                : 'Menyiapkan koneksi ke ruang rapat…'}
          </div>
        )}

        <StartAudio label="Aktifkan suara peserta" className="audio-playback-button" />

        {finishError && <div className="call-error" role="alert">{finishError}</div>}
        {deviceError && <div className="call-error" role="alert">{deviceError}</div>}

        {recordingError && (
          <div className="call-error" role="alert">
            <span>{recordingError}</span>
            <button
              type="button"
              disabled={busy || recordingPending || !connected}
              onClick={() => void handleToggleRecording()}
            >
              Coba rekaman lagi
            </button>
          </div>
        )}

        {fullScreen.error && (
          <div className="call-error" role="alert">
            <span>{fullScreen.error}</span>
            <button type="button" onClick={fullScreen.clearError}>Tutup</button>
          </div>
        )}

        {microphoneError && <div className="call-error" role="alert">{microphoneError}</div>}

        {cameraError && (
          <div className="call-error camera-error" role="alert">
            <VideoOff size={17} />
            <span>{cameraError}</span>
            <button
              type="button"
              disabled={busy || cameraPending || devicePending || !connected}
              onClick={() => void onToggleCamera()}
            >
              Coba kamera lagi
            </button>
          </div>
        )}

        {cameraBlurError && (
          <div className="call-error camera-error" role="alert">
            <Sparkles size={17} />
            <span>{cameraBlurError}</span>
            {onClearCameraBlurError && (
              <button type="button" onClick={onClearCameraBlurError}>Tutup</button>
            )}
          </div>
        )}

        {screenShareError && <div className="call-error" role="alert">{screenShareError}</div>}

        {!screenShareSupported && (
          <div className="screen-share-hint" role="status">
            Berbagi layar belum tersedia di browser ini. Kamu tetap dapat melihat layar peserta lain.
          </div>
        )}

        <div
          className={`meeting-video-area ${
            screenTracks.length
              ? 'presentation-layout'
              : showingSpeaker
                ? 'speaker-layout'
                : 'grid-layout'
          }`}
        >
          {sharing ? (
            <ScreenShareStage
              tracks={screenTracks}
              room={room}
              focused={presentation.focused}
              showThumbnails={presentation.showThumbnails}
              fullscreen={fullScreen.fullscreen}
              fullscreenPending={fullScreen.pending}
              fullscreenSupported={fullScreen.supported}
              screenShareResolution={screenShareResolution}
              onSelectScreenShareResolution={onSelectScreenShareResolution}
              onFocus={presentation.toggleFocus}
              onThumbnails={presentation.toggleThumbnails}
              onFullscreen={() => void fullScreen.toggle()}
            />
          ) : showingSpeaker ? (
            <div className="speaker-primary">
              <ParticipantLayout
                participants={[spotlight]}
                cameras={camerasByIdentity}
                mirrorLocalVideo={mirrorCamera}
                spotlightIdentity={spotlight.identity}
                raisedHands={raisedHands}
              />
            </div>
          ) : null}

          {(!sharing || presentation.showThumbnails) && (
            <ParticipantLayout
              participants={paging.items}
              cameras={camerasByIdentity}
              mirrorLocalVideo={mirrorCamera}
              strip={sharing || showingSpeaker}
              raisedHands={raisedHands}
            />
          )}

          {!participants.length && (
            <div className="waiting-participants">
              <Loader2 className="ui-spinner" size={30} aria-hidden="true" />
              <p>Menghubungkan peserta ke ruang rapat...</p>
            </div>
          )}
        </div>

        {paging.pages > 1 && (!sharing || presentation.showThumbnails) && (
          <nav className="meeting-pagination" aria-label="Halaman peserta">
            <button
              type="button"
              aria-label="Halaman peserta sebelumnya"
              disabled={paging.page === 0}
              onClick={() => setRequestedPage(paging.page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span aria-live="polite">
              Halaman {paging.page + 1} dari {paging.pages}
            </span>
            <button
              type="button"
              aria-label="Halaman peserta berikutnya"
              disabled={paging.page === paging.pages - 1}
              onClick={() => setRequestedPage(paging.page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </nav>
        )}

        <div className="call-bottom-note">
          <span>
            <AudioLines size={15} />
            Rapat audio &amp; video · Kamera bisa dimatikan kapan saja
          </span>
          <span
            className="mic-level"
            role="meter"
            aria-label="Level mikrofon rapat"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={micVolume}
          >
            <Mic size={14} />
            <i>
              <b style={{ width: `${micVolume}%` }} />
            </i>
          </span>
        </div>
      </section>

      {panelVisible && !compact && (
        <div
          className="meeting-panel-divider"
          role="separator"
          tabIndex={0}
          aria-label="Ubah lebar panel chat dan transkrip"
          aria-orientation="vertical"
          aria-valuemin={Math.round(minPercent)}
          aria-valuemax={42}
          aria-valuenow={Math.round(panelWidth)}
          onPointerDown={event => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = roomRef.current?.getBoundingClientRect();
            if (bounds) {
              resizePanel(((bounds.right - event.clientX) / bounds.width) * 100);
            }
          }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            resizePanel(
              event.key === 'Home'
                ? minPercent
                : event.key === 'End'
                  ? 42
                  : panelWidth + (event.key === 'ArrowLeft' ? 2 : -2)
            );
          }}
        />
      )}

      <MeetingPanel open={panelVisible} compact={compact} onClose={closePanel}>
        <div className="call-panel-tabs" role="tablist" aria-label="Panel rapat">
          <button
            ref={transcriptTab}
            role="tab"
            id={`${tabId}-transcript-tab`}
            aria-controls={`${tabId}-transcript-panel`}
            aria-selected={activeTab === 'transcript'}
            tabIndex={activeTab === 'transcript' ? 0 : -1}
            className={activeTab === 'transcript' ? 'active' : ''}
            onKeyDown={tabKeys}
            onClick={() => setActiveTab('transcript')}
          >
            <MessageSquareText size={17} />
            Chat/Transkrip {transcripts.length > 0 && <span>{transcripts.length}</span>}
          </button>
          <button
            ref={attendanceTab}
            role="tab"
            id={`${tabId}-attendance-tab`}
            aria-controls={`${tabId}-attendance-panel`}
            aria-selected={activeTab === 'attendance'}
            tabIndex={activeTab === 'attendance' ? 0 : -1}
            className={activeTab === 'attendance' ? 'active' : ''}
            onKeyDown={tabKeys}
            onClick={() => setActiveTab('attendance')}
          >
            <Users size={17} />
            Peserta <span>{participants.length}{waitingUsers.length > 0 ? ` +${waitingUsers.length}` : ''}</span>
          </button>
        </div>

        <div
          className="call-tab-panel"
          role="tabpanel"
          id={`${tabId}-transcript-panel`}
          aria-labelledby={`${tabId}-transcript-tab`}
          hidden={activeTab !== 'transcript'}
          tabIndex={0}
        >
          <div className="transcription-bar">
            <details className="transcription-dropdown">
              <summary className="transcription-bar-header" aria-label="Opsi transkripsi">
                <div className="transcription-status" role="status">
                  <i
                    className={currentTranscriptionStatus.tone === 'error' ? 'status-dot offline' : currentTranscriptionStatus.tone === 'active' ? 'status-dot online' : 'status-dot'}
                  />
                  <span>{currentTranscriptionStatus.label}</span>
                </div>
                <span className="transcription-options-btn">
                  <SlidersHorizontal size={12} />
                  <span>Opsi</span>
                  <ChevronDown size={11} className="dropdown-chevron" />
                </span>
              </summary>

              <div className="transcription-dropdown-panel">
                {meetingRole === 'host' && qwenBatchConfigured && (
                  <div className="transcription-dropdown-card">
                    <div className="transcription-card-header">
                      <Sparkles size={13} className="transcription-card-icon" aria-hidden="true" />
                      <strong>Batch pasca-rapat · Qwen + Nemotron</strong>
                    </div>
                    <p className="transcription-card-desc">
                      Rekam audio seluruh peserta sejak awal; kamera tidak direkam. Batch dimulai otomatis setelah semua peserta keluar. Label pembicara berlaku untuk rekaman ini; suara bertumpuk ditandai.
                    </p>
                    <button
                      type="button"
                      className="button-secondary transcription-card-btn"
                      disabled={recording || recordingPending || !connected}
                      onClick={() => {
                        if (!callPreferences?.recordingConsentPrompt || window.confirm('Mulai rekaman audio seluruh peserta untuk batch Qwen + Nemotron setelah rapat?')) void onToggleRecording(true, true);
                      }}
                    >
                      {recording ? 'Rekaman sedang berjalan' : 'Rekam audio untuk batch Qwen'}
                    </button>
                  </div>
                )}

                <div className="transcription-dropdown-field">
                  <label htmlFor="stt-lang-select">Bahasa</label>
                  <select
                    id="stt-lang-select"
                    value={speechLanguage}
                    disabled={busy || sttModel === SEA_LIVE_MODEL}
                    onChange={event =>
                      setSpeechLanguage(event.target.value as 'id-ID' | 'en-US')
                    }
                  >
                    <option value="id-ID">Bahasa Indonesia</option>
                    <option value="en-US">English</option>
                  </select>
                </div>

                <div className="transcription-dropdown-field">
                  <label htmlFor="stt-provider-select">Layanan</label>
                  <select
                    id="stt-provider-select"
                    value={sttProvider}
                    disabled={busy}
                    onChange={event =>
                      setSttProvider(event.target.value as 'browser' | 'server')
                    }
                  >
                    <option value="browser">Browser</option>
                    <option value="server" disabled={!sttConfigured}>
                      Server{!sttConfigured ? ' · belum tersedia' : ''}
                    </option>
                  </select>
                </div>

                <div className="transcription-dropdown-group">
                  <div className="transcription-dropdown-field">
                    <label htmlFor="stt-model-select">Model</label>
                    <select
                      id="stt-model-select"
                      value={sttModel}
                      disabled={
                        busy ||
                        devicePending ||
                        microphonePending ||
                        sttProvider !== 'server' ||
                        !sttConfigured ||
                        !sttModels.length
                      }
                      onChange={event => void onChangeSttModel(event.target.value)}
                    >
                      {!sttModels.length && <option value="">Belum tersedia</option>}
                      <TranscriptionModelOptions models={sttModels} />
                    </select>
                  </div>
                  {(sttModel === 'qwen3-asr-0.6b' || sttModel === 'qwen3-asr-0.6b-live' || sttModel === QWEN_GGUF_LIVE_MODEL || sttModel === MING_LIVE_MODEL || sttModel === SEA_LIVE_MODEL) && (
                    <div className="transcription-model-notice" role="status">
                      <Info size={12} className="transcription-notice-icon" aria-hidden="true" />
                      <div className="transcription-notice-text">
                        {sttModel === 'qwen3-asr-0.6b' && (qwenDiarizationReady ? QWEN_DIARIZATION_NOTICE : QWEN_TRANSCRIPTION_NOTICE)}
                        {sttModel === 'qwen3-asr-0.6b-live' && QWEN_LIVE_DIARIZATION_NOTICE}
                        {sttModel === QWEN_GGUF_LIVE_MODEL && QWEN_GGUF_LIVE_NOTICE}
                        {sttModel === SEA_LIVE_MODEL && SEA_LIVE_NOTICE}
                        {sttModel === MING_LIVE_MODEL && MING_LIVE_NOTICE}
                      </div>
                    </div>
                  )}
                </div>

                {sttProvider === 'browser' && (
                  <p className="transcription-hint-text" role="status">
                    Pilih layanan Server untuk memilih model transkripsi yang tersedia.
                  </p>
                )}
                {modelPending && (
                  <p className="transcription-hint-text" role="status">
                    Menyelesaikan transkrip sebelum mengganti model…
                  </p>
                )}
                {modelError && (
                  <p className="transcription-hint-error" role="alert">{modelError}</p>
                )}
              </div>
            </details>
          </div>

          <TranscriptionStatus state={transcriptionState} warning={speechWarning} />

          {speechError && (
            <div className="transcription-error" role="alert">
              <p>{speechError}</p>
              <button
                disabled={busy || !connected || isMuted || saveBlocked}
                onClick={onToggleTranscription}
              >
                Coba transkripsi lagi
              </button>
            </div>
          )}

          <div
            ref={transcriptListRef}
            onScroll={handleTranscriptScroll}
            className="live-transcript-list"
            role="log"
            aria-label="Chat dan transkrip langsung"
            aria-live="polite"
            aria-relevant="additions"
            tabIndex={0}
          >
            {transcripts.length || meetingFiles.length || raiseHandNotices.length ? (
              [
                ...transcripts.map(entry => ({ kind: 'transcript' as const, sortAt: Date.parse(entry.timestamp) || 0, entry })),
                ...meetingFiles.map(file => ({ kind: 'file' as const, sortAt: Date.parse(file.createdAt) || 0, file })),
                ...raiseHandNotices.map(notice => ({ kind: 'hand' as const, sortAt: Date.parse(notice.timestamp) || 0, notice })),
              ]
                .sort((a, b) => a.sortAt - b.sortAt)
                .flatMap(timelineItem => {
                  if (timelineItem.kind === 'hand') {
                    return [
                      <div className="chat-system-notice" key={timelineItem.notice.id}>
                        <Hand size={13} aria-hidden="true" />
                        <span>{timelineItem.notice.text}</span>
                      </div>,
                    ];
                  }
                  if (timelineItem.kind === 'file') {
                    const file = timelineItem.file;
                    const isLocal = file.uploaderId === employeeId;
                    const timeLabel = new Date(file.createdAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return [
                      <article className={`live-transcript-entry chat-message-item chat-file-item ${isLocal ? 'is-local' : ''}`} key={`file-${file.id}`}>
                        <span className={isLocal ? 'transcript-avatar local' : 'transcript-avatar'}>
                          {initials(file.uploaderName)}
                        </span>
                        <div className="chat-message-bubble">
                          <div className="chat-message-meta">
                            <strong className="transcript-username">
                              {file.uploaderName}
                              {isLocal && <em className="chat-self-tag">Anda</em>}
                            </strong>
                            <div className="chat-meta-right">
                              <span className="transcript-phase final">File</span>
                              <time>{timeLabel}</time>
                            </div>
                          </div>
                          <div className="chat-file-card">
                            <FileText size={18} className="chat-file-icon" aria-hidden="true" />
                            <div className="chat-file-info">
                              <strong title={file.originalFilename}>{file.originalFilename}</strong>
                              <small>{formatFileSize(file.fileSize)}</small>
                            </div>
                            <button
                              type="button"
                              className="chat-file-download"
                              onClick={() => void handleDownloadChatFile(file)}
                              disabled={downloadingFileId === file.id}
                              aria-label={`Unduh ${file.originalFilename}`}
                              title={`Unduh ${file.originalFilename}`}
                            >
                              {downloadingFileId === file.id ? <Loader2 size={14} className="ui-spinner" /> : <Download size={14} />}
                              <span>Unduh</span>
                            </button>
                          </div>
                        </div>
                      </article>,
                    ];
                  }
                  const entry = timelineItem.entry;
                const isLocal = entry.speakerId === employeeId;
                const timeLabel = new Date(entry.timestamp).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                if (entry.segments?.length) {
                  return entry.segments.map((segment, index) => (
                    <article
                      className={`live-transcript-entry chat-message-item diarized ${isLocal ? 'is-local' : ''}`}
                      data-speaker={segment.speaker}
                      key={`${entry.id}-${index}`}
                    >
                      <span
                        className={`transcript-avatar diarized ${isLocal ? 'local' : ''}`}
                        data-speaker={segment.speaker}
                        title={`${entry.speakerName} · ${segment.speaker}`}
                      >
                        {segment.attribution === 'participant' ? initials(entry.speakerName) : segment.speaker ? segment.speaker.replace('Pembicara ', 'P') : initials(entry.speakerName)}
                      </span>
                      <div className="chat-message-bubble">
                        <div className="chat-message-meta">
                          <strong className="transcript-username">
                            {entry.speakerName}
                            {isLocal && <em className="chat-self-tag">Anda</em>}
                          </strong>
                          <time>{timeLabel}</time>
                        </div>
                        <div className="transcript-diarized-row">
                          <span
                            className="transcript-diarized-speaker"
                            data-speaker={segment.speaker}
                          >
                            {speakerDisplayLabel(segment, entry.speakerName)}
                          </span>
                          {onRenameSpeaker && segment.attribution==='assigned' && segment.sourceId && segment.sessionId && (segment.sourceId===employeeId || meetingRole==='host' || meetingRole==='co-host') &&
                            <SpeakerNameEditor sourceId={segment.sourceId} sessionId={segment.sessionId} speaker={segment.speaker} speakerName={segment.speakerName} onSave={onRenameSpeaker} disabled={busy} />}
                          <span className="segment-time-pill">
                            {segment.start.toFixed(1)}s–{segment.end.toFixed(1)}s
                          </span>
                          <span className="transcript-phase final" title="Teks final; status penyimpanan ditampilkan terpisah">Transkrip</span>
                        </div>
                        <p>{segment.text}</p>
                      </div>
                    </article>
                  ));
                }

                return [
                  <article className={`live-transcript-entry chat-message-item ${isLocal ? 'is-local' : ''}`} key={entry.id}>
                    <span
                      className={
                        isLocal
                          ? 'transcript-avatar local'
                          : 'transcript-avatar'
                      }
                    >
                      {initials(entry.speakerName)}
                    </span>
                    <div className="chat-message-bubble">
                      <div className="chat-message-meta">
                        <strong className="transcript-username">
                          {entry.speakerName}
                          {isLocal && <em className="chat-self-tag">Anda</em>}
                        </strong>
                        <div className="chat-meta-right">
                          <span className="transcript-phase final" title="Teks final; status penyimpanan ditampilkan terpisah">Final</span>
                          <time>{timeLabel}</time>
                        </div>
                      </div>
                      <p>{entry.text}</p>
                    </div>
                  </article>,
                ];
                })
            ) : (
              <div className="transcript-empty">
                <span><MessageSquareText size={31} /></span>
                <h3>Chat &amp; Transkrip Rapat</h3>
                <p>
                  Kirim pesan teks melalui kolom chat di bawah atau mulai berbicara untuk menampilkan transkrip suara secara langsung.
                </p>
              </div>
            )}
          </div>

          {interimText && (
            <div className="interim-transcript">
              <AudioLines size={16} />
              <div><strong className="transcript-phase provisional">Sementara · dapat berubah</strong><p>{interimText}</p></div>
            </div>
          )}

          <div
            className={`listening-footer ${isListening ? 'listening' : ''} ${
              isVoiceActive ? 'voice-active' : ''
            }`}
          >
            <div className="waveform" aria-hidden="true">
              {[9, 16, 23, 13, 27, 18, 32, 15, 24, 11, 20, 29, 14, 23, 10, 17].map(
                (height, index) => (
                  <i
                    key={index}
                    style={{
                      height: isVoiceActive
                        ? Math.max(3, Math.round(height * Math.min(1, micVolume / 30)))
                        : 3,
                      animationDelay: `${index * 0.06}s`,
                    }}
                  />
                )
              )}
            </div>
            <span>
              {currentTranscriptionStatus.label}
            </span>
          </div>

          <div className="meeting-chat-bar">
            {!canSendChatByPolicy && (
              <p className="meeting-chat-locked-notice" role="status">Chat dinonaktifkan oleh host.</p>
            )}
            {fileError && (
              <p className="meeting-chat-file-error" role="alert">{fileError}</p>
            )}
            <form
              className="meeting-chat-form"
              onSubmit={event => {
                event.preventDefault();
                if (!canSendChatByPolicy) return;
                if (manualText.trim()) {
                  onAddSpeechLine(manualText.trim());
                  setManualText('');
                  isScrolledToBottomRef.current = true;
                  requestAnimationFrame(() => {
                    if (transcriptListRef.current) {
                      transcriptListRef.current.scrollTo({
                        top: transcriptListRef.current.scrollHeight,
                        behavior: 'smooth',
                      });
                    }
                  });
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={event => void handleChatFileSelected(event)}
              />
              <div className="meeting-chat-input-wrap">
                <MessageSquare size={15} className="meeting-chat-input-icon" aria-hidden="true" />
                <input
                  aria-label="Pesan chat"
                  value={manualText}
                  disabled={busy || saveBlocked || !canSendChatByPolicy}
                  onChange={event => setManualText(event.target.value)}
                  placeholder={canSendChatByPolicy ? 'Ketik pesan chat ke ruang rapat…' : 'Chat dinonaktifkan oleh host'}
                />
              </div>
              <button
                type="button"
                className="meeting-chat-file-button"
                aria-label="Kirim file"
                title="Kirim file (maks. 10 MB)"
                disabled={busy || saveBlocked || uploadingFile || !meetingId || !token || !canSendChatByPolicy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingFile ? <Loader2 size={15} className="ui-spinner" /> : <Paperclip size={15} />}
              </button>
              <button
                type="submit"
                aria-label="Kirim pesan"
                title="Kirim pesan"
                disabled={busy || saveBlocked || !manualText.trim() || !canSendChatByPolicy}
              >
                <Send size={15} />
                <span>Kirim</span>
              </button>
            </form>
          </div>
        </div>

        <div
          className={`call-tab-panel attendance-list ${isManager && (waitingRoomEnabled || waitingUsers.length > 0) ? 'has-waiting-room' : ''}`}
          role="tabpanel"
          id={`${tabId}-attendance-panel`}
          aria-labelledby={`${tabId}-attendance-tab`}
          hidden={activeTab !== 'attendance'}
          tabIndex={0}
        >
          <div className="attendance-in-room">
          <h3>
            Di ruang rapat <span>{participants.length}</span>
          </h3>

          {orderedParticipants.map(participant => {
            const isSelf = participant.identity === employeeId;
            const isHost = participant.identity === meetingHostId;
            const isCoHost = meetingCoHostIds.includes(participant.identity);
            const hasRaisedHand = Boolean(raisedHands[participant.identity]);
            const canManage =
              !isSelf &&
              (meetingRole === 'host' ||
                (meetingRole === 'co-host' && !isHost && !isCoHost));
            const canKick =
              !isSelf &&
              (isSuperAdmin || (meetingRole === 'host' && !isHost && !isCoHost));
            const menuOpen = openParticipantMenuId === participant.identity;

            return (
              <div className={`attendance-entry ${hasRaisedHand ? 'is-hand-raised' : ''}`} key={participant.identity}>
                <span className="transcript-avatar">
                  {initials(participant.name || participant.identity)}
                </span>
                <div className="attendance-entry-main">
                  <strong className="attendance-name-row">
                    <span className="attendance-name-text">
                      {participant.name || participant.identity}
                      {isHost && ' (Host)'}
                      {!isHost && isCoHost && ' (Co-host)'}
                      {isSelf && ' (Anda)'}
                    </span>
                    {hasRaisedHand && (
                      <span className="attendance-hand-badge" title="Mengangkat tangan" aria-label="Mengangkat tangan">
                        <Hand size={12} />
                      </span>
                    )}
                  </strong>
                  <small title={participant.identity}>{participant.identity}</small>
                </div>
                {canManage || canKick ? (
                  <div className="attendance-more-wrap">
                    <button
                      type="button"
                      className="attendance-more-btn"
                      aria-label={`Opsi untuk ${participant.name || participant.identity}`}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      disabled={busy || !connected}
                      onClick={() => setOpenParticipantMenuId(menuOpen ? null : participant.identity)}
                    >
                      <MoreVertical size={15} />
                    </button>
                    {menuOpen && (
                      <div className="attendance-action-menu" role="menu">
                        {canManage && meetingRole === 'host' && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy || !connected}
                            onClick={() => {
                              setOpenParticipantMenuId(null);
                              void handleParticipantAction(
                                participant.identity,
                                isCoHost ? 'demote' : 'promote'
                              );
                            }}
                          >
                            {isCoHost ? 'Turunkan co-host' : 'Jadikan co-host'}
                          </button>
                        )}
                        {canManage && meetingRole === 'host' && !participant.identity.startsWith('GUEST-') && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy || !connected}
                            onClick={() => {
                              setOpenParticipantMenuId(null);
                              if (window.confirm(`Pindahkan peran host kepada ${participant.name || participant.identity}? Anda akan menjadi peserta.`)) {
                                void handleParticipantAction(participant.identity, 'transfer-host');
                              }
                            }}
                          >
                            Jadikan host
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy || !connected}
                            onClick={() => {
                              setOpenParticipantMenuId(null);
                              void handleParticipantAction(participant.identity, 'mute');
                            }}
                          >
                            Mute
                          </button>
                        )}
                        {canManage && pendingSpeakRequests.some(request => request.identity === participant.identity) && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy || !connected}
                            onClick={() => {
                              setOpenParticipantMenuId(null);
                              void handleParticipantAction(participant.identity, 'approve-speak');
                            }}
                          >
                            Izinkan Bicara
                          </button>
                        )}
                        {canKick && (
                          <button
                            type="button"
                            role="menuitem"
                            className="attendance-action-danger"
                            disabled={busy || !connected}
                            onClick={() => {
                              setOpenParticipantMenuId(null);
                              if (window.confirm(`Keluarkan ${participant.name || participant.identity} dari meeting?`)) {
                                if (room?.localParticipant?.publishData) {
                                  const encoded = new TextEncoder().encode(JSON.stringify({ targetId: participant.identity }));
                                  room.localParticipant.publishData(encoded, { reliable: true, topic: 'balicall.kicked.v1' }).catch(() => {});
                                }
                                void handleParticipantAction(participant.identity, 'remove');
                              }
                            }}
                          >
                            Kick
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <Check size={16} />
                )}
              </div>
            );
          })}
          </div>
          {isManager && (waitingRoomEnabled || waitingUsers.length > 0) && (
            <div className="attendance-waiting-room" aria-label="Daftar Waiting Room">
              <h3>
                Waiting Room <span>{waitingUsers.length}</span>
              </h3>
              {waitingUsers.length === 0 ? (
                <p className="waiting-room-empty">Tidak ada peserta yang menunggu.</p>
              ) : (
                waitingUsers.map(user => (
                  <div className="waiting-room-entry" key={user.id}>
                    <span className="transcript-avatar">
                      {initials(user.name)}
                    </span>
                    <div className="waiting-room-entry-info">
                      <strong>{user.name}</strong>
                      <small>{user.isGuest ? 'Tamu' : (user.department || user.id)}</small>
                    </div>
                    <div className="waiting-room-entry-actions">
                      <button
                        type="button"
                        className="waiting-btn admit"
                        disabled={waitingBusyId === user.id}
                        aria-label={`Terima ${user.name}`}
                        title="Terima"
                        onClick={() => void handleWaitingAction(user.id, 'admit')}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="waiting-btn deny"
                        disabled={waitingBusyId === user.id}
                        aria-label={`Tolak ${user.name}`}
                        title="Tolak"
                        onClick={() => void handleWaitingAction(user.id, 'deny')}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </MeetingPanel>

      {speakRequestAt && microphoneRestricted && (
        <p className="speak-request-status" role="status">
          Permintaan izin bicara telah dikirim. Menunggu persetujuan moderator.
        </p>
      )}

      <MeetingControls
        handRaised={Boolean(raisedHands[employeeId])}
        onToggleRaiseHand={toggleRaiseHand}
        canManageMeeting={!employeeId.startsWith('GUEST-')}
        busy={busy}
        connected={connected}
        devicePending={devicePending}
        isMuted={isMuted}
        microphonePending={microphonePending}
        microphoneRestricted={microphoneRestricted}
        speakRequestPending={speakRequestPending}
        onRequestToSpeak={onRequestToSpeak}
        isCameraEnabled={isCameraEnabled}
        cameraPending={cameraPending}
        isScreenShareEnabled={isScreenShareEnabled}
        screenSharePending={screenSharePending}
        screenShareSupported={screenShareSupported && canShareScreenByPolicy}
        isHost={meetingRole === 'host'}
        screenSharePolicy={effectiveScreenSharePolicy}
        chatDisabled={effectiveChatDisabled}
        onChangeScreenSharePolicy={policy => void handleUpdatePermissions({ screenSharePolicy: policy })}
        onToggleChatDisabled={disabled => void handleUpdatePermissions({ chatDisabled: disabled })}
        speechEnabled={speechEnabled}
        speechError={speechError}
        isListening={isListening}
        saveBlocked={saveBlocked}
        finishLabel={finishLabel}
        recording={recording}
        recordingPending={recordingPending}
        onToggleRecording={handleToggleRecording}
        onToggleMute={onToggleMute}
        onToggleCamera={onToggleCamera}
        onToggleScreenShare={onToggleScreenShare}
        onToggleTranscription={onToggleTranscription}
        onOpenDevices={onOpenDevices}
        onParticipants={() => {
          changePanel(true);
          setActiveTab('attendance');
        }}
        transcriptOpen={panelVisible && activeTab === 'transcript'}
        onTranscript={() => {
          changePanel(!panelVisible || activeTab !== 'transcript');
          setActiveTab('transcript');
        }}
        onFinish={requestFinish}
        onOpenBackgrounds={
          backgroundControl
            ? () => {
                changePanel(false);
                setBackgroundsOpen(true);
              }
            : undefined
        }
        isCameraBlur={isCameraBlur}
        cameraBlurPending={cameraBlurPending}
        cameraBlurSupported={cameraBlurSupported}
        onToggleCameraBlur={onToggleCameraBlur}
      />

      {backgroundsOpen && backgroundControl && (
        <BackgroundSettingsDialog
          control={backgroundControl}
          blocked={busy || devicePending || cameraPending || !connected}
          mirror={mirrorLocalVideo}
          onClose={() => setBackgroundsOpen(false)}
        />
      )}

      <LeaveConfirmDialog
        isOpen={confirmLeaveOpen}
        isLastUser={isLastUser}
        isGuest={isGuest}
        intent={leaveIntent}
        busy={busy}
        onConfirm={handleConfirmLeave}
        onCancel={handleCancelLeave}
      />
    </div>
  );
}
