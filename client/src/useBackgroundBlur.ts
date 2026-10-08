import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalParticipant, LocalVideoTrack } from 'livekit-client';
import { Track } from 'livekit-client';
import { BackgroundBlur, supportsBackgroundProcessors } from '@livekit/track-processors';

export interface BackgroundBlurControl {
  isBlurEnabled: boolean;
  blurPending: boolean;
  blurSupported: boolean;
  blurError: string | null;
  toggleBlur: () => Promise<void>;
  clearBlurError: () => void;
}

export function useBackgroundBlur(
  participant: LocalParticipant | undefined,
  isCameraEnabled: boolean,
  connected: boolean,
): BackgroundBlurControl {
  const [isBlurEnabled, setIsBlurEnabled] = useState(false);
  const [blurPending, setBlurPending] = useState(false);
  const [blurError, setBlurError] = useState<string | null>(null);

  const blurSupported = typeof window !== 'undefined' && typeof supportsBackgroundProcessors === 'function'
    ? supportsBackgroundProcessors()
    : false;

  const processorRef = useRef<any>(null);
  const isEnabledRef = useRef(isBlurEnabled);
  isEnabledRef.current = isBlurEnabled;

  const clearBlurError = useCallback(() => {
    setBlurError(null);
  }, []);

  const getCameraTrack = useCallback((): LocalVideoTrack | undefined => {
    if (!participant) return undefined;
    const pub = participant.getTrackPublication(Track.Source.Camera);
    return pub?.track as LocalVideoTrack | undefined;
  }, [participant]);

  const toggleBlur = useCallback(async () => {
    if (!blurSupported) {
      setBlurError('Perangkat atau browser ini belum mendukung efek blur latar belakang.');
      return;
    }

    if (!connected || !isCameraEnabled || blurPending) return;

    const track = getCameraTrack();
    if (!track) {
      setBlurError('Kamera belum aktif. Nyalakan kamera sebelum mengaktifkan blur.');
      return;
    }

    setBlurPending(true);
    setBlurError(null);

    try {
      if (isBlurEnabled) {
        await track.stopProcessor();
        setIsBlurEnabled(false);
      } else {
        if (!processorRef.current) {
          processorRef.current = BackgroundBlur(15);
        }
        await track.setProcessor(processorRef.current);
        setIsBlurEnabled(true);
      }
    } catch (err) {
      console.error('Gagal menerapkan efek blur:', err);
      setBlurError(
        err instanceof Error
          ? `Gagal memproses blur: ${err.message}`
          : 'Gagal memproses efek blur latar belakang.',
      );
    } finally {
      setBlurPending(false);
    }
  }, [blurSupported, connected, isCameraEnabled, blurPending, getCameraTrack, isBlurEnabled]);

  // Re-apply blur if camera was toggled off and back on while blur was enabled
  useEffect(() => {
    if (!connected || !isCameraEnabled || !isEnabledRef.current || !processorRef.current) {
      return;
    }

    const track = getCameraTrack();
    if (track && !track.getProcessor()) {
      void track.setProcessor(processorRef.current).catch(err => {
        console.warn('Re-applying blur processor note:', err);
      });
    }
  }, [connected, isCameraEnabled, getCameraTrack]);

  // Clean up processor when participant disconnects or leaves
  useEffect(() => {
    if (!connected) {
      setIsBlurEnabled(false);
      processorRef.current = null;
    }
  }, [connected]);

  return {
    isBlurEnabled,
    blurPending,
    blurSupported,
    blurError,
    toggleBlur,
    clearBlurError,
  };
}
