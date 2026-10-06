import { useCallback, useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import type { LocalParticipant, LocalTrack } from 'livekit-client';

export function useMicrophoneControl(participant: LocalParticipant, connected: boolean) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), active = useRef(false), inFlight = useRef(false);
  const generation = useRef({ value: 0 });
  const captured = useRef<LocalTrack[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    active.current = connected;
    const epoch = generation.current;
    return () => { active.current = false; epoch.value++; captured.current.forEach(track => track.stop()); };
  }, [participant, connected]);
  const toggleMicrophone = useCallback(async () => {
    if (!active.current || inFlight.current) return;
    inFlight.current = true;
    const epoch = generation.current.value;
    const isCurrent = () => active.current && generation.current.value === epoch;
    setPending(true); setError(null);
    const enable = !participant.isMicrophoneEnabled;
    try {
      const existing = participant.getTrackPublication(Track.Source.Microphone);
      let publication;
      if (!enable || existing?.track) {
        if (enable && existing?.track) captured.current = [existing.track];
        publication = await participant.setMicrophoneEnabled(enable);
      } else {
        const tracks = await participant.createTracks({ audio: true, video: false });
        if (!isCurrent()) { tracks.forEach(track => track.stop()); return; }
        captured.current = tracks;
        const audio = tracks.find(track => track.kind === Track.Kind.Audio);
        if (!audio) throw new Error('No microphone track');
        publication = await participant.publishTrack(audio, { source: Track.Source.Microphone });
      }
      if (enable && !isCurrent() && publication?.track) {
        publication.track.stop(); await participant.unpublishTrack(publication.track);
      }
    } catch {
      captured.current.forEach(track => track.stop());
      if (isCurrent()) setError('Mikrofon belum dapat diubah. Periksa perangkat dan izin browser, lalu coba lagi.');
    } finally {
      captured.current = []; inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, [participant]);
  return { pending, error, toggleMicrophone };
}
