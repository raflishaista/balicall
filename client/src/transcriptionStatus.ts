export interface TranscriptionState {
  connected: boolean;
  isMuted: boolean;
  isListening: boolean;
  speechEnabled: boolean;
  saveBlocked: boolean;
  speechError?: string | null;
  interimText: string;
  pendingSaves: number;
}
export function transcriptionStatus(state: TranscriptionState): {label: string; detail: string; tone: 'error' | 'pending' | 'active' | 'idle'} {
  if (state.saveBlocked) return {label:'Penyimpanan bermasalah',detail:'Sebagian ucapan belum tersimpan. Periksa pesan penyimpanan dan pilih Coba simpan lagi.',tone:'error'};
  if (state.speechError) return {label:'Transkripsi bermasalah',detail:'Ucapan baru mungkin belum tercatat. Periksa pesan di bawah; transkrip yang sudah tampil tetap tersedia.',tone:'error'};
  if (!state.connected) return {label:'Koneksi rapat terputus',detail:'Menunggu koneksi rapat kembali. Ucapan selama koneksi terputus mungkin tidak tercatat.',tone:'error'};
  if (state.pendingSaves > 0) return {label:state.isMuted || !state.speechEnabled ? 'Menyelesaikan transkrip' : 'Memproses ucapan',detail:`${state.pendingSaves} ucapan menunggu pemrosesan atau konfirmasi penyimpanan.`,tone:'pending'};
  if (state.isMuted) return {label:'Mikrofon nonaktif',detail:'Suara dari mikrofonmu tidak dikirim untuk transkripsi.',tone:'idle'};
  if (!state.speechEnabled) return {label:'Transkripsi dijeda',detail:'Aktifkan transkripsi untuk mencatat ucapan dari mikrofonmu.',tone:'idle'};
  if (state.interimText.trim()) return {label:'Teks sementara',detail:'Hasil pengenalan masih dapat berubah sebelum menjadi teks final.',tone:'pending'};
  if (state.isListening) return {label:'Mendengarkan',detail:'Transkripsi mikrofonmu aktif. Ucapan yang dikenali akan muncul di bawah.',tone:'active'};
  return {label:'Menghubungkan transkripsi',detail:'Menunggu layanan transkripsi siap. Ucapan belum tentu tercatat.',tone:'pending'};
}
