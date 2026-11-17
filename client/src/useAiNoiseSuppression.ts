import { useEffect, useRef, useState, useCallback } from 'react';
import type { LocalAudioTrack, LocalParticipant } from 'livekit-client';
import { ParticipantEvent, Track } from 'livekit-client';
import { RnnoiseAudioProcessor } from './rnnoiseProcessor';

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioCtx({ sampleRate: 48000 });
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

export function useAiNoiseSuppression(
  participant: LocalParticipant | undefined,
  isMicrophoneEnabled: boolean,
  connected: boolean,
  enabled: boolean,
) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const processorRef = useRef<RnnoiseAudioProcessor | null>(null);
  const supported = RnnoiseAudioProcessor.isSupported;

  const applyProcessor = useCallback(async (track: LocalAudioTrack) => {
    if (!supported) return;
    try {
      setApplying(true);
      setError(null);
      if (!(track as unknown as { audioContext?: AudioContext }).audioContext) {
        track.setAudioContext(getSharedAudioContext());
      }
      if (!processorRef.current) {
        processorRef.current = new RnnoiseAudioProcessor();
      }
      const currentProc = track.getProcessor();
      if (currentProc !== processorRef.current) {
        await track.setProcessor(processorRef.current);
      }
      setActive(true);
    } catch (err) {
      console.error('Failed to apply AI noise suppression:', err);
      setError('Peredam kebisingan AI gagal diaktifkan.');
      setActive(false);
    } finally {
      setApplying(false);
    }
  }, [supported]);

  const removeProcessor = useCallback(async (track: LocalAudioTrack) => {
    try {
      setApplying(true);
      if (track.getProcessor()) {
        await track.stopProcessor();
      }
      if (processorRef.current) {
        await processorRef.current.destroy();
        processorRef.current = null;
      }
      setActive(false);
    } catch (err) {
      console.warn('Failed to stop AI noise suppression:', err);
    } finally {
      setApplying(false);
    }
  }, []);

  useEffect(() => {
    if (!connected || !participant || !supported) {
      setActive(false);
      return;
    }

    const getMicTrack = () => {
      const pub = participant.getTrackPublication(Track.Source.Microphone);
      return pub?.track as LocalAudioTrack | undefined;
    };

    const syncTrack = async () => {
      const track = getMicTrack();
      if (!track || !isMicrophoneEnabled) {
        setActive(false);
        return;
      }

      if (enabled) {
        await applyProcessor(track);
      } else {
        await removeProcessor(track);
      }
    };

    void syncTrack();

    const onTrackPublished = (publication: unknown) => {
      const pub = publication as { source?: Track.Source; track?: LocalAudioTrack };
      if (pub.source === Track.Source.Microphone && pub.track && enabled) {
        void applyProcessor(pub.track);
      }
    };

    participant.on(ParticipantEvent.LocalTrackPublished, onTrackPublished);
    return () => {
      participant.off(ParticipantEvent.LocalTrackPublished, onTrackPublished);
    };
  }, [connected, participant, supported, isMicrophoneEnabled, enabled, applyProcessor, removeProcessor]);

  return {
    supported,
    applying,
    active,
    error,
  };
}
