import type { JoinMediaChoices } from './usePreJoinMedia';

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
}

export const PREFERENCES_KEY = 'sentra.meeting-preferences.v1';
export const DEFAULT_PREFERENCES: MeetingPreferences = {
  microphoneEnabled: true, cameraEnabled: true,
  microphoneId: 'default', cameraId: 'default', outputId: 'default',
  mirrorLocalVideo: true, autoSpotlight: true, reduceMotion: false, scheduleReminders: true,
  speechLanguage: 'id-ID', transcriptionProvider: 'auto', transcriptionModel: '',
};

export function normalizePreferences(value: unknown): MeetingPreferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.speechLanguage === 'id-ID' || input.speechLanguage === 'en-US') result.speechLanguage = input.speechLanguage;
  if (input.transcriptionProvider === 'auto' || input.transcriptionProvider === 'browser' || input.transcriptionProvider === 'server') result.transcriptionProvider = input.transcriptionProvider;
  if (typeof input.transcriptionModel === 'string' && /^[a-zA-Z0-9._-]{0,64}$/.test(input.transcriptionModel)) result.transcriptionModel = input.transcriptionModel;
  for (const key of ['microphoneEnabled', 'cameraEnabled', 'mirrorLocalVideo', 'autoSpotlight', 'reduceMotion', 'scheduleReminders'] as const) {
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

export function mediaChoices(preferences: MeetingPreferences): JoinMediaChoices {
  return { microphoneEnabled: preferences.microphoneEnabled, cameraEnabled: preferences.cameraEnabled,
    microphoneId: preferences.microphoneId, cameraId: preferences.cameraId };
}

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
  return model === 'whisperlivekit-small' ? 'WhisperLiveKit · Small (Live)'
    : model === 'small-id' ? 'faster-whisper · Small Indonesian'
      : model === 'small' ? 'faster-whisper · Small' : model;
}
