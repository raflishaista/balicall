import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, TrackEvent } from 'livekit-client';
import type { Room } from 'livekit-client';

const kinds: MediaDeviceKind[] = ['audioinput', 'videoinput', 'audiooutput'];
const names = { audioinput: 'Mikrofon', videoinput: 'Kamera', audiooutput: 'Speaker' };

export function deviceErrorMessage(error: unknown, kind?: MediaDeviceKind) {
  const device = kind ? names[kind] : 'Perangkat';
  switch (error instanceof Error ? error.name : '') {
    case 'NotAllowedError': case 'SecurityError':
      return `${device}: izin belum diberikan. Periksa izin browser dan sistem, lalu coba lagi.`;
    case 'NotFoundError': case 'OverconstrainedError':
      return `${device} tidak tersedia. Sambungkan perangkat atau pilih perangkat lain.`;
    case 'NotReadableError': case 'AbortError':
      return `${device} tidak dapat digunakan. Periksa sambungan dan aplikasi lain yang memakai perangkat.`;
    default:
      return `${device} gagal diganti. Periksa perangkat dan coba lagi.`;
  }
}

function activeDevices(room: Room): Record<MediaDeviceKind, string> {
  return Object.fromEntries(kinds.map(kind => {
    const source = kind === 'audioinput' ? Track.Source.Microphone : Track.Source.Camera;
    const track = kind === 'audiooutput' ? undefined : room.localParticipant.getTrackPublication(source)?.track;
    const defaults = kind === 'videoinput' ? room.options.videoCaptureDefaults : room.options.audioCaptureDefaults;
    const constraint = defaults?.deviceId;
    const preferred = typeof constraint === 'string' || Array.isArray(constraint) ? constraint : constraint?.exact || constraint?.ideal;
    const current = track && !track.isMuted ? track.mediaStreamTrack.getSettings().deviceId : undefined;
    // With no camera publication (including while sharing a screen), the SDK
    // stores the next camera preference in capture defaults, not its active map.
    const id = current || (!track && kind !== 'audiooutput' && typeof preferred === 'string' ? preferred : room.getActiveDevice(kind)) || 'default';
    return [kind, id];
  })) as Record<MediaDeviceKind, string>;
}

type OutputMediaDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

