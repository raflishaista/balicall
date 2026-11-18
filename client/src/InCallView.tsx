import { useMicrophoneLevel } from './useMicrophoneLevel';
import { useWhisperLiveTranscription } from './useWhisperLiveTranscription.ts';
import { useState, useEffect, useEffectEvent, useRef, useCallback, useMemo } from 'react';
import { featureError } from './api';
import { resolveTranscriptionPreferences, PREFERENCES_KEY } from './preferences';
import type { ScreenShareResolution } from './preferences';
import { usePreferredAudioOutput } from './usePreferredAudioOutput';
import { TranscriptRealtimeBridge } from './TranscriptRealtimeBridge';
import { useBackendTranscription } from './useBackendTranscription';
import { useSpeechTranscription } from './useSpeechTranscription';
import './App.css';
import { MeetingRoom } from './MeetingRoom';
import { cameraErrorMessage, useCameraControl } from './useCameraControl';
import { useBackgroundBlur } from './useBackgroundBlur';
import { useAiNoiseSuppression } from './useAiNoiseSuppression';
import { useScreenShareControl } from './useScreenShareControl';
import { useDeviceSettings } from './useDeviceSettings';
import { DeviceSettingsDialog } from './DeviceSettingsDialog';
import { supportsSharedMicrophone } from './preferences';
import { SEA_LIVE_MODEL, MING_LIVE_MODEL, QWEN_GGUF_LIVE_MODEL, isLiveTranscriptionModel } from './modelSelection';
import { shouldMirrorCamera } from './backgroundEffects';
import { useSpeakerSpotlight } from './useSpeakerSpotlight';
import { microphoneErrorMessage, useMicrophoneControl } from './useMicrophoneControl';
import { Track, ConnectionState, DisconnectReason, MediaDeviceFailure, ScreenSharePresets } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer, useParticipants, useLocalParticipant, useConnectionState, useTracks, useRoomContext, isTrackReference } from '@livekit/components-react';

