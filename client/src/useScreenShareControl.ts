import { useCallback, useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import type { LocalParticipant, LocalTrack } from 'livekit-client';

export function screenShareErrorMessage(error: unknown): string {
  switch (error instanceof Error ? error.name : '') {
    case 'NotAllowedError':
    case 'AbortError':
      return 'Berbagi layar dibatalkan atau izin belum diberikan. Klik Bagikan layar untuk mencoba lagi.';
    case 'NotSupportedError':
    case 'DeviceUnsupportedError':
      return 'Browser ini belum mendukung berbagi layar. Gunakan browser desktop yang mendukung fitur ini.';
    case 'NotReadableError':
      return 'Layar tidak dapat dibagikan. Periksa izin perekaman layar pada sistem, lalu coba lagi.';
    case 'InvalidStateError':
      return 'Klik Bagikan layar saat tab rapat aktif untuk memilih layar atau jendela.';
    default:
      return 'Gagal membagikan layar. Periksa koneksi dan coba lagi.';
  }
}

export function useScreenShareControl(participant: LocalParticipant, connected: boolean, supported: boolean) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const active = useRef(false);
  const generation = useRef({ value: 0 });
  const inFlight = useRef(false);
  const captured = useRef<LocalTrack[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    active.current = connected;
    const epoch = generation.current;
    return () => {
      active.current = false;
      epoch.value++;
      captured.current.forEach(track => track.stop());
    };
  }, [connected, participant]);

  const toggleScreenShare = useCallback(async () => {
    if (!active.current || inFlight.current) return;
    if (!supported && !participant.isScreenShareEnabled) {
      setError(screenShareErrorMessage(new DOMException('', 'NotSupportedError')));
      return;
    }
    inFlight.current = true;
    const requestGeneration = generation.current.value;
    const isCurrent = () => active.current && requestGeneration === generation.current.value;
    setPending(true);
    setError(null);
    let tracks: LocalTrack[] = [];
    try {
      if (participant.isScreenShareEnabled) {
        await participant.setScreenShareEnabled(false);
      } else {
        // Capture directly from the click to preserve browser user activation.
        // Own tracks before publishing so leaving during the picker cannot leak capture.
        tracks = await participant.createScreenTracks({ audio: false });
        if (!isCurrent()) { tracks.forEach(track => track.stop()); return; }
        captured.current = tracks;
        const video = tracks.find(track => track.kind === Track.Kind.Video);
        if (!video) throw new Error('Screen share video unavailable');
        const isEnded = () => video.mediaStreamTrack.readyState === 'ended';
        if (isEnded()) { tracks.forEach(track => track.stop()); return; }
        await participant.publishTrack(video, { source: Track.Source.ScreenShare });
        if (!isCurrent() || isEnded()) {
          tracks.forEach(track => track.stop());
          await participant.unpublishTrack(video);
        }
      }
    } catch (cause) {
      tracks.forEach(track => track.stop());
      if (isCurrent()) setError(screenShareErrorMessage(cause));
    } finally {
      captured.current = [];
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, [participant, supported]);

  return { pending, error, toggleScreenShare };
}
