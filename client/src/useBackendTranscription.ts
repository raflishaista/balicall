import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { startAudioRecorder } from './audioRecorder.ts';

export function useBackendTranscription(options: {
  muted: boolean;
  track?: MediaStreamTrack;
  language: string;
  volume: number;
  onAudio: (audio: Blob, language: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [changingTrack, setChangingTrack] = useState(false);
  const controller = useRef<ReturnType<typeof startAudioRecorder> | null>(null);
  const flushing = useRef<Promise<void> | null>(null);
  const format = typeof MediaRecorder === 'undefined' ? undefined :
    ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
  const capabilityError = !format ? 'Browser ini tidak dapat merekam audio dalam format yang didukung transkripsi server.' : null;
  const onAudio = useEffectEvent((audio: Blob) => options.onAudio(audio, options.language));
  const hasVoice = useEffectEvent(() => options.volume > 0.005);
  const onError = useEffectEvent((message: string) => setError(message));
  useEffect(() => {
    if (options.muted || changingTrack || !enabled || !options.track || options.track.readyState === 'ended') return;
    if (!format) return;
    const stream = new MediaStream([options.track]);
    const recorder = startAudioRecorder({
      createRecorder: () => new MediaRecorder(stream, { mimeType: format }),
      hasVoice, onAudio, onError,
    });
    controller.current = recorder;
    return () => { recorder.dispose(); controller.current = null; };
  }, [options.muted, options.track, options.language, enabled, attempt, format, changingTrack]);
  const flushRecorder = useCallback(() => {
    if (flushing.current) return flushing.current;
    const pending = (controller.current?.finish() || Promise.resolve()).finally(() => {
      if (flushing.current === pending) flushing.current = null;
    });
    flushing.current = pending;
    return pending;
  }, []);
  const prepareTrackChange = useCallback(async () => {
    await flushRecorder();
    setChangingTrack(true);
  }, [flushRecorder]);
  const resumeTrackChange = useCallback(() => {
    setChangingTrack(false);
    setAttempt(value => value + 1);
  }, []);
  return {
    isListeningSpeechApi: enabled && !options.muted && !changingTrack && Boolean(options.track) && options.track?.readyState !== 'ended' && !error && !capabilityError,
    interimText: '', speechError: error || (!options.muted && enabled ? capabilityError : null), speechEnabled: enabled,
    toggleSpeechRecognition() {
      if (error || !enabled) { setError(null); setEnabled(true); setAttempt(value => value + 1); }
      else setEnabled(false);
    },
    async finishTranscription() { await flushRecorder(); setEnabled(false); },
    prepareTrackChange, resumeTrackChange,
  };
}
