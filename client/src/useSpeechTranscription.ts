import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { startSpeechRecognition } from './speechRecognition.ts';
import type { Recognition } from './speechRecognition.ts';

export function useSpeechTranscription({ language, muted, onFinal }: {
  language: string;
  muted: boolean;
  onFinal: (text: string) => void | Promise<void>;
}) {
  const [isListeningSpeechApi, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<ReturnType<typeof startSpeechRecognition> | null>(null);
  const onFinalSpeech = useEffectEvent((text: string) => {
    Promise.resolve(onFinal(text)).catch((error: unknown) => {
      setSpeechError(error instanceof Error ? error.message : 'Gagal menyimpan transkrip.');
    });
  });

  // A changing callback (timer ticks or polling) must not replace the recognizer.
  useEffect(() => {
    if (!speechEnabled || muted) return;
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Capability errors come from the external browser API being initialized here.
      // eslint-disable-next-line react/set-state-in-effect
      setSpeechError('Browser ini tidak mendukung transkripsi suara. Gunakan browser yang mendukung Web Speech atau siapkan transkripsi server.');
      return;
    }
    setSpeechError(null);
    const dispose = startSpeechRecognition(new SpeechRecognition(), {
      language,
      onListening: setListening,
      onInterim: setInterimText,
      onFinal: onFinalSpeech,
      onError: setSpeechError,
    });
    controller.current = dispose;
    return () => {
      dispose();
      controller.current = null;
      setListening(false);
      setInterimText('');
    };
  }, [language, speechEnabled, attempt, muted]);

  const toggleSpeechRecognition = () => {
    if (isListeningSpeechApi || (speechEnabled && !speechError)) {
      setSpeechEnabled(false);
    } else {
      setSpeechEnabled(true);
      setAttempt(value => value + 1);
    }
  };
  const finishTranscription = async () => {
    await controller.current?.finish();
    setSpeechEnabled(false);
  };
  return { isListeningSpeechApi, interimText, speechError, speechEnabled, toggleSpeechRecognition, finishTranscription };
}
