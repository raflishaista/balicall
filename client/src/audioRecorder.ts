export interface Recorder {
  mimeType: string;
  state: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

// Each segment is a complete recording with its own container header. A raw
// MediaRecorder timeslice may not be independently decodable by a STT service.
export function startAudioRecorder(options: {
  createRecorder: () => Recorder;
  hasVoice: () => boolean;
  onAudio: (audio: Blob) => void;
  onError: (message: string) => void;
  segmentMs?: number;
  minSegmentMs?: number;
  silenceMs?: number;
  finishTimeoutMs?: number;
}) {
  let recorder: Recorder;
  let disposed = false;
  let finishing = false;
  let segmentTimer: ReturnType<typeof setTimeout> | undefined;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  let finishResolve: (() => void) | undefined;
  let finishReject: ((error: Error) => void) | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => { clearTimeout(segmentTimer); clearInterval(levelTimer); };
  const startSegment = () => {
    if (disposed || finishing) return;
    const chunks: Blob[] = [];
    let heardVoice = options.hasVoice();
    const startedAt = Date.now();
    let lastVoiceAt = startedAt;
    let finalized = false;
    try {
      recorder = options.createRecorder();
      recorder.ondataavailable = ({ data }) => { if (!disposed && !finalized && data.size) chunks.push(data); };
      recorder.onstop = () => {
        clearTimers();
        if (disposed || finalized) return;
        finalized = true;
        heardVoice ||= options.hasVoice();
        if (heardVoice && chunks.length) options.onAudio(new Blob(chunks, { type: recorder.mimeType }));
        if (finishing) { clearTimeout(finishTimer); finishResolve?.(); }
        else startSegment();
      };
      recorder.onerror = () => {
        disposed = true;
        clearTimers();
        options.onError('Perekaman audio gagal. Periksa izin mikrofon lalu mulai ulang transkripsi.');
        finishReject?.(new Error('Perekaman audio gagal'));
        clearTimeout(finishTimer);
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.start();
      levelTimer = setInterval(() => {
        const now = Date.now();
        if (options.hasVoice()) { heardVoice = true; lastVoiceAt = now; }
        if (heardVoice && now - startedAt >= (options.minSegmentMs ?? 1200) &&
            now - lastVoiceAt >= (options.silenceMs ?? 600) && recorder.state !== 'inactive') recorder.stop();
      }, 100);
      segmentTimer = setTimeout(() => {
        heardVoice ||= options.hasVoice();
        if (recorder.state !== 'inactive') recorder.stop();
      }, options.segmentMs ?? 3000);
    } catch {
      disposed = true;
      clearTimers();
      clearTimeout(finishTimer);
      options.onError('Browser ini tidak dapat merekam audio untuk transkripsi server. Coba browser yang didukung.');
    }
  };
  startSegment();
  return {
    dispose() {
      disposed = true;
      clearTimers();
      clearTimeout(finishTimer);
      if (recorder) {
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      finishResolve?.();
    },
    finish: () => new Promise<void>((resolve, reject) => {
      if (disposed || !recorder || recorder.state === 'inactive') { resolve(); return; }
      finishing = true;
      finishResolve = resolve;
      finishReject = reject;
      clearTimers();
      finishTimer = setTimeout(() => reject(new Error('Perekam audio belum selesai. Coba lagi sebelum meninggalkan rapat.')), options.finishTimeoutMs ?? 4000);
      recorder.stop();
    }),
  };
}
