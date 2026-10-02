import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
  const controller = useRef<ReturnType<typeof startAudioRecorder> | null>(null);
  const format = typeof MediaRecorder === 'undefined' ? undefined :
    ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
  const capabilityError = !format ? 'This browser cannot record audio in a format supported by backend STT.' : null;
  const onAudio = useEffectEvent((audio: Blob) => options.onAudio(audio, options.language));
  const hasVoice = useEffectEvent(() => options.volume > 0.005);
  const onError = useEffectEvent((message: string) => setError(message));
  useEffect(() => {
    if (options.muted || !enabled || !options.track) return;
    if (!format) return;
    const stream = new MediaStream([options.track]);
    const recorder = startAudioRecorder({
      createRecorder: () => new MediaRecorder(stream, { mimeType: format }),
      hasVoice, onAudio, onError,
    });
    controller.current = recorder;
    return () => { recorder.dispose(); controller.current = null; };
  }, [options.muted, options.track, options.language, enabled, attempt, format]);
  return {
    isListeningSpeechApi: enabled && !options.muted && Boolean(options.track) && !error && !capabilityError,
    interimText: '', speechError: error || (!options.muted && enabled ? capabilityError : null), speechEnabled: enabled,
    toggleSpeechRecognition() {
      if (error || !enabled) { setError(null); setEnabled(true); setAttempt(value => value + 1); }
      else setEnabled(false);
    },
    async finishTranscription() { await controller.current?.finish(); setEnabled(false); },
  };
}
