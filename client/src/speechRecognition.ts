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
      options.onError(`Transkripsi tidak dapat dimulai: ${error instanceof Error ? error.message : String(error)}`);
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
      'not-allowed': 'Izin mikrofon ditolak. Izinkan akses mikrofon, lalu mulai ulang transkripsi.',
      'service-not-allowed': 'Layanan pengenalan ucapan diblokir oleh browser atau jaringan organisasi.',
      'audio-capture': 'Mikrofon tidak tersedia untuk transkripsi. Periksa perangkat input.',
      network: 'Layanan transkripsi browser gagal dijangkau (network). Koneksi suara rapat masih bisa berfungsi.',
      'language-not-supported': 'Bahasa ini tidak didukung layanan transkripsi. Pilih bahasa lain.',
    };
    options.onError(messages[error] || `Transkripsi berhenti (${error}). Mulai ulang untuk mencoba lagi.`);
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
