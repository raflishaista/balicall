import { BookOpen, FileText, Mic2 } from 'lucide-react';
import './DocumentationPage.css';

const contents = [
  ['docs-start', 'Mulai rapat'],
  ['docs-join', 'Bergabung'],
  ['docs-during', 'Saat rapat'],
  ['docs-results', 'Notulen'],
  ['docs-upload', 'Unggah rekaman'],
  ['docs-models', 'Pilih model'],
  ['docs-troubleshooting', 'Kendala umum'],
  ['docs-architecture', 'Arsitektur'],
] as const;

const problems = [
  ['Mikrofon tidak menangkap suara', 'Izinkan mikrofon di browser. Pilih perangkat yang benar di preview atau Lainnya → Perangkat audio & video, dan pastikan mikrofon tidak mute.'],
  ['Tidak dapat masuk ruang rapat', 'Periksa nama ruang dan koneksi jaringan. Jika ada kesalahan token atau sinyal, muat ulang halaman dan coba lagi. Bila berulang, minta pengelola memeriksa API dan LiveKit.'],
  ['Model Server tidak tersedia', 'Gunakan Browser bila didukung, atau minta pengelola memeriksa layanan STT. Model yang tidak muncul atau dinonaktifkan belum siap dipakai di server itu.'],
  ['Transkrip kosong', 'Buka Transkrip, pastikan mikrofon aktif dan status mendengarkan. Di Lainnya pilih Mulai transkrip atau Coba transkripsi lagi, lalu ucapkan satu kalimat jelas.'],
  ['Notulen gagal dibuat', 'Pastikan transkrip final sudah ada, lalu pilih Coba Buat Notulen Lagi. Transkrip tetap dapat dibaca ketika AI gagal.'],
  ['PDF dari riwayat tidak dapat diunduh', 'Sesi akses rapat mungkin sudah berakhir. Gunakan Salin notulen atau Export JSON; PDF server memerlukan sesi akses yang masih berlaku.'],
] as const;

