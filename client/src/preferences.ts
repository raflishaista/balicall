import type { JoinMediaChoices } from './usePreJoinMedia';
import { SEA_LIVE_MODEL } from './modelSelection.ts';

export interface MeetingPreferences {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  microphoneId: string;
  cameraId: string;
  outputId: string;
  mirrorLocalVideo: boolean;
  autoSpotlight: boolean;
  reduceMotion: boolean;
  scheduleReminders: boolean;
  speechLanguage: 'id-ID' | 'en-US';
  transcriptionProvider: 'auto' | 'browser' | 'server';
  transcriptionModel: string;
  sharedRoomMic: boolean;
  liveDiarization: boolean;
  batchDiarization: boolean;
}

export const PREFERENCES_KEY = 'sentra.meeting-preferences.v1';
export const DEFAULT_PREFERENCES: MeetingPreferences = {
  microphoneEnabled: true, cameraEnabled: true,
  microphoneId: 'default', cameraId: 'default', outputId: 'default',
  mirrorLocalVideo: true, autoSpotlight: true, reduceMotion: false, scheduleReminders: true,
  speechLanguage: 'id-ID', transcriptionProvider: 'auto', transcriptionModel: '',
  sharedRoomMic: false,
  liveDiarization: true,
  batchDiarization: true,
};

export function normalizePreferences(value: unknown): MeetingPreferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.speechLanguage === 'id-ID' || input.speechLanguage === 'en-US') result.speechLanguage = input.speechLanguage;
  if (input.transcriptionProvider === 'auto' || input.transcriptionProvider === 'browser' || input.transcriptionProvider === 'server') result.transcriptionProvider = input.transcriptionProvider;
  if (typeof input.transcriptionModel === 'string' && /^[a-zA-Z0-9._-]{0,64}$/.test(input.transcriptionModel)) result.transcriptionModel = input.transcriptionModel;
  if (result.transcriptionModel === 'qwen3-asr-0.6b') result.transcriptionModel = '';
  for (const key of ['microphoneEnabled', 'cameraEnabled', 'mirrorLocalVideo', 'autoSpotlight', 'reduceMotion', 'scheduleReminders', 'sharedRoomMic', 'liveDiarization', 'batchDiarization'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const key of ['microphoneId', 'cameraId', 'outputId'] as const) {
    if (typeof input[key] === 'string' && input[key].trim() && input[key].length <= 256) result[key] = input[key].trim();
  }
  return result;
}

export function readPreferences(storage: Pick<Storage, 'getItem'>): { preferences: MeetingPreferences; notice: string | null } {
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    if (!raw) return { preferences: { ...DEFAULT_PREFERENCES }, notice: null };
    const saved = JSON.parse(raw);
    if (saved?.version !== 1) throw new Error('Unsupported preferences');
    return { preferences: normalizePreferences(saved.preferences), notice: null };
  } catch {
    return { preferences: { ...DEFAULT_PREFERENCES }, notice: 'Preferensi sebelumnya tidak dapat dibaca. Pengaturan default digunakan.' };
  }
}

export function writePreferences(storage: Pick<Storage, 'setItem'>, value: MeetingPreferences) {
  const next = normalizePreferences(value);
  storage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, preferences: next }));
  return next;
}

export function mediaChoices(preferences: MeetingPreferences, qwenDiarizationReady = false): JoinMediaChoices {
  return { microphoneEnabled: preferences.microphoneEnabled, cameraEnabled: preferences.cameraEnabled,
    microphoneId: preferences.microphoneId, cameraId: preferences.cameraId,
    sharedRoomMic: supportsSharedMicrophone(preferences.transcriptionModel, qwenDiarizationReady) && (preferences.sharedRoomMic ?? false),
    liveDiarization: preferences.liveDiarization ?? true,
    batchDiarization: preferences.transcriptionModel.startsWith('qwen3-asr-') || [SEA_LIVE_MODEL].includes(preferences.transcriptionModel) ? false : preferences.batchDiarization ?? true };
}

