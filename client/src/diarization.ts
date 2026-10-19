export interface DiarizationOptions {
  provider: 'browser' | 'server';
  model?: string;
  configured: boolean | null;
  sharedRoomMic?: boolean;
  liveDiarization?: boolean;
  batchDiarization?: boolean;
}

export function resolveDiarization(options: DiarizationOptions) {
  let unavailable = '';
  if (options.provider === 'browser') unavailable = 'Transkripsi Browser belum mendukung pemisahan pembicara pada alur ini. Pilih layanan Server dengan model yang mendukung.';
  else if (options.model === 'qwen3-asr-0.6b') unavailable = 'Qwen masih eksperimental dan belum mendukung diarization pada integrasi ini.';
  else if (options.model === 'whisperlivekit-small') unavailable = 'WhisperLiveKit belum mendukung diarization pada alur ini. Pilih model upload audio Server.';
  else if (options.configured === null) unavailable = 'Konfigurasi Server belum dapat diperiksa. Periksa ulang layanan sebelum mengaktifkan pemisahan pembicara.';
  else if (!options.configured) unavailable = 'Layanan Server belum dikonfigurasi. Pemisahan pembicara tidak diterapkan.';
  else if (!options.model) unavailable = 'Pilih model transkripsi Server yang tersedia terlebih dahulu.';
  const available = !unavailable;
  const shared = available && Boolean(options.sharedRoomMic);
  return {
    available, shared,
    live: shared && (options.liveDiarization ?? true),
    batch: shared && (options.batchDiarization ?? true),
    notice: unavailable || 'Opsi dapat diminta melalui upload audio Server. Kesiapan model diarization belum diverifikasi oleh pemeriksaan konfigurasi.',
  };
}
