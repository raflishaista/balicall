import { API_BASE, apiRequest, meetingPath } from './api';

export interface MeetingFile {
  id: string;
  meetingId: string;
  uploaderId?: string | null;
  uploaderName: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export const MEETING_FILE_TOPIC = 'balicall.meeting.file.v1';
export const MAX_MEETING_FILE_MB = 10;
export const MAX_MEETING_FILE_BYTES = MAX_MEETING_FILE_MB * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fetchMeetingFiles(meetingId: string, token?: string): Promise<MeetingFile[]> {
  if (!meetingId) return [];
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const data = await apiRequest<{ files: MeetingFile[] }>(meetingPath(meetingId, 'files'), {
    method: 'GET',
    headers,
  });
  return Array.isArray(data?.files) ? data.files : [];
}

export async function uploadMeetingFile(meetingId: string, token: string, file: File): Promise<MeetingFile> {
  if (file.size > MAX_MEETING_FILE_BYTES) {
    throw new Error(`Ukuran file melebihi batas ${MAX_MEETING_FILE_MB} MB.`);
  }
  const formData = new FormData();
  formData.append('file', file);
  const data = await apiRequest<{ file: MeetingFile }>(
    meetingPath(meetingId, 'files'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    },
    60000,
  );
  return data.file;
}

export async function downloadMeetingFile(
  meetingId: string,
  fileId: string,
  filename: string,
  token?: string,
): Promise<void> {
  const url = `${API_BASE}${meetingPath(meetingId, `files/${encodeURIComponent(fileId)}/download`)}`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = 'Gagal mengunduh file rapat.';
    try {
      const errData = await response.json();
      if (errData?.error) message = errData.error;
    } catch {
      /* ignore non-JSON error */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename || 'file';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}
