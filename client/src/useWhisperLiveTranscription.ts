import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { startLiveTranscription } from './liveTranscription.ts';
import type { LiveFinal } from './liveTranscription.ts';

export function useWhisperLiveTranscription(options: {
  muted: boolean; track?: MediaStreamTrack; language: string; model?: string; diarize?: boolean;
  createSession: (language: string, model?: string, diarize?: boolean, streamId?: string) => Promise<{ url: string }>;
  onFinal: (text: LiveFinal) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [changingTrack, setChangingTrack] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const controller = useRef<ReturnType<typeof startLiveTranscription> | null>(null);
  const previousFinish = useRef<Promise<void>>(Promise.resolve());
  const retainedController = useRef<ReturnType<typeof startLiveTranscription> | null>(null);
  const microphone = useRef<{device: string; id: string} | null>(null);
  const previousSession = useRef<{scope: string; id: string} | null>(null);
  const retries = useRef(0);
  const ending = useRef(false);
  const createSession = useEffectEvent(options.createSession);
  const captureFinalCallback = useEffectEvent(() => options.onFinal);
  useEffect(() => {
    if (options.muted || !enabled || changingTrack || !options.track || options.track.readyState === 'ended') return;
    let cancelled = false;
    let live: ReturnType<typeof startLiveTranscription> | undefined;
    const track = options.track, language = options.language, model = options.model, diarize = options.diarize;
    const resumable = model === 'qwen3-asr-0.6b-live';
    const device = track.getSettings?.().deviceId || track.id;
    if (!microphone.current || microphone.current.device !== device) {
      microphone.current = {device,id:crypto.randomUUID()};
      previousSession.current=null;
    }
    const streamId = resumable ? microphone.current.id : undefined;
    const scope = `${streamId}:${language}:${diarize}`;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    // Keep the save destination bound to the meeting that started this stream.
    const onFinal = captureFinalCallback();
    void previousFinish.current.catch(() => {}).then(() => {
      if (cancelled) return;
      setError(null); setWarning(null); setInterim('');
      live = startLiveTranscription({ track, createSession: () => createSession(language, model, diarize, streamId), onFinal,
        onInterim: text => { if (!cancelled) setInterim(text); },
        onReady: ready => {
          if (cancelled) return;
          setListening(ready);
          clearTimeout(stableTimer);
          if (ready) stableTimer=setTimeout(()=>{retries.current=0;},3000);
        },
        onError: message => {
          if (cancelled) return;
          clearTimeout(stableTimer);
          if (resumable && !ending.current && retries.current<3) {
            const count=++retries.current;
            setError(`${message} Menyambung ulang (${count}/3)…`);
            retryTimer=setTimeout(()=>{if(!cancelled)setAttempt(value=>value+1);},1000*2**(count-1));
          } else setError(message);
        },
        onWarning: message => { if (!cancelled) setWarning(message); },
        onSession: session => {
          if (cancelled || !session.sessionId) return;
          if (previousSession.current?.scope===scope && previousSession.current.id!==session.sessionId) {
            setWarning('Sesi pembicara sebelumnya sudah berakhir. Label dan nama untuk sesi baru perlu diperiksa lagi.');
          }
          previousSession.current={scope,id:session.sessionId};
        },
      });
      controller.current = live;
      retainedController.current=null;
    });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer); clearTimeout(stableTimer);
      if (live) {
        previousFinish.current = live.finish({pause:resumable && !ending.current});
        if (resumable && !ending.current) retainedController.current=live;
        void previousFinish.current.catch(message => setError(message instanceof Error ? message.message : 'Streaming gagal diselesaikan.'));
        if (controller.current === live) controller.current = null;
      }
      setListening(false);
    };
  }, [options.muted, options.track, options.language, options.model, options.diarize, enabled, changingTrack, attempt]);
  const flush = useCallback(async () => {
    const live=controller.current || retainedController.current;
    if (live) await live.finish();
    else await previousFinish.current;
    retainedController.current=null;
    setInterim(''); setListening(false);
  }, []);
  const prepareTrackChange = useCallback(async () => { await flush(); microphone.current=null; setChangingTrack(true); }, [flush]);
  const resumeTrackChange = useCallback(() => { setChangingTrack(false); setAttempt(value => value + 1); }, []);
  return {
    isListeningSpeechApi: listening && !options.muted && !error,
    speechEnabled: enabled, speechError: error || warning, interimText: interim,
    prepareTrackChange, resumeTrackChange,
    async finishTranscription() { ending.current=true; await flush(); setEnabled(false); },
    toggleSpeechRecognition() {
      if (error || warning || !enabled) { ending.current=false; retries.current=0; setError(null); setWarning(null); setEnabled(true); setAttempt(value => value + 1); }
      else setEnabled(false);
    },
  };
}
