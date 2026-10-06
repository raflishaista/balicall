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
}

export const PREFERENCES_KEY = 'sentra.meeting-preferences.v1';
export const DEFAULT_PREFERENCES: MeetingPreferences = {
  microphoneEnabled: true, cameraEnabled: true,
  microphoneId: 'default', cameraId: 'default', outputId: 'default',
  mirrorLocalVideo: true, autoSpotlight: true, reduceMotion: false,
};

export function normalizePreferences(value: unknown): MeetingPreferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  for (const key of ['microphoneEnabled', 'cameraEnabled', 'mirrorLocalVideo', 'autoSpotlight', 'reduceMotion'] as const) {
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
