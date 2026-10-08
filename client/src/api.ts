export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
export const AUTH_EXPIRED_EVENT = 'balicall:auth-expired';
let csrfToken: string | null = null;
export function setAuthCsrfToken(token: string | null) { csrfToken = token; }

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
    const headers = new Headers(options.headers);
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include', signal });
  } catch {
    throw new ApiError('Koneksi layanan gagal atau melewati batas waktu. Periksa layanan lalu coba kembali.');
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && csrfToken && !path.startsWith('/auth/') && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  if (!response.ok) throw new ApiError(data?.error || `Layanan mengembalikan HTTP ${response.status}`, response.status);
  if (!data) throw new ApiError('Respons layanan tidak valid', 502);
  return data as T;
}

export function meetingPath(id: string, endpoint: string) {
  return `/meetings/${encodeURIComponent(id)}/${endpoint}`;
}
