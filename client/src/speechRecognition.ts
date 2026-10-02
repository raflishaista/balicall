export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function startSpeechRecognition(recognition: Recognition, options: {
  language: string;
  onListening: (listening: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}) {
  let disposed = false;
  let wanted = true;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let finishing = false;
  let finishResolve: (() => void) | undefined;
  let finishReject: ((error: Error) => void) | undefined;
  const delivered = new Set<number>();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = options.language;

  const start = () => {
    if (disposed || !wanted) return;
    try {
      recognition.start();
    } catch (error) {
      wanted = false;
      options.onListening(false);
      options.onError(`Cannot start speech recognition: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  recognition.onstart = () => {
    if (disposed || !wanted) return;
    options.onListening(true);
    delivered.clear();
  };
  recognition.onresult = (event) => {
    if (disposed || (!wanted && !finishing)) return;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (result.isFinal) {
        if (text && !delivered.has(i)) {
          delivered.add(i);
          options.onFinal(text);
        }
      } else {
        interim += `${text} `;
      }
    }
    options.onInterim(interim.trim());
  };
  recognition.onerror = ({ error }) => {
    if (disposed) return;
    if (error === 'no-speech') return;
    wanted = false;
    clearTimeout(restartTimer);
    options.onListening(false);
    options.onInterim('');
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone permission blocked. Allow microphone access, then restart transcription.',
      'service-not-allowed': 'Speech recognition service is blocked by your browser or organization.',
      'audio-capture': 'No microphone available for speech recognition. Check your input device.',
      network: 'Speech recognition network error. Browser STT needs access to its online service; voice calls can still work.',
      'language-not-supported': 'The speech service does not support this language. Select another language.',
    };
    options.onError(messages[error] || `Speech recognition stopped: ${error}. Restart transcription to retry.`);
    finishReject?.(new Error(messages[error] || `Speech recognition failed: ${error}`));
    clearTimeout(finishTimer);
  };
  recognition.onend = () => {
    if (disposed) return;
    options.onListening(false);
    options.onInterim('');
    if (finishing) {
      clearTimeout(finishTimer);
      finishResolve?.();
      return;
    }
    if (wanted) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(start, 300);
    }
  };
  start();

  const dispose = () => {
    disposed = true;
    wanted = false;
    clearTimeout(restartTimer);
    clearTimeout(finishTimer);
    finishResolve?.();
    // Detach before abort: cleanup must never trigger another recognition session.
    recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
    try { recognition.abort(); } catch { /* Already stopped. */ }
  };
  return Object.assign(dispose, {
    finish: () => new Promise<void>((resolve, reject) => {
      if (disposed || (!wanted && !finishing)) { resolve(); return; }
      wanted = false;
      finishing = true;
      clearTimeout(restartTimer);
      finishResolve = resolve;
      finishReject = reject;
      finishTimer = setTimeout(() => reject(new Error('Speech recognition did not finish. Wait for the last words, then retry.')), 4000);
      try { recognition.stop(); } catch (error) { clearTimeout(finishTimer); reject(error); }
    }),
  });
}
