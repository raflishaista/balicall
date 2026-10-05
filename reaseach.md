# Riset kebutuhan BaliTower untuk BaliCall

Tanggal riset: **5 Oktober 2026**
Perusahaan: **PT Bali Towerindo Sentra Tbk**
Konteks: pengembangan aplikasi internal rapat suara, transkrip, dan notulen AI dengan identitas BaliTower. Nama berkas mengikuti permintaan: `reaseach.md`.

## 1. Kesimpulan dan batas penelitian

**Arah produk yang paling layak diuji adalah ruang koordinasi operasional dengan transkrip yang dapat dipercaya dan tindak lanjut yang jelas.** Nilai utamanya: peserta dapat melanjutkan pekerjaan dari hasil rapat tanpa kehilangan konteks, salah membaca kode lokasi, atau menganggap usulan AI sebagai keputusan final.

Pilih satu tim untuk pilot, dengan dua kandidat: koordinasi NOC–lapangan dan rapat progres pembangunan/aktivasi jaringan. Mulai dari simulasi atau koordinasi rutin; penggunaan untuk insiden kritis menunggu bukti keandalan dan persetujuan pemilik operasional.

Dokumen ini memakai tiga jenis bukti:

- **Fakta publik:** materi perusahaan dan produk pada situs resmi, dengan tautan sumber.
- **Temuan proyek:** pembacaan kode dan dokumentasi lokal pada tanggal riset. Catatan pengujian sebelumnya dirujuk, bukan diklaim sebagai pengujian baru.
- **Hipotesis kebutuhan:** kesimpulan produk yang diturunkan dari konteks bisnis. Belum ada wawancara pegawai, pengamatan rapat internal, data penggunaan, atau konfirmasi kebijakan IT.

Karena itu, prioritas di bawah merupakan rekomendasi untuk divalidasi, bukan daftar kebutuhan resmi yang telah disetujui BaliTower. Belum diketahui sistem tiket, kalender, identitas pegawai, jumlah pengguna, anggaran, atau target layanan internal perusahaan.

## 2. Profil bisnis yang relevan

