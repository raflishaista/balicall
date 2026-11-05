import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenSharePresets, Track, VideoPreset } from 'livekit-client';
import type { LocalParticipant, LocalTrack, LocalVideoTrack } from 'livekit-client';
import type { ScreenShareResolution } from './preferences';

export { type ScreenShareResolution };

export interface ScreenSharePresetConfig {
  id: ScreenShareResolution;
  label: string;
  detail: string;
  resolution?: { width: number; height: number };
  encoding: { maxBitrate: number; maxFramerate?: number; priority?: RTCPriorityType };
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
    detail: '1920×1080 • 15 FPS • ~3.5 Mbps',
    resolution: ScreenSharePresets.h1080fps15.resolution,
    encoding: { maxBitrate: 3500000, maxFramerate: 15, priority: 'medium' },
  },
  '1440p': {
    id: '1440p',
    label: '1440p (2K Quad HD)',
    detail: '2560×1440 • 15 FPS • ~6.0 Mbps',
    resolution: { width: 2560, height: 1440 },
    encoding: { maxBitrate: 6000000, maxFramerate: 15, priority: 'medium' },
  },
  '4k': {
    id: '4k',
    label: '4K (Ultra HD - 2160p)',
    detail: '3840×2160 • 15 FPS • ~9.0 Mbps',
    resolution: { width: 3840, height: 2160 },
    encoding: { maxBitrate: 9000000, maxFramerate: 15, priority: 'medium' },
  },
  'original': {
    id: 'original',
    label: 'Asli (Resolusi Layar Penuh • Native)',
    detail: 'Resolusi layar native • 30 FPS • ~9.0 Mbps',
    resolution: undefined,
    encoding: { maxBitrate: 9000000, maxFramerate: 30, priority: 'medium' },
  },
};

export function getScreenShareSimulcastLayers(res: ScreenShareResolution): VideoPreset[] {
  switch (res) {
    case '360p':
      return [];
    case '540p':
      return [ScreenSharePresets.h360fps15];
    case '720p':
      return [
        ScreenSharePresets.h360fps15,
        new VideoPreset(960, 540, 800000, 15, 'medium'),
      ];
    case '1080p':
      return [
        ScreenSharePresets.h360fps15,
        ScreenSharePresets.h720fps15,
      ];
    case '1440p':
    case '4k':
    case 'original':
    default:
      return [
        ScreenSharePresets.h720fps15,
        ScreenSharePresets.h1080fps15,
      ];
  }
}

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

  const setResolution = useCallback(async (next: ScreenShareResolution) => {
    setResolutionState(next);
    onResolutionChange?.(next);

    if (participant?.isScreenShareEnabled) {
      if (typeof participant.setAttributes === 'function') {
        participant.setAttributes({ screenShareResolution: next }).catch(() => {});
      }
      try {
        const pub = participant.getTrackPublication(Track.Source.ScreenShare);
        const videoTrack = pub?.track as LocalVideoTrack | undefined;
        const preset = SCREEN_SHARE_PRESETS[next] || SCREEN_SHARE_PRESETS['1080p'];
        if (videoTrack?.mediaStreamTrack && typeof videoTrack.mediaStreamTrack.applyConstraints === 'function') {
          if (preset.resolution) {
            await videoTrack.mediaStreamTrack.applyConstraints({
              width: { ideal: preset.resolution.width, max: preset.resolution.width },
              height: { ideal: preset.resolution.height, max: preset.resolution.height },
              frameRate: { ideal: preset.encoding.maxFramerate, max: preset.encoding.maxFramerate },
            }).catch(() => {});
          }
        }
        if (videoTrack?.sender && typeof videoTrack.sender.getParameters === 'function' && typeof videoTrack.sender.setParameters === 'function') {
          const params = videoTrack.sender.getParameters();
          if (params?.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = preset.encoding.maxBitrate;
            params.encodings[0].maxFramerate = preset.encoding.maxFramerate;
            let scale = 1;
            if (next === '1080p') scale = 1;
            else if (next === '720p') scale = 1.5;
            else if (next === '540p') scale = 2;
            else if (next === '360p') scale = 3;
            params.encodings[0].scaleResolutionDownBy = scale;
            await videoTrack.sender.setParameters(params).catch(() => {});
          }
        }
      } catch {
        // Safe fallback if browser or platform restricts runtime stream reconfiguration
      }
    }
  }, [participant, onResolutionChange]);

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
        if (typeof participant.setAttributes === 'function') {
          participant.setAttributes({ screenShareResolution: '' }).catch(() => {});
        }
      } else {
        const preset = SCREEN_SHARE_PRESETS[chosenRes] || SCREEN_SHARE_PRESETS['1080p'];
        // Capture directly from the click to preserve browser user activation.
        // Request 'detail' contentHint and configured preset resolution to prioritize sharp text over framerate drops.
        // For 'original', resolution is undefined so native screen resolution is captured without downscaling.
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
        // Publish with simulcast enabled and screenShareSimulcastLayers configured
        // so viewers can choose their preferred quality level (original, 4k, 1440p, 1080p, 720p, 540p, 360p).
        const simulcastLayers = getScreenShareSimulcastLayers(chosenRes);
        await participant.publishTrack(video, {
          source: Track.Source.ScreenShare,
          name: `screen_share:${chosenRes}`,
          simulcast: true,
          degradationPreference: 'maintain-resolution',
          screenShareEncoding: preset.encoding,
          screenShareSimulcastLayers: simulcastLayers,
        });
        if (typeof participant.setAttributes === 'function') {
          participant.setAttributes({ screenShareResolution: chosenRes }).catch(() => {});
        }
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