export function useDeviceSettings(room: Room, connected: boolean, blocked: boolean, beforeMicrophoneChange: () => Promise<void>, afterMicrophoneChange: () => void) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [active, setActive] = useState(() => activeDevices(room));
  const [pendingKind, setPendingKind] = useState<MediaDeviceKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const connectedRef = useRef(false);
  const request = useRef(false);
  const listSequence = useRef({ value: 0 });
  const epoch = useRef({ value: 0 });
  const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices as OutputMediaDevices | undefined;
  const outputSupported = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';

  const refreshDevices = useCallback(async () => {
    const sequence = ++listSequence.current.value;
    try {
      const available = await (mediaDevices?.enumerateDevices ? mediaDevices.enumerateDevices() : Promise.reject(new Error('enumeration unavailable')));
      if (mounted.current && sequence === listSequence.current.value) {
        setDevices(available); setListError(null); setActive(activeDevices(room));
      }
    } catch {
      if (mounted.current && sequence === listSequence.current.value) setListError('Daftar perangkat belum dapat dibaca. Periksa izin browser, lalu muat ulang daftar.');
    } finally {
      if (mounted.current && sequence === listSequence.current.value) setLoading(false);
    }
  }, [mediaDevices, room]);

  useEffect(() => {
    mounted.current = true;
    const listRequests = listSequence.current;
    const sync = () => { setActive(activeDevices(room)); };
    let cleanTracks = () => {};
    const bindTracks = () => {
      cleanTracks();
      const tracks = [Track.Source.Camera, Track.Source.Microphone].flatMap(source => {
        const track = room.localParticipant.getTrackPublication(source)?.track;
        return track ? [{ track, native: track.mediaStreamTrack }] : [];
      });
      tracks.forEach(({ track, native }) => {
        track.on(TrackEvent.Restarted, onTracksChanged);
        native.addEventListener('ended', sync);
      });
      cleanTracks = () => tracks.forEach(({ track, native }) => {
        track.off(TrackEvent.Restarted, onTracksChanged);
        native.removeEventListener('ended', sync);
      });
    };
    const onTracksChanged = () => { bindTracks(); sync(); };
    const deviceChanged = () => { void refreshDevices(); };
    room.on(RoomEvent.ActiveDeviceChanged, onTracksChanged);
    room.on(RoomEvent.LocalTrackPublished, onTracksChanged);
    room.on(RoomEvent.LocalTrackUnpublished, onTracksChanged);
    room.on(RoomEvent.TrackMuted, sync);
    room.on(RoomEvent.TrackUnmuted, sync);
    mediaDevices?.addEventListener('devicechange', deviceChanged);
    bindTracks();
    void Promise.resolve().then(() => { if (mounted.current) return refreshDevices(); });
    return () => {
      mounted.current = false; listRequests.value++;
      cleanTracks();
      room.off(RoomEvent.ActiveDeviceChanged, onTracksChanged);
      room.off(RoomEvent.LocalTrackPublished, onTracksChanged);
      room.off(RoomEvent.LocalTrackUnpublished, onTracksChanged);
      room.off(RoomEvent.TrackMuted, sync);
      room.off(RoomEvent.TrackUnmuted, sync);
      mediaDevices?.removeEventListener('devicechange', deviceChanged);
    };
  }, [room, mediaDevices, refreshDevices]);
  useEffect(() => {
    connectedRef.current = connected;
    const generation = epoch.current;
    return () => { connectedRef.current = false; generation.value++; };
  }, [connected, room]);

  const performChange = useCallback(async (kind: MediaDeviceKind, choose: () => Promise<string>) => {
    if (!connectedRef.current || blocked || request.current || (kind === 'audiooutput' && !outputSupported)) return;
    request.current = true;
    const generation = epoch.current.value;
    const isCurrent = () => mounted.current && connectedRef.current && epoch.current.value === generation;
    setPendingKind(kind); setError(null); setNotice(null);
    const previous = activeDevices(room)[kind];
    let switching = false;
    let prepared = false;
    try {
      // For selectAudioOutput this invokes the browser prompt in the user gesture.
      const id = await choose();
      if (!isCurrent()) return;
      if (kind === 'audioinput') { prepared = true; await beforeMicrophoneChange(); }
      if (!isCurrent()) return;
      switching = true;
      const success = await room.switchActiveDevice(kind, id);
      if (!success) throw new Error('Device selection did not match');
      if (isCurrent()) {
        setActive(activeDevices(room));
        setNotice(`${names[kind]} berhasil dipilih.${kind === 'audioinput' && !room.localParticipant.isMicrophoneEnabled ? ' Mikrofon tetap nonaktif.' : kind === 'videoinput' && !room.localParticipant.isCameraEnabled ? ' Kamera tetap nonaktif.' : ''}`);
        await refreshDevices();
      }
    } catch (cause) {
      if (isCurrent()) {
        let recovered = false;
        // A failed getUserMedia can end the previous track before throwing.
        // Reacquire the prior choice instead of claiming it is still working.
        if (switching) {
          try { recovered = await room.switchActiveDevice(kind, previous); } catch { /* Show failure and safely mute below. */ }
          if (!recovered && kind !== 'audiooutput' && isCurrent()) {
            try {
              if (kind === 'audioinput') await room.localParticipant.setMicrophoneEnabled(false);
              else await room.localParticipant.setCameraEnabled(false);
            } catch { /* Original selection error remains actionable. */ }
          }
        }
        if (isCurrent()) {
          setActive(activeDevices(room));
          setError(deviceErrorMessage(cause, kind) + (recovered ? ' Pilihan sebelumnya dipulihkan.' : switching && kind !== 'audiooutput' ? ` ${names[kind]} dinonaktifkan; pilih perangkat yang tersedia lalu aktifkan kembali.` : ''));
        }
      }
    } finally {
      if (prepared && mounted.current) afterMicrophoneChange();
      request.current = false;
      if (mounted.current) setPendingKind(null);
    }
  }, [room, blocked, outputSupported, beforeMicrophoneChange, afterMicrophoneChange, refreshDevices]);

  const selectDevice = useCallback((kind: MediaDeviceKind, id: string) => performChange(kind, async () => id), [performChange]);
  const requestOutput = useCallback(() => performChange('audiooutput', async () => {
    if (!mediaDevices?.selectAudioOutput) throw new Error('Output picker unavailable');
    return (await mediaDevices.selectAudioOutput()).deviceId;
  }), [performChange, mediaDevices]);

  return { devices, active, pendingKind, loading, error, listError, notice, outputSupported, outputPickerSupported: Boolean(mediaDevices?.selectAudioOutput), refreshDevices, selectDevice, requestOutput };
}
