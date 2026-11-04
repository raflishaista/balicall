import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenSharePresets, Track } from 'livekit-client';
import type { LocalParticipant, LocalTrack } from 'livekit-client';
import type { ScreenShareResolution } from './preferences';

export { type ScreenShareResolution };

export interface ScreenSharePresetConfig {
  id: ScreenShareResolution;
  label: string;
  detail: string;
  resolution?: { width: number; height: number };
  encoding: { maxBitrate: number; maxFramerate: number; priority?: RTCPriorityType };
}

export const SCREEN_SHARE_PRESETS: Record<ScreenShareResolution, ScreenSharePresetConfig> = {
  '360p': {
    id: '360p',
    label: '360p (Hemat Kuota)',
    detail: '640×360 • 15 FPS • ~400 kbps',
    resolution: ScreenSharePresets.h360fps15.resolution,
    encoding: ScreenSharePresets.h360fps15.encoding,
  },
  '540p': {
    id: '540p',
    label: '540p (Standar)',
    detail: '960×540 • 15 FPS • ~800 kbps',
    resolution: { width: 960, height: 540 },
    encoding: { maxBitrate: 800000, maxFramerate: 15, priority: 'medium' },
  },
  '720p': {
    id: '720p',
    label: '720p (HD)',
    detail: '1280×720 • 15 FPS • ~1.5 Mbps',
    resolution: ScreenSharePresets.h720fps15.resolution,
    encoding: ScreenSharePresets.h720fps15.encoding,
  },
  '1080p': {
    id: '1080p',
    label: '1080p (Full HD - Tajam)',
    detail: '1920×1080 • 15 FPS • ~2.5 Mbps',
    resolution: ScreenSharePresets.h1080fps15.resolution,
    encoding: ScreenSharePresets.h1080fps15.encoding,
  },
  '1440p': {
    id: '1440p',
    label: '1440p (2K Quad HD)',
    detail: '2560×1440 • 15 FPS • ~5.0 Mbps',
    resolution: { width: 2560, height: 1440 },
    encoding: { maxBitrate: 5000000, maxFramerate: 15, priority: 'medium' },
  },
  'original': {
    id: 'original',
    label: 'Asli (Resolusi Layar Penuh)',
    detail: 'Resolusi layar native • 30 FPS • ~7.0 Mbps',
    resolution: undefined,
    encoding: ScreenSharePresets.original.encoding,
  },
};

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

export function useScreenShareControl(
  participant: LocalParticipant,
  connected: boolean,
  supported: boolean,
  initialResolution: ScreenShareResolution = '1080p',
  onResolutionChange?: (resolution: ScreenShareResolution) => void,
) {
  const [resolution, setResolutionState] = useState<ScreenShareResolution>(initialResolution);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const active = useRef(false);
  const generation = useRef({ value: 0 });
  const inFlight = useRef(false);
  const captured = useRef<LocalTrack[]>([]);

  useEffect(() => {
    setResolutionState(initialResolution);
  }, [initialResolution]);

  const setResolution = useCallback((next: ScreenShareResolution) => {
    setResolutionState(next);
    onResolutionChange?.(next);
  }, [onResolutionChange]);

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

  const toggleScreenShare = useCallback(async (targetResolution?: ScreenShareResolution) => {
    if (!active.current || inFlight.current) return;
    if (!supported && !participant.isScreenShareEnabled) {
      setError(screenShareErrorMessage(new DOMException('', 'NotSupportedError')));
      return;
    }
    const chosenRes = targetResolution || resolution;
    if (targetResolution && targetResolution !== resolution) {
      setResolutionState(targetResolution);
      onResolutionChange?.(targetResolution);
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
        const preset = SCREEN_SHARE_PRESETS[chosenRes] || SCREEN_SHARE_PRESETS['1080p'];
        // Capture directly from the click to preserve browser user activation.
        // Request 'detail' contentHint and configured preset resolution to prioritize sharp text over framerate drops.
        // Own tracks before publishing so leaving during the picker cannot leak capture.
        tracks = await participant.createScreenTracks({
          audio: false,
          contentHint: 'detail',
          resolution: preset.resolution,
        });
        if (!isCurrent()) { tracks.forEach(track => track.stop()); return; }
        captured.current = tracks;
        const video = tracks.find(track => track.kind === Track.Kind.Video);
        if (!video) throw new Error('Screen share video unavailable');
        if (video.mediaStreamTrack && 'contentHint' in video.mediaStreamTrack) {
          try {
            video.mediaStreamTrack.contentHint = 'detail';
          } catch {
            // Ignore if browser restricts runtime contentHint assignment
          }
        }
        const isEnded = () => video.mediaStreamTrack.readyState === 'ended';
        if (isEnded()) { tracks.forEach(track => track.stop()); return; }
        // Publish without simulcast downscaling and with 'maintain-resolution' degradation preference.
        // This prevents the browser encoder from halving resolution into blurry text when movement occurs.
        await participant.publishTrack(video, {
          source: Track.Source.ScreenShare,
          simulcast: false,
          degradationPreference: 'maintain-resolution',
          screenShareEncoding: preset.encoding,
        });
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
  }, [participant, supported, resolution, onResolutionChange]);

  return { pending, error, resolution, setResolution, toggleScreenShare };
}
