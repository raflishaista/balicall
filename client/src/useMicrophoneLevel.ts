import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioAnalyser } from 'livekit-client';
import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client';

// Keep voice detection at 30 Hz, but avoid rerendering the meeting at that rate.
export function useMicrophoneLevel(track: LocalAudioTrack | RemoteAudioTrack | undefined, enabled: boolean) {
  const [volume, setVolume] = useState(0);
  const latest = useRef(0);
  const readVolume = useCallback(() => latest.current, []);
  useEffect(() => {
    latest.current = 0;
    if (!enabled || !track?.mediaStream) return;
    const { analyser, cleanup } = createAudioAnalyser(track, { fftSize: 32, smoothingTimeConstant: 0 });
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let elapsed = 0;
    const timer = setInterval(() => {
      analyser.getByteFrequencyData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      latest.current = Math.sqrt(sum / samples.length) / 255;
      elapsed += 1000 / 30;
      if (elapsed < 100) return;
      elapsed = 0;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Match the displayed whole-percent meter, avoiding subpixel state churn.
      const next = Math.round(latest.current * 100) / 100;
      setVolume(previous => previous === next ? previous : next);
    }, 1000 / 30);
    return () => { clearInterval(timer); latest.current = 0; cleanup(); };
  }, [track, track?.mediaStream, enabled]);
  return { volume: enabled && track?.mediaStream ? volume : 0, readVolume };
}
