export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
  get retryable() { return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500; }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, timeoutMs = 35000): Promise<T> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    response = await fetch(`${API_BASE}${path}`, { ...options, signal });
  } catch {
    throw new ApiError('Koneksi layanan gagal atau melewati batas waktu. Periksa layanan lalu coba kembali.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || `Layanan mengembalikan HTTP ${response.status}`, response.status);
  if (!data) throw new ApiError('Respons layanan tidak valid', 502);
  return data as T;
}

export function meetingPath(id: string, endpoint: string) {
  return `/meetings/${encodeURIComponent(id)}/${endpoint}`;
}
