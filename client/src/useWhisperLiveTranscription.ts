import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { startLiveTranscription } from './liveTranscription.ts';

export function useWhisperLiveTranscription(options: {
  muted: boolean; track?: MediaStreamTrack; language: string;
  createSession: (language: string) => Promise<{ url: string }>;
  onFinal: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [changingTrack, setChangingTrack] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const controller = useRef<ReturnType<typeof startLiveTranscription> | null>(null);
  const previousFinish = useRef<Promise<void>>(Promise.resolve());
  const createSession = useEffectEvent(options.createSession);
  const captureFinalCallback = useEffectEvent(() => options.onFinal);
  useEffect(() => {
    if (options.muted || !enabled || changingTrack || !options.track || options.track.readyState === 'ended') return;
    let cancelled = false;
    let live: ReturnType<typeof startLiveTranscription> | undefined;
    const track = options.track, language = options.language;
    // Keep the save destination bound to the meeting that started this stream.
    const onFinal = captureFinalCallback();
    void previousFinish.current.catch(() => {}).then(() => {
      if (cancelled) return;
      setError(null); setInterim('');
      live = startLiveTranscription({ track, createSession: () => createSession(language), onFinal,
        onInterim: text => { if (!cancelled) setInterim(text); },
        onReady: ready => { if (!cancelled) setListening(ready); },
        onError: message => { if (!cancelled) setError(message); },
      });
      controller.current = live;
    });
    return () => {
      cancelled = true;
      if (live) {
        previousFinish.current = live.finish();
        void previousFinish.current.catch(message => setError(message instanceof Error ? message.message : 'Streaming gagal diselesaikan.'));
        if (controller.current === live) controller.current = null;
      }
      setListening(false);
    };
  }, [options.muted, options.track, options.language, enabled, changingTrack, attempt]);
  const flush = useCallback(async () => {
    if (controller.current) await controller.current.finish();
    else await previousFinish.current;
    setInterim(''); setListening(false);
  }, []);
  const prepareTrackChange = useCallback(async () => { await flush(); setChangingTrack(true); }, [flush]);
  const resumeTrackChange = useCallback(() => { setChangingTrack(false); setAttempt(value => value + 1); }, []);
  return {
    isListeningSpeechApi: listening && !options.muted && !error,
    speechEnabled: enabled, speechError: error, interimText: interim,
    prepareTrackChange, resumeTrackChange,
    async finishTranscription() { await flush(); setEnabled(false); },
    toggleSpeechRecognition() {
      if (error || !enabled) { setError(null); setEnabled(true); setAttempt(value => value + 1); }
      else setEnabled(false);
    },
  };
}
