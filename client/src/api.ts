export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
export const AUTH_EXPIRED_EVENT = 'balicall:auth-expired';
let csrfToken: string | null = null;
export function setAuthCsrfToken(token: string | null) { csrfToken = token; }

export class ApiError extends Error {
  status: number;
  requestId?: string;
  constructor(message: string, status = 0, requestId?: string) { super(message); this.status = status; this.requestId=requestId; }
  get retryable() { return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500; }
}

export function featureError(feature:string,error:unknown) {
  const message=error instanceof ApiError&&error.status>=500?'Layanan mengalami gangguan. Coba lagi; jika berulang, hubungi admin.':error instanceof Error?error.message:'Coba lagi atau hubungi admin.';
  const reference=error instanceof ApiError&&error.requestId?` Referensi: ${error.requestId}.`:'';
  return `${feature} gagal. ${message}${reference}`;
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
  if (!response.ok) {
    const reference=response.headers.get('X-Request-ID')||data?.requestId;
    const requestId=typeof reference==='string'&&/^[a-f0-9-]{36}$/i.test(reference)?reference:undefined;
    const message=response.status>=500
      ? `Layanan mengalami gangguan (HTTP ${response.status}). Coba lagi atau hubungi admin.${requestId?` Referensi: ${requestId}.`:''}`
      : data?.error || `Layanan mengembalikan HTTP ${response.status}`;
    throw new ApiError(message, response.status,requestId);
  }
  if (!data) throw new ApiError('Respons layanan tidak valid', 502);
  return data as T;
}

export function meetingPath(id: string, endpoint: string) {
  return `/meetings/${encodeURIComponent(id)}/${endpoint}`;
}
