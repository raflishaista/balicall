import { apiRequest } from './api';
import type { MeetingSummary } from './summaryHistory';

export type UploadStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface RecordingTranscript {
  text: string;
  segments: { text: string; speaker: string; start: number; end: number }[];
  durationSeconds: number | null;
}

export interface RecordingUpload {
  id: string;
  title: string;
  originalFilename: string | null;
  fileSize: number | null;
  language: 'id' | 'en';
  llmModel: string | null;
  sttModel: string | null;
  status: UploadStatus;
  stage: string | null;
  error: string | null;
  durationSeconds: number | null;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  hasSummary: boolean;
  transcript?: RecordingTranscript | null;
  summary?: MeetingSummary | null;
}

// Harus sama dengan RECORDING_UPLOAD_MAX_MB di server/.env (bawaan 500).
export const MAX_UPLOAD_MB = 500;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export const isActive = (item: Pick<RecordingUpload, 'status'>) =>
  item.status === 'queued' || item.status === 'processing';

export function statusLabel(item: Pick<RecordingUpload, 'status' | 'stage'>) {
  if (item.status === 'queued') return 'Antre';
  if (item.status === 'processing') return item.stage === 'summarizing' ? 'Menyusun ringkasan' : 'Transkripsi suara';
  if (item.status === 'done') return 'Selesai';
  return 'Gagal';
}

export function formatSize(bytes: number | null) {
  if (bytes === null) return '-';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '-';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}j ${m}m` : m ? `${m}m ${s}d` : `${s}d`;
}

export const listUploads = () =>
  apiRequest<{ success: boolean; uploads: RecordingUpload[] }>('/recording-uploads');

export const getUpload = (id: string) =>
  apiRequest<{ success: boolean; upload: RecordingUpload }>(`/recording-uploads/${encodeURIComponent(id)}`);

export const resummarizeUpload = (id: string, llmModel?: string) =>
  apiRequest<{ success: boolean }>(`/recording-uploads/${encodeURIComponent(id)}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(llmModel ? { llmModel } : {}),
  });

export const getOptions = () =>
  apiRequest<{ success: boolean; llm: { default: string; models: string[] }; stt: { default: string; models: string[] } }>('/recording-uploads/options');

export const SttLabels: Record<string, string> = {
  small: 'Whisper Small',
  'small-id': 'Whisper Small (Indonesia)',
  'qwen3-asr-0.6b': 'Qwen3-ASR 0.6B (eksperimental)',
};

export function uploadRecording(file: File, title: string, language: 'id' | 'en', llmModel: string, sttModel: string) {
  const form = new FormData();
  form.append('title', title);
  form.append('language', language);
  if (llmModel) form.append('llmModel', llmModel);
  if (sttModel) form.append('sttModel', sttModel);
  form.append('file', file); // field teks harus sebelum file
  return apiRequest<{ success: boolean; upload: RecordingUpload }>(
    '/recording-uploads', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
}

export const deleteUpload = (id: string) =>
  apiRequest<{ success: boolean }>(`/recording-uploads/${encodeURIComponent(id)}`, { method: 'DELETE' });