export function InCallView({ callDuration,
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
  roomCode,
  employeeId,
  employeeName,
  isSuperAdmin,
  transcripts,
  activeTab,
  setActiveTab,
  onAddSpeechLine,
  onRenameSpeaker,
  onEndMeeting,
  isSummarizing,
  meetingRole,
  participantPanelRequest,
  meetingHostId,
  meetingCoHostIds,
  onManageParticipant,
  onToggleSharedMic,
  onToggleLiveDiarization,
  onToggleBatchDiarization,
  screenSharePolicy,
  chatDisabled,
  onUpdatePermissions,
  onKicked,
}: any) {
  const [mediaOptions] = useState(() => ({
    audioCaptureDefaults: {
      deviceId: joinMedia.microphoneId === 'default' ? undefined : { exact: joinMedia.microphoneId },
      echoCancellation: true,
      noiseSuppression: true,
      // Disable aggressive browser AGC when using a shared conference room microphone
      // to prevent room-noise pumping and initial-consonant clipping on rapid turns.
      autoGainControl: !Boolean(callPreferences?.sharedRoomMic),
      channelCount: 1,
      sampleRate: 48000,
    },
    videoCaptureDefaults: {
      deviceId: joinMedia.cameraId === 'default' ? undefined : { exact: joinMedia.cameraId },
    },
    publishDefaults: {
      simulcast: true,
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      degradationPreference: 'maintain-resolution' as const,
    },
    adaptiveStream: {
      pixelDensity: 'screen' as const,
      pauseVideoInBackground: false,
    },
    dynacast: true,
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
      onDisconnected={reason => {
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
          onKicked?.();
        }
      }}
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
        roomCode={roomCode}
        meetingId={meetingId}
        token={token}
        isSuperAdmin={Boolean(isSuperAdmin)}
        employeeId={employeeId}
        employeeName={employeeName}
        transcripts={transcripts}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onAddSpeechLine={onAddSpeechLine} onRenameSpeaker={onRenameSpeaker}
        onEndMeeting={onEndMeeting}
        isSummarizing={isSummarizing}
        meetingRole={meetingRole}
        participantPanelRequest={participantPanelRequest}
        meetingHostId={meetingHostId}
        meetingCoHostIds={meetingCoHostIds}
        onManageParticipant={onManageParticipant}
        screenSharePolicy={screenSharePolicy}
        chatDisabled={chatDisabled}
        onUpdatePermissions={onUpdatePermissions}
        onKicked={onKicked}
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
  roomCode,
  meetingId,
  token,
  isSuperAdmin,
  meetingRole,
  participantPanelRequest,
  meetingHostId,
  meetingCoHostIds,
  onManageParticipant,
  screenSharePolicy,
  chatDisabled,
  onUpdatePermissions,
  onKicked,
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
  const audioCaptureOptions = useMemo(() => ({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: !Boolean(callPreferences?.sharedRoomMic),
    channelCount: 1,
    sampleRate: 48000,
  }), [callPreferences?.sharedRoomMic]);
  const microphone = useMicrophoneControl(localParticipant, connected, audioCaptureOptions);
  const [aiNoiseSuppression, setAiNoiseSuppression] = useState<boolean>(() => Boolean(callPreferences?.aiNoiseSuppression));
  const noiseSuppression = useAiNoiseSuppression(localParticipant, isMicrophoneEnabled, connected, aiNoiseSuppression);

  const onToggleAiNoiseSuppression = useCallback((enabled: boolean) => {
    setAiNoiseSuppression(enabled);
    if (callPreferences) {
      callPreferences.aiNoiseSuppression = enabled;
      try {
        const raw = localStorage.getItem(PREFERENCES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.preferences = { ...parsed.preferences, aiNoiseSuppression: enabled };
          localStorage.setItem(PREFERENCES_KEY, JSON.stringify(parsed));
        }
      } catch (e) {
        console.warn('Failed to save aiNoiseSuppression preference', e);
      }
    }
  }, [callPreferences]);
  useEffect(() => {
    const mediaStreamTrack = microphoneTrack?.track?.mediaStreamTrack;
    if (!mediaStreamTrack || typeof mediaStreamTrack.applyConstraints !== 'function') return;
    void mediaStreamTrack.applyConstraints({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: !Boolean(callPreferences?.sharedRoomMic),
    }).catch(() => {});
  }, [microphoneTrack?.track?.mediaStreamTrack, callPreferences?.sharedRoomMic]);
  const [screenShareRes, setScreenShareRes] = useState<ScreenShareResolution>(() => callPreferences.screenShareResolution || '1080p');
  const onScreenShareResChange = useCallback((res: ScreenShareResolution) => {
    setScreenShareRes(res);
    callPreferences.screenShareResolution = res;
    try {
      const raw = localStorage.getItem(PREFERENCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.preferences = { ...parsed.preferences, screenShareResolution: res };
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(parsed));
      }
    } catch {}
  }, [callPreferences]);
  const screenShareSupported = window.isSecureContext && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const screenShare = useScreenShareControl(localParticipant, connected, screenShareSupported, screenShareRes, onScreenShareResChange);
  const cameraError = isCameraEnabled ? null : camera.error || (lastCameraError ? cameraErrorMessage(lastCameraError) : null);
  const microphoneError = microphone.error || (!isMicrophoneEnabled && lastMicrophoneError ? microphoneErrorMessage(lastMicrophoneError) : null);
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
  const { volume, readVolume } = useMicrophoneLevel(microphoneTrack?.audioTrack, connected && !isMuted);
  const micVolume = isMuted ? 0 : Math.min(100, Math.round(volume * 100));
  const [speechLanguage, setSpeechLanguage] = useState<'id-ID' | 'en-US'>(() => callPreferences.speechLanguage);
  const [selectedSttModel, setSelectedSttModel] = useState<string | null>(() => resolveTranscriptionPreferences(callPreferences, sttConfigured, sttModels, defaultSttModel, sttProvider).model || null);
  const [transcriptionNotice, setTranscriptionNotice] = useState(() => resolveTranscriptionPreferences(callPreferences, sttConfigured, sttModels, defaultSttModel, sttProvider).notice);
  const [modelPending, setModelPending] = useState(false);
  const [modelError, setModelError] = useState(null as string | null);
  const sttModel = selectedSttModel || defaultSttModel;
  const isLiveModel = isLiveTranscriptionModel(sttModel);
  const paused = isMuted || !connected || isSummarizing || saveBlocked;
  const browserSpeech = useSpeechTranscription({ language: speechLanguage, muted: paused || sttProvider !== 'browser', onFinal: onAddSpeechLine });
  const backendSpeech = useBackendTranscription({ language: speechLanguage, model: sttModel, muted: paused || sttProvider !== 'server' || isLiveModel,
    track: microphoneTrack?.track?.mediaStreamTrack, volume, readVolume, sharedRoomMic: Boolean(callPreferences.sharedRoomMic), onAudio: onAddAudio });
  const liveSpeech = useWhisperLiveTranscription({ language: speechLanguage,
    muted: paused || sttProvider !== 'server' || !isLiveModel,
    track: microphoneTrack?.track?.mediaStreamTrack, createSession: onCreateLiveSession, onFinal: value => onAddSpeechLine(value, sttModel),
    model: sttModel, diarize: ['qwen3-asr-0.6b-live',QWEN_GGUF_LIVE_MODEL,SEA_LIVE_MODEL].includes(sttModel) && Boolean(callPreferences.sharedRoomMic) && (callPreferences.liveDiarization ?? true) });
  const serverSpeech = isLiveModel ? liveSpeech : backendSpeech;
  const changeSttModel = async (model: string) => {
    if (modelPending || finishing || isSummarizing || microphone.pending || model === sttModel || !sttModels.includes(model)) return;
    setModelPending(true); setModelError(null);
    try {
      await serverSpeech.prepareTrackChange();
      setSelectedSttModel(model);
      if (model === MING_LIVE_MODEL) setSpeechLanguage('en-US');
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
      <MeetingRoom
        transcriptionNotice={transcriptionNotice}
        qwenDiarizationReady={qwenDiarizationReady}
        callDuration={callDuration}
        meetingRole={meetingRole}
        participantPanelRequest={participantPanelRequest}
        meetingHostId={meetingHostId}
        meetingCoHostIds={meetingCoHostIds}
        onManageParticipant={onManageParticipant}
        screenSharePolicy={screenSharePolicy}
        chatDisabled={chatDisabled}
        onUpdatePermissions={onUpdatePermissions}
        onKicked={onKicked}
        microphoneRestricted={microphoneRestricted}
        speakRequestPending={speakRequestPending}
        speakRequestAt={speakRequestAt}
        onRequestToSpeak={onRequestToSpeak}
        pendingSpeakRequests={pendingSpeakRequests}
        participants={participants}
        roomName={roomName}
        roomCode={roomCode}
        meetingId={meetingId}
        token={token}
        isSuperAdmin={Boolean(isSuperAdmin)}
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
        screenShareResolution={screenShare.resolution}
        onSelectScreenShareResolution={screenShare.setResolution}
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
          sttModel === MING_LIVE_MODEL && language !== 'en-US'
            ? setModelError('Ming Live hanya mendukung bahasa Inggris. Pilih model lain untuk Bahasa Indonesia.')
            : sttModel === SEA_LIVE_MODEL && language !== 'id-ID'
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
          batchSupported={!sttModel.startsWith('qwen3-asr-') && sttModel !== SEA_LIVE_MODEL && sttModel !== MING_LIVE_MODEL}
          onToggleSharedMic={onToggleSharedMic}
          liveDiarization={callPreferences.liveDiarization ?? true}
          onToggleLiveDiarization={onToggleLiveDiarization}
          batchDiarization={callPreferences.batchDiarization ?? true}
          onToggleBatchDiarization={onToggleBatchDiarization}
          aiNoiseSuppression={aiNoiseSuppression}
          onToggleAiNoiseSuppression={noiseSuppression.supported ? onToggleAiNoiseSuppression : undefined}
          noiseSuppressionActive={noiseSuppression.active}
          noiseSuppressionApplying={noiseSuppression.applying}
          screenShareResolution={screenShare.resolution}
          onSelectScreenShareResolution={screenShare.setResolution}
          onClose={closeDevices}
        />
      )}
    </>
  );
}
