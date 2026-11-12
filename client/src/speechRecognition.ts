export interface RecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export interface RecognitionResultItem {
  isFinal: boolean;
  length?: number;
  [index: number]: RecognitionAlternative;
}

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResultItem>;
}

export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const BROWSER_ORTHOGRAPHIC_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(bali\s*tower|balitower)\b/gi, 'Bali Tower'],
  [/\blive\s*kit\b/gi, 'LiveKit'],
  [/\bwebrtc\b/gi, 'WebRTC'],
  [/\b(?:grad\s*cam|gerak\s*cam|grap\s*cam|grab\s*cam|great\s*cam|grand\s*cam|grade\s*cam)\b/gi, 'Grad-CAM'],
  [/\b(?:dino\s*v\s*2|di\s*nov\s*2|di\s*novel\s*2|dinov2)\b/gi, 'DINOv2'],
  [/\b(?:dino\s*v\s*3|di\s*nov\s*3|di\s*novel\s*3|dinov3)\b/gi, 'DINOv3'],
  [/\b(?:yolo\s*v?\s*12\s*s|yolov12s)\b/gi, 'YOLOv12s'],
  [/\b(?:yolo\s*v?\s*12|yolov12)\b/gi, 'YOLOv12'],
  [/\b(?:yolo\s*v?\s*11\s*s|yolov11s)\b/gi, 'YOLOv11s'],
  [/\b(?:yolo\s*v?\s*11|yolov11)\b/gi, 'YOLOv11'],
  [/\b(?:yolo\s*v?\s*8|yolov8)\b/gi, 'YOLOv8'],
  [/\b(?:rf[\s-]*detr\s*seg|rfd\s*tr\s*sec|rfd\s*tr\s*sex|rf\s*dtr\s*seg)\b/gi, 'RF-DETR Seg'],
  [/\b(?:rf[\s-]*detr|rfd\s*tr|rf\s*dtr)\b/gi, 'RF-DETR'],
  [/\b(?:rt[\s-]*detr|rtd\s*tr|rt\s*dtr)\b/gi, 'RT-DETR'],
  [/\b(?:focal\s*loss|vokal\s*los|fokal\s*los|focal\s*los)\b/gi, 'Focal Loss'],
  [/\b(?:rapid\s*ocr|rapit\s*ocr|rapidocr)\b/gi, 'RapidOCR'],
  [/\bnilai\s+agamanya\b/gi, 'nilai gammanya'],
];

const DOMAIN_TERM_BONUSES: Array<[RegExp, number]> = [
  [/\b(?:Grad-CAM|DINOv2|DINOv3|YOLOv\d+[a-z]?|RF-DETR|RT-DETR|Focal Loss|RapidOCR|LiveKit|WebRTC|Bali Tower)\b/i, 3],
  [/\b(?:dataset|model|epoch|training|evaluasi|akurasi|segmen(?:tasi)?|deteksi|bounding\s*box|threshold|gamma|loss|inferensi|pipeline|benchmark|fine[\s-]*tun(?:ing|e)|pre[\s-]*train(?:ed)?|backbone|embedding|clustering|klasifikasi|anomali|annotasi|anotasi)\b/i, 1.5],
  [/\b(?:CVAT|KNN|PCA|t-SNE|UMAP|SGD|AdamW|ResNet|ViT|ONNX|TensorRT|PyTorch|OpenCV|OCR)\b/i, 2],
];

const PHONETIC_MISHEARING_PENALTIES: Array<[RegExp, number]> = [
  [/\b(?:nilai\s+agamanya|gerak\s+cam|vokal\s+los|di\s+novel\s+[23]|rfd\s+tr\s+sex)\b/i, -2.5],
];

export function normalizeBrowserSpeechText(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, replacement] of BROWSER_ORTHOGRAPHIC_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function selectBestAlternative(result: RecognitionResultItem): string {
  const count = typeof result.length === 'number' && result.length > 0 ? result.length : 1;
  let bestText = '';
  let bestScore = -Infinity;

  for (let idx = 0; idx < count; idx++) {
    const alt = result[idx];
    const raw = alt?.transcript?.trim() ?? '';
    if (!raw) continue;
    const normalized = normalizeBrowserSpeechText(raw);
    const confidence = typeof alt.confidence === 'number' && alt.confidence > 0 ? alt.confidence : 0.8 - idx * 0.05;
    let score = confidence;

    for (const [pattern, bonus] of DOMAIN_TERM_BONUSES) {
      if (pattern.test(normalized)) score += bonus;
    }
    for (const [pattern, penalty] of PHONETIC_MISHEARING_PENALTIES) {
      if (pattern.test(raw)) score += penalty;
    }

    if (score > bestScore) {
      bestScore = score;
      bestText = normalized;
    }
  }

  return bestText;
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
  recognition.maxAlternatives = 3;
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
      const text = selectBestAlternative(result);
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
