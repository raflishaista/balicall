import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalParticipant } from 'livekit-client';
import { Track } from 'livekit-client';
import type { LocalTrack } from 'livekit-client';

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Izin kamera belum diberikan. Izinkan kamera di browser, lalu coba lagi. Kamu tetap bisa mengikuti rapat lewat audio.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera tidak ditemukan. Hubungkan kamera, lalu coba lagi. Rapat audio tetap tersedia.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kamera tidak dapat digunakan. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.';
    case 'OverconstrainedError':
      return 'Kamera tidak mendukung pengaturan video ini. Coba kamera lain atau periksa pengaturan browser.';
    default:
      return 'Kamera gagal diaktifkan. Periksa perangkat dan koneksi, lalu coba lagi.';
  }
}

export function useCameraControl(participant: LocalParticipant, connected: boolean, startWithCamera = false) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestPending = useRef(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const pendingTracks = useRef<LocalTrack[]>([]);
  const initialRequested = useRef(false);
  const generation = useRef({ value: 0 });

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
      // A publish request can outlive the room; release capture immediately.
      pendingTracks.current.forEach(track => track.stop());
    };
  }, [connected, participant]);

  const toggleCamera = useCallback(async () => {
    if (!active.current || requestPending.current) return;
    requestPending.current = true;
    const epoch = generation.current.value;
    const isCurrent = () => active.current && generation.current.value === epoch;
    setPending(true);
    setError(null);
    try {
      const enable = !participant.isCameraEnabled;
      const existing = participant.getTrackPublication(Track.Source.Camera);
      let publication;
      if (!enable || existing?.track) {
        if (existing?.track) pendingTracks.current = [existing.track];
        publication = await participant.setCameraEnabled(enable);
      } else {
        // Own the track before publishing, so a late permission result cannot
        // leave the camera running while the SDK waits for a closed connection.
        const tracks = await participant.createTracks({ audio: false, video: true });
        if (!isCurrent()) { tracks.forEach(track => track.stop()); return; }
        pendingTracks.current = tracks;
        const video = tracks.find(track => track.kind === Track.Kind.Video);
        if (!video) throw new Error('Camera track unavailable');
        publication = await participant.publishTrack(video, { source: Track.Source.Camera });
      }
      // Permission may resolve after the user has left the room.
      if (enable && !isCurrent() && publication?.track) {
        publication.track.stop();
        await participant.unpublishTrack(publication.track);
      }
    } catch (cause) {
      pendingTracks.current.forEach(track => track.stop());
      if (isCurrent()) setError(cameraErrorMessage(cause));
    } finally {
      pendingTracks.current = [];
      requestPending.current = false;
      if (mounted.current) setPending(false);
    }
  }, [participant]);

  useEffect(() => {
    if (!startWithCamera || !connected || initialRequested.current) return;
    initialRequested.current = true;
    void toggleCamera();
  }, [connected, startWithCamera, toggleCamera]);

  return { pending, error, toggleCamera };
}