| Fakta publik | Sumber dan batas bukti | Implikasi produk — inferensi |
| --- | --- | --- |
| BaliTower menyediakan infrastruktur menara dengan transmisi melalui fiber optic dan wireless. | [Profil resmi BaliTower](https://www.balitower.co.id/). Deskripsi perusahaan, bukan inventaris aset terkini. | Rapat kemungkinan membahas jaringan, lokasi, perangkat, dan istilah teknis. Transkrip perlu membantu memverifikasi identifier penting. |
| Layanan menara mencakup Built-to-Suit dan Collocation; halaman layanan menyebut pemantauan menara oleh NOC 24/7. | [Menara & Jaringan](https://www.balitower.co.id/service/menara-jaringan). Teks diverifikasi melalui berkas publik halaman resmi karena pembaca web tidak dapat merender halamannya. | Koordinasi pekerjaan site dan kesinambungan informasi antarshift merupakan kandidat penggunaan. Jadwal shift aktual belum diketahui. |
| Balifiber melayani pelanggan residensial dan korporasi, dengan produk Home dan Business. | [Balifiber](https://www.balifiber.id/home/bf_home). | Ada kemungkinan koordinasi lintas layanan, instalasi, dan penanganan pelanggan. Aplikasi rapat tidak perlu mengambil alih portal pelanggan. |
| Halaman Data Center menawarkan colocation, high availability, dan pengamanan fisik, termasuk log akses. | [Balitower Data Center](https://www.balifiber.id/home/bt_datacenter). Halaman juga berisi teks placeholder; spesifikasi perlu konfirmasi sebelum dijadikan persyaratan kontraktual. | Pembahasan fasilitas dan jaringan perlu akses terbatas dan jejak perubahan. Kontrol fasilitas tidak membuktikan keamanan aplikasi ini. |
| Situs mencantumkan pencapaian ISO tahun 2020 dengan lingkup inbound call center dan fasilitas data center. | [Sertifikasi pada situs BaliTower](https://www.balitower.co.id/). | Tata kelola informasi layak dibahas dengan IT. Belum diverifikasi masa berlaku sertifikat; jangan menyebut BaliCall tersertifikasi. |
| Halaman investor menyediakan daftar laporan tahunan, termasuk 2025 dan 2024. | [Laporan Tahunan](https://www.balitower.co.id/investor/laporan-tahunan). Daftar dan tautan ditemukan dalam berkas publik situs. | Tersedia sumber lanjutan untuk memvalidasi struktur dan risiko bisnis. Isi PDF 2025 belum berhasil dibaca dalam riset ini. |

**Identitas merek:** nama legal adalah PT Bali Towerindo Sentra Tbk. Nama produk internal dapat tetap “BaliCall” dengan label “BaliTower — Internal Meeting & AI Minutes”, setelah disepakati pemilik merek. Jangan mengubah nama legal menjadi “Bali Tower Sentra”. Logo dan foto resmi sudah memiliki catatan asal di [README aset](client/public/brand/README.md); sumber aset tidak otomatis menjadi izin penggunaan ulang.

## 3. Pengguna dan pekerjaan yang perlu divalidasi

Seluruh persona berikut adalah **hipotesis fungsi kerja**, bukan struktur organisasi resmi.

| Kandidat pengguna | Pekerjaan yang ingin diselesaikan | Hasil rapat yang berguna | Pertanyaan validasi |
| --- | --- | --- | --- |
| Operator NOC / koordinator operasional | Menyatukan status gangguan dan langkah berikutnya | Kronologi, lokasi terdampak, status, PIC, waktu pembaruan berikutnya | Apakah koordinasi saat ini melalui telepon, chat, tiket, atau bridge meeting? |
| Teknisi lapangan | Bergabung cepat dari lokasi dan melaporkan kondisi | Catatan pekerjaan, hambatan, instruksi yang dikonfirmasi | Perangkat, kebisingan, dan koneksi seperti apa yang dominan? |
| Koordinator proyek / deployment | Mengendalikan progres dan ketergantungan pekerjaan | Site/proyek, milestone, blocker, PIC, tenggat | Format laporan dan definisi status yang dipakai apa? |
| Koordinator vendor | Menyepakati tindak lanjut dengan pihak eksternal | Komitmen pekerjaan dan batas akses informasi | Apakah vendor perlu masuk rapat atau cukup menerima hasil yang dipilih? |
| Tim layanan pelanggan / service assurance | Menyampaikan dampak dan pembaruan layanan | Ringkasan dampak dan pesan yang sudah disetujui | Data pelanggan apa yang boleh masuk transkrip dan model AI? |
| Supervisor / pimpinan rapat | Meninjau keputusan dan pekerjaan yang belum selesai | Ringkasan singkat dengan sumber dan status tugas | Siapa berwenang menyetujui notulen dan melihat rapat lintas tim? |
| IT / pengelola aplikasi | Menjaga layanan dan akses | Kesehatan layanan, audit, konfigurasi, pemulihan | Infrastruktur, SSO, dan pemrosesan AI apa yang diizinkan? |

### Skenario prioritas

**A. Koordinasi gangguan:** buat ruang dengan referensi tiket/site, cek mikrofon, jelaskan kondisi, konfirmasi identifier, catat tindakan dan PIC, lalu serahkan ringkasan yang sudah diperiksa. Ketika STT gagal, panggilan tetap berguna dan peserta mendapat pesan yang jelas; status kegagalan tidak boleh tersembunyi di balik indikator “terhubung”.

**B. Serah terima:** tinjau pekerjaan yang masih berjalan dan konteks dari rapat sebelumnya. Kebutuhan ini bergantung pada arsip yang bisa dibuka kembali, kontrol akses, dan status tugas; belum dipenuhi hanya dengan panel transkrip saat panggilan.

**C. Progres deployment:** bahas site, tanggal, blocker, dan ketergantungan. AI menyiapkan draf keputusan/tugas dari ucapan yang tersedia. Bila PIC atau tenggat tidak disebut, tampilkan “belum ditentukan” dan minta penyuntingan; jangan mengisinya dengan tebakan.

Contoh istilah uji yang **diusulkan**, bukan inventaris perusahaan: NOC, FO, FTTx, OLT, ONT, backbone, downtime, colocation, kode site, nomor tiket, angka port, dan tanggal aktivasi. Kosakata sebenarnya harus dikumpulkan dari tim pilot.

## 4. Kondisi BaliCall saat ini

Temuan berikut berdasarkan kode dan catatan lokal, bukan audit produksi perusahaan.

| Area | Bukti lokal | Kesenjangan untuk penggunaan internal |
| --- | --- | --- |
| Panggilan | LiveKit dengan peserta dan kontrol mikrofon di [App.tsx](client/src/App.tsx) dan [MeetingRoom.tsx](client/src/MeetingRoom.tsx) | Uji banyak perangkat, jaringan kantor, reconnect, dan peserta lapangan masih diperlukan. |
| STT | Jalur browser dan backend dijelaskan di [README](README.md); hook berada di [useSpeechTranscription.ts](client/src/useSpeechTranscription.ts) dan [useBackendTranscription.ts](client/src/useBackendTranscription.ts) | Jalur backend memakai segmen sekitar 8 detik. Akurasi suara nyata, istilah teknis, serta akses penyedia dari jaringan kantor belum terbukti. |
| Simpan transkrip | Antrean di [saveQueue.ts](client/src/saveQueue.ts), identifikasi permintaan untuk retry di [app.js](server/app.js) | Data yang belum terkirim masih bergantung pada tab. Pemulihan setelah tab tertutup belum menjadi antrean tahan lama. |
| Identitas | `/api/token` menerima ID, nama, dan departemen dari form; API rapat memeriksa token ruang | Batas akses sesi sudah ada, tetapi ID/NIK yang diketik bukan bukti identitas pegawai. Belum ada SSO, kebijakan tamu, dan peran host yang lengkap. |
| Penyimpanan | [meetingStore.js](server/meetingStore.js) dan [config.js](server/config.js): berkas JSON dengan penulisan melalui file sementara | Cocok untuk prototipe satu penulis. Belum menjadi penyimpanan bersama untuk beberapa instance, arsip terotorisasi, dan pemulihan operasional. |
| Ringkasan | [providers.js](server/providers.js) menyediakan provider ringkasan | Catatan verifikasi terakhir menyatakan mode demo. Keputusan/tugas perlu sumber transkrip, penyuntingan, persetujuan, dan versi hasil. |
| Dashboard | [Workspace.tsx](client/src/Workspace.tsx) dan state rapat terakhir di `App.tsx` | Aktivitas sesi halaman belum menjadi daftar riwayat backend yang dapat dibuka setelah reload/login. |
| Fitur pada gambar konsep | [Catatan desain](docs/DESIGN_UPDATE_2026-10-05.md) | Video, screen sharing, chat, kalender, rekaman, dan tanya AI saat rapat belum diimplementasikan. Prioritasnya perlu bukti penggunaan. |

Catatan desain melaporkan **43 tes lulus** dan pemeriksaan tampilan desktop/mobile. Itu hasil pemeriksaan terdahulu; pengujian ucapan manual membuktikan penyimpanan/tampilan, **bukan** keberhasilan STT mikrofon. Penelitian ini tidak menjalankan ulang tes atau mengubah aplikasi.

Masalah awal “sudah ngobrol tetapi tidak ada teks” tetap menjadi kebutuhan produk paling mendesak. Pisahkan kondisi **suara tersambung → mikrofon menerima sinyal → STT memproses → teks muncul → teks tersimpan → ringkasan dibuat**. Setiap tahap harus memiliki status dan petunjuk pemulihan sendiri.

## 5. Kebutuhan dan urutan prioritas

P0 = wajib sebelum pilot dengan data perusahaan. P1 = melengkapi alur kerja pilot. P2 = setelah manfaat inti terbukti. Angka dan kriteria di bawah merupakan usulan, bukan SLA perusahaan.

| Prioritas | Kebutuhan | Kriteria penerimaan yang diusulkan |
| --- | --- | --- |
| P0 | Panggilan dan pemeriksaan mikrofon yang dapat dipercaya | Dua perangkat berbeda dapat mendengar satu sama lain; mute, kehilangan jaringan, dan reconnect memberikan status yang benar. |
| P0 | STT nyata dengan diagnosa yang terlihat | Ucapan dari dua peserta dikenali dan tersimpan atas identitas yang tepat; kegagalan izin, penyedia, dan simpan dibedakan; tidak ada indikator mendengarkan palsu. |
| P0 | Identitas dan izin | Token diterbitkan setelah autentikasi yang disetujui IT; pegawai/tamu tidak dapat membuka rapat di luar izinnya; peran host diuji. |
| P0 | Jalur pemrosesan data disetujui | IT menetapkan tujuan kirim audio/teks, siapa dapat membaca, dan aturan retensi. Browser STT tidak dianggap pemrosesan lokal tanpa verifikasi. |
| P0 | Penyimpanan dan pemulihan | Transkrip yang sudah diakui server tetap tersedia setelah restart; retry tidak menggandakan teks; kehilangan data yang belum tersimpan terlihat; restore diuji. |
| P0 | AI menghasilkan draf yang dapat diperiksa | Mode demo jelas; kegagalan AI tidak menghilangkan transkrip; klaim keputusan dan tugas memiliki rujukan ucapan; hasil perlu persetujuan manusia. |
| P1 | Konteks rapat | Judul, jenis rapat, referensi site/proyek/tiket, dan pemilik rapat dapat diisi. Identifier penting dapat dikonfirmasi manual. |
| P1 | Riwayat dan pencarian | Pengguna dapat membuka rapat yang diizinkan setelah reload/login dan mencari judul, konteks, atau isi transkrip. |
| P1 | Tindak lanjut | Tugas memiliki PIC, tenggat opsional, status, sumber, serta perubahan yang tercatat. |
| P1 | Akses mobile dan navigasi keyboard | Gabung, mute, lihat status, dan keluar mudah digunakan di perangkat pilot; panel teks tetap terbaca dan fokus jelas. |
| P1 | Hasil yang bisa dibagikan secara terkendali | Ekspor hasil yang disetujui; isi/akses sesuai penerima; distribusi dilakukan pengguna, bukan otomatis tanpa kebijakan. |
| P2 | Integrasi kalender/tiket/direktori | Pilih integrasi setelah sistem dan izin API perusahaan diketahui; hindari menyalin data sensitif yang tidak diperlukan. |
| P2 | Video, share screen, rekaman, tanya AI | Tambahkan hanya bila skenario pilot membuktikan kebutuhan, kapasitas tersedia, dan kebijakan data jelas. |

## 6. Implikasi untuk desain UI/UX

Pertahankan lima layar konsep pengguna, tetapi isi setiap layar mengikuti pekerjaan nyata:

1. **Beranda:** Mulai rapat, Gabung, rapat terbaru yang boleh diakses, dan tindak lanjut milik pengguna. Status layanan harus ringkas dan relevan. Banner merek dapat lebih kecil agar pekerjaan utama terlihat tanpa scroll panjang.
2. **Buat/Gabung:** judul dan kode ruang; metadata operasional opsional; identitas dari login setelah SSO tersedia; pemeriksaan mikrofon dengan hasil nyata. Hindari meminta pengguna mengisi informasi yang sudah berasal dari direktori.
3. **Ruang rapat:** peserta suara, mute, status koneksi, status STT, bahasa, teks sementara/final, serta status simpan. Mobile mengutamakan kontrol suara dan transkrip; peserta dapat dilihat melalui panel terpisah.
4. **Asisten rapat:** awalnya dapat berupa titik penting berbasis transkrip. Tanya AI ditunda sampai dapat memberi rujukan dan menyatakan ketika bukti belum cukup.
5. **Notulen:** ringkasan, keputusan, tugas, dan transkrip. Bedakan “Draf AI”, “Diperiksa”, dan “Disetujui”; tautkan setiap item ke sumber. Tampilkan siapa memeriksa dan kapan.

Gunakan logo asli sesuai proporsi. Navy/biru dapat membentuk navigasi dan aksi utama; oranye merek menjadi aksen. Status berhasil, gagal, dan menunggu tetap memakai teks/ikon sehingga makna tidak bergantung pada warna. Nilai warna presisi perlu pedoman merek resmi, bukan perkiraan dari gambar.

Jangan tampilkan tombol fitur yang belum bekerja, data rapat rekaan pada dashboard operasional, atau indikator rekaman untuk audio yang hanya diproses sementara oleh STT. Jelaskan apakah audio disimpan sebagai rekaman; transkripsi dan rekaman adalah dua keputusan berbeda.

## 7. Keputusan arsitektur yang perlu disiapkan

Ini rancangan lanjutan, **belum diimplementasikan**:

- Pertahankan pemisahan panggilan, STT, penyimpanan transkrip, dan AI. Kerusakan salah satu layanan tidak boleh disamarkan sebagai keberhasilan semua layanan.
- Uji penyedia STT yang diizinkan IT pada kosakata pilot. Pilihan internal atau eksternal bergantung kebijakan, akurasi, latensi, kapasitas, dan biaya; keberadaan gateway chat Qwen tidak membuktikan tersedianya STT.
- Sebelum skala multi-instance, pindahkan penyimpanan ke database bersama yang mendukung transaksi. Simpan rapat, keanggotaan, transkrip, versi ringkasan, tugas, dan audit; audio hanya disimpan bila memang diperlukan dan diizinkan.
- Untuk pekerjaan STT/AI yang perlu retry tahan restart, pertimbangkan antrean pekerjaan dengan ID unik, status, dan batas retry. Penyimpanan audio sementara serta waktu hapus harus eksplisit.
- Hubungkan identitas ke layanan autentikasi perusahaan yang sebenarnya. Izin membuka hasil rapat perlu tetap tersedia setelah token panggilan berakhir, sesuai kebijakan keanggotaan dan berbagi.
- Pilih HTTPS/WSS, akses RTC, dan pemulihan layanan bersama IT. Port lokal 5187 membantu development; alamat loopback belum menjadi deployment antarpegawai.
- Pantau jumlah kegagalan koneksi/STT/simpan/AI dan latensi. Log operasional memakai identifier secukupnya, tanpa menyalin seluruh percakapan atau kunci penyedia.

Sebelum memilih kapasitas, ukur peserta serentak, jumlah rapat, durasi, format audio, retensi, serta kapasitas model. Jangan menetapkan biaya atau target uptime dari angka SLA produk Data Center; kontrak itu berbeda dari aplikasi meeting.

## 8. Pilot, ukuran keberhasilan, dan roadmap

**Tahap 1 — validasi kebutuhan:** wawancarai perwakilan calon pengguna dan IT; pilih satu alur; kumpulkan template notulen serta contoh istilah yang boleh digunakan. Tetapkan pemilik produk dan aturan pemrosesan data.

**Tahap 2 — bukti teknis:** uji suara nyata pada dua perangkat, jaringan kantor, dan perangkat mobile yang digunakan tim. Sertakan noise, campuran bahasa, identifier, mute, reconnect, gangguan STT, restart backend, dan akhir rapat ketika ada data menunggu simpan. Perbaiki kegagalan sebelum data perusahaan masuk.

**Tahap 3 — pilot terbatas:** gunakan rapat rutin yang diizinkan; aktifkan autentikasi, arsip, dan pemeriksaan notulen. Bandingkan waktu serta kualitas hasil dengan cara kerja sebelumnya. Pertahankan saluran koordinasi operasional yang sudah disetujui selama pilot.

**Tahap 4 — perluasan:** tambahkan integrasi dan fitur hanya berdasarkan temuan pilot. Lakukan uji kapasitas dan pemulihan sesuai volume yang diukur; perluasan ke koordinasi kritis membutuhkan penilaian pemilik operasional.

Metrik yang dicatat, dengan baseline dan ambang lulus ditentukan bersama tim:

| Metrik | Cara menilai |
| --- | --- |
| Keberhasilan masuk dan panggilan | Percobaan bergabung yang berhasil, kegagalan, waktu sampai suara tersambung. |
| Kecepatan transkrip | Waktu dari akhir ucapan/segmen sampai teks terlihat dan diakui server; laporkan median dan p95. |
| Akurasi konteks operasional | Sampel yang dianotasi manusia; ukur salah kata serta ketepatan kode site, angka, nama, PIC, dan tanggal secara terpisah. |
| Integritas hasil | Data hilang/duplikat pada gangguan; item AI tanpa dukungan ucapan; koreksi yang diperlukan. |
| Penghematan pekerjaan | Waktu dari rapat selesai sampai notulen disetujui dibanding cara lama, termasuk waktu koreksi. |
| Tindak lanjut | Tugas yang PIC/statusnya jelas dan dapat ditemukan kembali; bukan jumlah ringkasan yang dibuat. |
| Kelayakan operasional | Pemakaian kembali oleh tim, alasan meninggalkan aplikasi, biaya per jam rapat, dan kapasitas serentak yang terbukti. |

Belum ada baseline atau data yang mendukung klaim penghematan, akurasi, ROI, maupun skala produksi.

## 9. Pertanyaan untuk perusahaan sebelum development berikutnya

1. Tim pertama dan pekerjaan paling mendesak: insiden, serah terima, deployment, atau rapat umum?
2. Apa masalah cara kerja saat ini, dan apakah masalah itu cukup besar untuk memakai aplikasi rapat tambahan?
3. Siapa peserta, host, pemeriksa notulen, dan penerima hasil? Apakah vendor ikut?
4. Sistem apa yang sekarang dipakai untuk identitas, kalender, tiket, proyek, dan tindak lanjut? Adakah API yang diizinkan?
5. Data apa yang boleh ditranskripsi, dikirim ke penyedia AI, disimpan, dan diekspor? Siapa menetapkan retensi/hapus dan aksesnya?
6. Apakah audio perlu diarsipkan atau cukup transkrip? Bagaimana pemberitahuan kepada peserta dan penghentian pemrosesan?
7. Berapa volume aktual: pengguna, peserta per rapat, rapat serentak, durasi, perangkat, dan kondisi koneksi?
8. Istilah/identifier apa yang paling mahal jika salah? Adakah contoh rapat yang disetujui untuk evaluasi?
9. Apa baseline keberhasilan, anggaran, pemilik layanan, dan prosedur saat aplikasi gagal?
10. Apakah video atau screen sharing wajib sejak awal? Bila wajib, apa contoh tugas yang tidak dapat diselesaikan dengan suara dan dokumen yang sudah ada?

## 10. Sumber dan catatan penelusuran

Semua sumber publik diakses pada **5 Oktober 2026**. Tanggal akses tidak berarti seluruh isi situs diperbarui pada tanggal yang sama.

| Sumber | Penggunaan dalam riset | Catatan |
| --- | --- | --- |
| [BaliTower — situs resmi](https://www.balitower.co.id/) | Profil, kategori layanan, nama perusahaan, pencapaian historis | Tidak digunakan untuk menyatakan jumlah aset, pegawai, atau masa berlaku sertifikasi. |
| [BaliTower — Menara & Jaringan](https://www.balitower.co.id/service/menara-jaringan) | Built-to-Suit, Collocation, NOC 24/7 | Isi diperiksa dari [berkas halaman publik resmi](https://www.balitower.co.id/assets/MenaraJaringan-BaVJBUOX.js); pembaca web gagal mengambil route. Nama berkas dapat berubah. |
| [Balifiber — Home](https://www.balifiber.id/home/bf_home) | Segmen residensial/korporasi dan hubungan dengan BaliTower | Halaman produk, bukan bukti cara kerja internal pegawai. |
| [Balitower — Data Center](https://www.balifiber.id/home/bt_datacenter) | Konteks layanan colocation dan keamanan fasilitas | Ada teks placeholder. Tidak dijadikan SLA atau sertifikasi BaliCall. |
| [Investor — Laporan Tahunan](https://www.balitower.co.id/investor/laporan-tahunan) | Penemuan daftar laporan terbaru | Daftar diperiksa dari [berkas halaman resmi](https://www.balitower.co.id/assets/Tahunan-ChxS_5Hm.js). |
| [Tautan Laporan Tahunan 2025](https://www.balitower.co.id/assets/pdfs/annual_reports/20260519171340-laporantahunan.pdf) | Referensi pendalaman berikutnya | Ditemukan dalam daftar resmi; isi PDF belum terbaca karena gagal diambil pembaca web. Tidak diklaim telah dianalisis. |
| [README proyek](README.md), [catatan desain](docs/DESIGN_UPDATE_2026-10-05.md), kode client/server yang dirujuk di atas | Kondisi prototipe dan batas verifikasi | Dokumen ini mencerminkan working tree lokal, bukan pernyataan kondisi branch GitHub atau produksi perusahaan. |

Situs alternatif, profil pegawai, agregator perangkat lunak, dan cuplikan laporan di Scribd tidak dijadikan dasar klaim sistem internal perusahaan. Penelusuran tidak membuktikan penggunaan vendor tertentu. Tahap lanjutan yang paling menentukan adalah validasi alur dengan pengguna internal dan evaluasi STT suara nyata.
