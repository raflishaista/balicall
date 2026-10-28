import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';

export interface BackendHealth {
  status: string;
  llmProvider?: string; llmModel?: string; llmEffectiveProvider?: string;
  hasLlmKey?: boolean; livekitStatus?: string;
  sttProvider?: 'browser' | 'server'; sttConfigured?: boolean;
  sttModel?: string; sttModels?: string[]; sttDiarization?: boolean;
  qwenDiarizationReady?: boolean; qwenBatchConfigured?: boolean; qwenBatchWorkerReady?: boolean;
  qwenLiveReady?: boolean; qwenLiveDiarizationReady?: boolean;
  seaLivePilotReady?: boolean; seaLiveDiarizationReady?: boolean;
  database?: { connected: boolean; configured: boolean };
  outboundWebhookConfigured?: boolean;
}

export function useBackendHealth() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [checking, setChecking] = useState(true), [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null), [checkedAt, setCheckedAt] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController(); request.current = controller;
    try {
      const data = await apiRequest<BackendHealth>('/health', { signal: controller.signal }, 5000);
      if (!data || data.status !== 'ok') throw new Error('Respons status layanan tidak valid.');
      // Retire batch Qwen from model choices; native Qwen Live remains available.
      data.sttModels = data.sttModels?.filter(model => model !== 'qwen3-asr-0.6b');
      if (data.sttModel === 'qwen3-asr-0.6b') data.sttModel = data.sttModels?.[0] || '';
      if (!controller.signal.aborted) { setHealth(data); setError(null); }
    } catch {
      if (!controller.signal.aborted) { setHealth(null); setError('Konfigurasi layanan belum dapat diperiksa. Periksa koneksi lalu coba lagi.'); }
    } finally {
      if (!controller.signal.aborted) { setChecking(false); setChecked(true); setCheckedAt(new Date().toISOString()); }
      if (request.current === controller) request.current = null;
    }
  }, []);
  const refresh = useCallback(() => { setChecking(true); return check(); }, [check]);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- check updates state only after the external API request settles.
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [check]);
  return { health, checking, checked, error, checkedAt, refresh };
}