export function DocumentationPage() {
  const asset = import.meta.env.BASE_URL + 'docs/assets/';
  return <div className="documentation-page">
    <header className="documentation-heading">
      <img className="documentation-logo" src={asset + 'balitower-logo.png'} alt="Bali Tower" />
      <span className="page-kicker"><BookOpen size={14} /> PANDUAN BALICALL</span>
      <h1>Dokumentasi</h1>
      <p>Ikuti langkah dari persiapan perangkat sampai hasil rapat. Nama tombol di bawah sesuai tampilan aplikasi agar mudah ditemukan.</p>
    </header>

    <nav className="documentation-toc" aria-label="Isi dokumentasi">
      <strong>Di halaman ini</strong>
      <div>{contents.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}</div>
    </nav>

    <section className="documentation-section" aria-labelledby="docs-start">
      <div className="documentation-section-heading"><h2 id="docs-start">1. Mulai rapat</h2><span>Untuk penyelenggara</span></div>
      <p>Siapkan nama ruang yang mudah dibagikan dan uji mikrofon sebelum mengundang peserta. Kamera boleh dimatikan jika hanya perlu suara.</p>
      <ol className="documentation-steps">
        <li>Di sidebar pilih <strong>Buat rapat</strong>. Isi identitas dan <strong>Nama ruang rapat</strong>, misalnya <code>rapat-noc-senin</code>.</li>
        <li>Di <strong>Preview lokal</strong>, pilih mikrofon dan kamera. Jalankan tes mikrofon; izinkan akses saat browser memintanya.</li>
        <li>Di <strong>Layanan transkripsi</strong>, biarkan <strong>Otomatis</strong> atau pilih <strong>Server</strong> dan model yang tersedia. Lihat <a href="#docs-models">panduan pemilihan model</a>.</li>
        <li>Jika beberapa orang berbicara melalui satu mikrofon, aktifkan <strong>Mode Mikrofon Ruang Rapat</strong> hanya bila opsinya tersedia.</li>
        <li>Tekan <strong>Mulai rapat</strong>, lalu bagikan nama ruang kepada peserta.</li>
      </ol>
      <div className="documentation-callout"><strong>Hasil yang diharapkan</strong><p>Ruang terbuka dan kontrol mikrofon/kamera terlihat. Kamu dapat membuka panel Transkrip. Jika izin mikrofon ditolak, perbaiki izin browser dahulu.</p></div>
    </section>

    <section className="documentation-section" aria-labelledby="docs-join">
      <div className="documentation-section-heading"><h2 id="docs-join">2. Bergabung dari perangkat lain</h2><span>Untuk peserta</span></div>
      <ol className="documentation-steps">
        <li>Buka alamat BaliCall yang sama melalui <strong>HTTPS</strong>, lalu pilih <strong>Gabung rapat</strong>. Alamat HTTP dengan IP jaringan tidak dapat mengakses mikrofon/kamera pada browser; localhost hanya berlaku untuk PC itu sendiri.</li>
        <li>Isi identitas dan masukkan <strong>Kode / nama ruang</strong> persis seperti yang dibagikan penyelenggara.</li>
        <li>Periksa mikrofon dan kamera di preview, lalu tekan <strong>Gabung rapat</strong>.</li>
      </ol>
      <div className="documentation-callout"><strong>Dua perangkat di satu ruangan</strong><p>Gunakan headset atau matikan mikrofon dan speaker salah satu perangkat agar tidak bergema. Label peserta mengikuti akun/perangkat; pemisahan beberapa suara dari satu mikrofon memerlukan mode ruang rapat dan layanan diarization yang siap.</p></div>
    </section>

    <section className="documentation-section" aria-labelledby="docs-during">
      <div className="documentation-section-heading"><h2 id="docs-during">3. Saat rapat berlangsung</h2><span>Kontrol utama</span></div>
      <div className="documentation-table-wrap"><table><thead><tr><th>Kebutuhan</th><th>Langkah</th><th>Hasil yang diperiksa</th></tr></thead><tbody>
        <tr><td>Bicara atau berhenti sementara</td><td>Pilih <strong>Mikrofon</strong> / <strong>Aktifkan mic</strong>.</td><td>Ikon mute berubah; peserta lain mendengar saat aktif.</td></tr>
        <tr><td>Melihat ucapan</td><td>Pilih <strong>Transkrip</strong>. Jika berhenti, buka <strong>Lainnya → Mulai transkrip</strong>.</td><td>Teks sementara bisa berubah. Teks final menjadi dasar notulen.</td></tr>
        <tr><td>Ganti perangkat</td><td>Buka <strong>Lainnya → Perangkat audio &amp; video</strong>.</td><td>Mikrofon/kamera yang dipakai sesuai pilihan.</td></tr>
        <tr><td>Berbagi tampilan</td><td>Pilih <strong>Bagikan layar</strong>, lalu layar atau jendela di dialog browser.</td><td>Tampilan terlihat oleh peserta.</td></tr>
        <tr><td>Merekam video</td><td>Penyelenggara atau cohost pilih <strong>Rekaman</strong>, lalu <strong>Hentikan</strong>.</td><td>Status rekaman aktif; fitur memerlukan layanan perekaman server.</td></tr>
      </tbody></table></div>
      <p className="documentation-after-table">Jika label pembicara perlu diperbaiki, lakukan saat transkrip ruang rapat masih terbuka: tombol edit hanya muncul untuk segmen diarization tertentu dan pengguna yang berhak. Pilih <strong>Keluar</strong> jika hanya ingin meninggalkan ruang. Penyelenggara dapat memilih <strong>Selesai &amp; notulen</strong> untuk menutup rapat dan memulai pembuatan hasil.</p>
    </section>

    <section className="documentation-section" aria-labelledby="docs-results">
      <div className="documentation-section-heading"><h2 id="docs-results">4. Baca dan bagikan hasil</h2><span>Setelah rapat</span></div>
      <ol className="documentation-steps">
        <li>Penyelenggara memilih <strong>Selesai &amp; notulen</strong>. Tunggu potongan audio terakhir diproses dan AI menyusun hasil.</li>
        <li>Buka <strong>Notulen rapat</strong> dari sidebar, pilih rapat dari riwayat, lalu baca ringkasan, keputusan, tindak lanjut, dan transkrip.</li>
        <li>Periksa isi dan label pembicara sebelum membagikan hasil. Halaman notulen menampilkan transkrip untuk dibaca, tetapi tidak menyediakan tombol edit nama pembicara setelah rapat.</li>
        <li>Pilih <strong>Salin notulen</strong>, <strong>Export JSON</strong>, atau <strong>Export PDF</strong> sesuai kebutuhan.</li>
      </ol>
      <div className="documentation-callout"><strong>Jika hasil belum muncul</strong><p>Halaman dapat menunggu teks final sebelum membuat notulen. Jika AI gagal, pilih <strong>Coba Buat Notulen Lagi</strong>. Periksa hasil sebelum dipakai sebagai catatan rapat resmi.</p></div>
    </section>

    <section className="documentation-section" aria-labelledby="docs-upload">
      <div className="documentation-section-heading"><h2 id="docs-upload">5. Proses rekaman yang sudah ada</h2><span>Terpisah dari rapat live</span></div>
      <p>Jika rapat sudah direkam sebagai MP4, buka <strong>Notulen rapat → Unggah Rekaman</strong> bila tersedia untuk akunmu. Proses ini membuat transkrip dan notulen dari file, bukan mikrofon live. Tombol <strong>Unggah Audio (Batch)</strong> di halaman riwayat menerima file audio; itu berbeda dari batch audio pasca-rapat otomatis untuk seluruh peserta.</p>
      <ol className="documentation-steps">
        <li>Pilih file <strong>.mp4</strong> sesuai batas ukuran pada formulir.</li>
        <li>Isi judul, pilih bahasa Indonesia atau English, lalu pilih model jika menunya muncul.</li>
        <li>Tekan <strong>Unggah &amp; proses</strong>. Jangan tutup halaman sampai unggahan selesai.</li>
        <li>Pantau <strong>Daftar Rekaman</strong> dan pilih item ketika proses selesai.</li>
      </ol>
    </section>

    <section className="documentation-section" aria-labelledby="docs-models">
      <div className="documentation-section-heading"><h2 id="docs-models">6. Memilih transkripsi</h2><span>Tergantung kesiapan server</span></div>
      <p>Di preview, <strong>Otomatis</strong> memilih jalur sesuai browser dan konfigurasi. <strong>Browser</strong> memakai pengenalan suara browser; <strong>Server</strong> menampilkan model yang diumumkan layanan STT. Pilihan yang dinonaktifkan belum siap dipakai.</p>
      <div className="documentation-table-wrap"><table><thead><tr><th>Pilihan</th><th>Kegunaan</th><th>Periksa dahulu</th></tr></thead><tbody>
        <tr><td>Browser (Web Speech API)</td><td>Rapat sederhana bila browser mendukungnya.</td><td>Izin mikrofon dan dukungan browser.</td></tr>
        <tr><td>Whisper / WhisperLiveKit</td><td>Transkripsi server, termasuk opsi live bila worker tersedia.</td><td>Status model di menu dan layanan STT.</td></tr>
        <tr><td>Qwen Live</td><td>Transkripsi server yang menampilkan teks bertahap.</td><td>Worker Qwen siap; label diarization bukan verifikasi identitas orang.</td></tr>
        <tr><td>SEA-ASR-ID Live</td><td>Rapat berbahasa Indonesia bila pilihan tersedia.</td><td>Akurasi teks dan label pada hasil rapat nyata.</td></tr>
        <tr><td>Ming ASR Tiny</td><td>Hanya untuk bahasa Inggris dan tanpa diarization, bila sudah aktif pada server.</td><td>Jika tertulis belum tersedia, jangan pilih.</td></tr>
      </tbody></table></div>
      <p className="documentation-after-table">Mode mikrofon ruang rapat dapat membedakan beberapa suara dari <em>satu</em> mikrofon bila worker diarization siap. Label “Pembicara 1/2” berlaku per sesi mikrofon, bisa berubah setelah sesi terputus, dan perlu diperiksa saat suara ambigu atau bertumpuk.</p>
    </section>

    <section className="documentation-section" aria-labelledby="docs-troubleshooting">
      <div className="documentation-section-heading"><h2 id="docs-troubleshooting">7. Jika ada kendala</h2><span>Pemeriksaan cepat</span></div>
      <div className="documentation-table-wrap"><table><thead><tr><th>Gejala</th><th>Yang dicoba</th></tr></thead><tbody>{problems.map(([problem, fix]) => <tr key={problem}><td><strong>{problem}</strong></td><td>{fix}</td></tr>)}</tbody></table></div>
      <p className="documentation-after-table">Jika berulang, catat waktu, nama ruang, model terpilih, dan pesan kesalahan. Jangan membagikan token akses atau kunci API.</p>
    </section>

    <section className="documentation-section" aria-labelledby="docs-architecture">
      <div className="documentation-section-heading"><h2 id="docs-architecture">Arsitektur dan status fitur</h2><span>Untuk pembaca teknis</span></div>
      <p>Browser memakai Express API untuk akses dan data rapat. LiveKit membawa audio/video antarperangkat; worker STT mengubah audio menjadi teks, PostgreSQL menyimpan data, dan LLM menyusun notulen dari transkrip final.</p>
      <figure className="documentation-figure"><img src={asset + 'architecture.svg'} alt="Diagram arsitektur BaliCall: browser, Express API, LiveKit, Egress, PostgreSQL, worker STT, dan LLM." /><figcaption>Alur komponen BaliCall.</figcaption></figure>
      <div className="documentation-planned-box">
        <h3>Diarisasi batch seluruh peserta dengan Qwen</h3>
        <p>Rekam audio ruang rapat untuk membuat transkrip batch dan notulen setelah rapat berakhir. Nemotron menentukan giliran pembicara dan Qwen3-ASR-0.6B mengubah ucapan menjadi teks.</p>
        <ol className="documentation-steps">
          <li>Sebagai host, masuk ke rapat, buka <strong>Transkrip → Opsi</strong>, lalu pilih <strong>Rekam audio untuk batch Qwen</strong>. Jika tombol tidak tersedia, hubungi pengelola server untuk memeriksa layanan perekaman dan worker batch.</li>
          <li>Mulai rekaman sebelum percakapan agar audio yang dibutuhkan tercakup. Sistem merekam audio ruang dari perangkat peserta yang terhubung sebagai satu file OGG; kamera tidak direkam.</li>
          <li>Setelah semua peserta keluar dan Egress selesai menulis file, server memproses rekaman menggunakan Nemotron dan Qwen3-ASR-0.6B. Buka kembali hasil rapat untuk memeriksa status dan notulen batch.</li>
        </ol>
        <p>Transkrip live tetap terpisah. Label Pembicara 1/2 berlaku dalam satu rekaman dan bukan identitas orang yang terverifikasi; tinjau kembali bagian yang ambigu atau bertumpuk.</p>
        <p><strong>Perbedaan dengan preview:</strong> kotak “Diarisasi Batch Pasca-Rapat” pada preview Qwen Live dinonaktifkan dan bukan tombol perekaman batch seluruh peserta. Gunakan opsi rekam di dalam rapat.</p>
        <figure className="documentation-figure"><img src={asset + 'batch-flow.svg'} alt="Alur rekaman audio seluruh peserta, Nemotron, Qwen ASR, transkrip batch, dan notulen." /><figcaption>Alur batch dari rekaman audio ruang hingga transkrip dan notulen.</figcaption></figure>
      </div>
      <p className="documentation-caption"><Mic2 size={15} /> Kesiapan server deploy perlu diuji pada lingkungan rapat; panduan ini bukan sertifikasi produksi.</p>
    </section>
    <footer className="documentation-footer"><FileText size={15} /> Panduan BaliCall · Diperbarui 29 Oktober 2026</footer>
  </div>;
}