export function supportsSharedMicrophone(model?: string, qwenDiarizationReady = false) {
  if (model === SEA_LIVE_MODEL) return qwenDiarizationReady;
  return !model?.startsWith('qwen3-asr-') || qwenDiarizationReady;
}

export function qwenDiarizationForModel(model: string | undefined, health?: {qwenDiarizationReady?: boolean; qwenLiveDiarizationReady?: boolean; seaLiveDiarizationReady?: boolean} | null) {
  return Boolean(model === SEA_LIVE_MODEL ? health?.seaLiveDiarizationReady : model === 'qwen3-asr-0.6b-live' ? health?.qwenLiveDiarizationReady : health?.qwenDiarizationReady);
}

export const QWEN_LIVE_DIARIZATION_NOTICE = 'Qwen Live + Nemotron: nama pembicara bisa diedit manual di transkrip. Sesi mikrofon dipertahankan hingga 45 detik saat mute atau koneksi terputus. Setelah sesi berakhir atau worker restart, label perlu diperiksa lagi. Suara bertumpuk tetap ditandai.';

export const QWEN_TRANSCRIPTION_NOTICE = 'Qwen masih eksperimental. Layanan diarization belum siap; transkrip memakai nama akun peserta.';
export const QWEN_DIARIZATION_NOTICE = 'Qwen + Nemotron eksperimental: label pembicara berlaku per potongan audio, bukan nama orang atau identitas tetap sepanjang rapat. Suara bertumpuk belum dipisahkan. Batch pasca-rapat belum tersedia untuk Qwen.';

export function resolveTranscriptionPreferences(preferences: MeetingPreferences, configured: boolean, models: string[], defaultModel: string, defaultProvider: 'browser' | 'server') {
  const requested = preferences.transcriptionProvider === 'auto' ? defaultProvider : preferences.transcriptionProvider;
  const provider: 'browser' | 'server' = requested === 'server' && configured ? 'server' : 'browser';
  const model = models.includes(preferences.transcriptionModel) ? preferences.transcriptionModel
    : models.includes(defaultModel) ? defaultModel : models[0] || '';
  const notice = requested === 'server' && !configured
    ? 'Layanan Server belum tersedia. Rapat ini menggunakan transkripsi Browser.'
    : provider === 'server' && preferences.transcriptionModel && !models.includes(preferences.transcriptionModel)
      ? 'Model tersimpan belum tersedia. Rapat ini menggunakan model default yang tersedia.' : null;
  return { provider, model, notice };
}

export function transcriptionModelLabel(model: string) {
  if (model === SEA_LIVE_MODEL) return 'SEA-ASR-ID · Live (Indonesia) · Pilot';
  return model === 'qwen3-asr-0.6b-live' ? 'Qwen3-ASR 0.6B · Live + Diarization'
    : model === 'qwen3-asr-0.6b' ? 'Qwen3-ASR-0.6B · Eksperimental'
    : model === 'whisperlivekit-small' ? 'WhisperLiveKit · Small (Live)'
    : model === 'small-id' ? 'faster-whisper · Small Indonesian'
      : model === 'small' ? 'faster-whisper · Small' : model;
}

export function isChromiumBrowser(): boolean {
  if (typeof window === 'undefined') return true;
  const nav = navigator as any;
  if (nav.userAgentData?.brands && Array.isArray(nav.userAgentData.brands)) {
    return nav.userAgentData.brands.some((b: { brand: string }) => /Chromium|Chrome|Edge/i.test(b.brand));
  }
  const isChrome = Boolean((window as any).chrome);
  const isFirefox = /Firefox|FxiOS/i.test(navigator.userAgent);
  const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg/i.test(navigator.userAgent);
  if (isFirefox || isSafari) return false;
  return isChrome || Boolean((window as any).webkitSpeechRecognition);
}

export function getRecommendedProvider(configured = false): 'browser' | 'server' {
  if (isChromiumBrowser()) return 'browser';
  return configured ? 'server' : 'browser';
}
