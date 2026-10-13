import type { BackendHealth } from './useBackendHealth';

export function AIServicesPanel({ health, checking, error, checkedAt, onRefresh }: {
  health: BackendHealth | null; checking: boolean; error: string | null;
  checkedAt: string | null; onRefresh: () => void;
}) {
  const provider = health?.llmEffectiveProvider;
  return <section className="ai-services-panel" aria-label="Status layanan AI" aria-busy={checking}>
    <h3>Status layanan AI & transkripsi</h3>
    <p role="status">{checking ? 'Memeriksa konfigurasi layanan…' : error || (!health ? 'Konfigurasi layanan belum diketahui.' : 'Konfigurasi layanan berhasil diperiksa.')}</p>
    {health && <>
      <dl className="ai-services-list">
        <div><dt>Notulen</dt><dd>{provider === 'demo' ? 'Mode demo aktif' : provider === 'office' ? `Office${health.llmModel ? ` · ${health.llmModel}` : ''} — terkonfigurasi` : provider === 'gemini' ? 'Gemini — terkonfigurasi' : 'Penyedia belum diketahui'}</dd></div>
        <div><dt>Transkripsi Server</dt><dd>{health.sttConfigured ? 'Terkonfigurasi' : 'Belum dikonfigurasi'}</dd></div>
      </dl>
      {provider === 'demo' && <p className="settings-notice">Mode demo hanya menampilkan transkrip dan tidak membuat ringkasan AI, keputusan, atau tugas otomatis. Admin perlu mengonfigurasi penyedia AI untuk ringkasan sebenarnya.</p>}
      <p className="settings-field-help">Pemeriksaan ini membaca konfigurasi API, bukan menguji inferensi model. Ketersediaan dan waktu respons AI, Whisper, serta model diarization baru dapat dipastikan saat memproses permintaan.</p>
    </>}
    <div className="ai-services-actions"><button type="button" className="button-secondary" disabled={checking} onClick={onRefresh}>{checking ? 'Memeriksa…' : error ? 'Coba lagi' : 'Periksa ulang layanan'}</button>{checkedAt && <small>Pemeriksaan terakhir: {new Date(checkedAt).toLocaleTimeString('id-ID')}</small>}</div>
  </section>;
}
