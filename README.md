# BaliCall — voice call dan notulen meeting

Aplikasi React/Vite untuk panggilan LiveKit, transkripsi mikrofon setiap peserta, dan ringkasan dari Office Qwen atau Gemini.

**Audio panggilan, speech-to-text, dan ringkasan adalah tiga layanan terpisah.** Suara yang terdengar di panggilan belum membuktikan layanan STT berjalan. Qwen pada endpoint chat hanya menerima teks.

## Menjalankan di Windows

Gunakan Node.js 24 LTS, minimum 22.18. Dari direktori proyek:

```powershell
npm run setup
npm run sfu       # terminal 1: LiveKit, port 7880
npm run server    # terminal 2: API, port 3001
npm run client    # terminal 3: Vite, port 5173
```

Buka [http://localhost:5173](http://localhost:5173). `start.bat` menjalankan setup dan ketiga layanan. Setup dapat dijalankan dari direktori lain, mengunduh LiveKit v1.13.7 dari rilis resmi, memverifikasi SHA-256, dan berhenti jika instalasi gagal.

Untuk hanya menyiapkan konfigurasi/dependensi tanpa mengunduh SFU:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipLiveKitDownload
```

Pengujian dan build:

```powershell
npm test
npm --prefix client run build
npm --prefix client run lint
```

Setelah build, backend juga dapat menyajikan frontend dari `client/dist`: jalankan backend lalu buka [http://localhost:3001](http://localhost:3001). Ini memakai API dengan origin yang sama dan tidak membutuhkan Vite untuk menjalankan aplikasi.

## Konfigurasi STT

Edit `server/.env`, yang dibuat dari `server/.env.example`. Kunci hanya diletakkan di server, bukan variabel `VITE_*`.

### Browser STT

```env
STT_PROVIDER=browser
```

Pilih Bahasa Indonesia atau English di panggilan. Browser harus mendukung Web Speech API dan memiliki izin mikrofon. Beberapa browser memakai layanan pengenalan online, sehingga layanan tersebut harus bisa diakses dari jaringan kantor. [Rujukan SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

Transkripsi mulai saat koneksi suara siap dan mikrofon aktif. Render timer/polling tidak membuat recognizer baru. Mute/disconnect menghentikan pengambilan suara. Jika error jaringan/izin muncul, perbaiki penyebabnya lalu tekan tombol transkripsi untuk mencoba kembali.

### Backend STT

Jika kantor menyediakan layanan yang kompatibel dengan `POST /audio/transcriptions`, konfigurasi base URL hingga `/v1` dan **nama model STT yang benar dari layanan tersebut**:

```env
STT_PROVIDER=server
STT_BASE_URL=http://HOST-STT-KANTOR:8000/v1
STT_MODEL=NAMA-MODEL-STT
STT_API_KEY=
STT_TIMEOUT_MS=20000
```

Nilai host/model di atas adalah placeholder. Jangan menyalin alamat gateway Qwen tanpa memastikan gateway itu menyediakan STT. API key boleh kosong jika layanan internal tidak memerlukannya.

Browser merekam track mikrofon LiveKit yang sedang digunakan, menjadi file lengkap setiap sekitar 8 detik. Segmen yang tidak terdeteksi memiliki sinyal suara dilewati. File dikirim melalui API aplikasi ke layanan STT; browser tidak menerima kunci penyedia. Format yang didukung: WebM/Opus, Ogg/Opus, atau MP4 sesuai dukungan browser. Layanan STT harus dapat membaca format yang dipilih browser. Hasil tampil setelah segmen dikirim dan diproses, bukan setiap kata secara langsung.

Kontrak upstream: multipart `file`, `model`, `language` (`id`/`en`), `response_format=json`; respons `{ "text": "hasil transkripsi" }`. [Rujukan kontrak audio transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription).

Jalur ini sudah diuji menggunakan layanan simulasi. Keakuratan model dan pengenalan mikrofon sungguhan memerlukan layanan STT yang sebenarnya.

## Konfigurasi ringkasan

Office gateway:

```env
LLM_PROVIDER=office
LLM_BASE_URL=http://10.7.1.21/v1
LLM_MODEL=qwen-35b
LLM_KEY=ISI_KUNCI_DI_FILE_LOKAL
LLM_TIMEOUT_MS=30000
```

Alternatif: `LLM_PROVIDER=gemini` dengan `GEMINI_API_KEY`. Untuk pratinjau tanpa AI: `LLM_PROVIDER=demo`.

Jika penyedia yang dipilih belum memiliki kunci, UI menampilkan **Demo (AI belum aktif)**. Demo hanya menampilkan transkrip, tanpa mengarang keputusan atau penugasan. Jika penyedia yang sudah dikonfigurasi gagal/timeout atau mengembalikan JSON dengan schema salah, API mengembalikan error yang dapat dicoba ulang. Kegagalan tersebut tidak diganti diam-diam dengan ringkasan demo.

## Meeting, penyimpanan, dan keluar panggilan

- Nama room adalah nama yang terlihat pengguna. Backend membuat ID sesi dan nama room LiveKit unik. Peserta pada nama room yang sama bergabung ke sesi aktif yang sama.
- Token LiveKit juga dipakai sebagai Bearer token untuk mengakses transkrip, audio, kehadiran, ringkasan, dan keluar dari sesi yang sesuai. Identitas pembicara diambil dari token.
- Transkrip dan ringkasan tersimpan di `server/data/meetings.json` dengan penulisan atomik. Restart backend mempertahankan data. `MEETING_DATA_FILE` dapat menunjuk file lain dengan path absolut. Hanya satu proses backend boleh menulis file tersebut.
- Kehadiran dicatat setelah frontend melaporkan koneksi LiveKit berhasil, lalu diperbarui setiap 10 detik. Ini belum memverifikasi identitas karyawan melalui SSO.
- Penyimpanan teks/audio berurutan. Retry mempertahankan ID permintaan agar respons jaringan yang hilang tidak menduplikasi kalimat. Jika tetap gagal, antrean dipertahankan dan tombol **Coba simpan lagi** tampil.
- **Keluar & Buat Ringkasan** menyelesaikan pengambilan ucapan lokal, menunggu antrean tersimpan, meminta ringkasan dari data server, lalu mencatat pengguna keluar. Kegagalan mempertahankan layar panggilan; transkripsi dapat diaktifkan lagi untuk melanjutkan.
- Peserta lain tetap dapat berbicara ketika seseorang keluar. Ringkasan orang yang keluar adalah snapshot, bukan penutupan room bersama. Sesi selesai setelah peserta terakhir keluar. Sesi tanpa heartbeat selama 45 detik diarsipkan ketika ada permintaan bergabung berikutnya.
- Antrean yang belum diterima server berada dalam memori tab. Ada peringatan sebelum menutup tab jika antrean masih berisi data. Jangan menutup/reload tab sampai antrean kosong. Data yang sudah diterima server tetap di disk.

API meeting sekarang memakai `/api/meetings/:meetingId/...`, bukan nama room. Endpoint `/api/token` mengembalikan `meetingId` dan `token`; permintaan berikutnya memakai `Authorization: Bearer TOKEN`. Integrasi client lama perlu disesuaikan.

## Menggunakan beberapa PC

Frontend memakai `/api` secara default. Vite meneruskan `/api` ke backend lokal pada PC server; build produksi dapat disajikan langsung oleh backend di origin yang sama. Bila frontend/API berbeda host, gunakan `client/.env` dengan `VITE_API_BASE_URL` dan set `CORS_ORIGINS` ke origin frontend yang benar.

Untuk peserta di PC lain:

1. Sajikan aplikasi melalui **HTTPS** yang dipercaya browser. HTTP lewat IP LAN biasa tidak memberikan secure context untuk mikrofon.
2. Set `LIVEKIT_URL` ke alamat **WSS** yang dapat dijangkau semua peserta. `127.0.0.1` hanya sesuai pengujian pada PC yang sama.
3. Backend dapat memakai `LIVEKIT_INTERNAL_URL` terpisah untuk pemeriksaan SFU. Endpoint health menguji `RoomService.listRooms` dengan timeout; hasil reachability tidak mengukur kualitas audio WebRTC.
4. Konfigurasikan jaringan/port RTC sesuai [panduan deployment LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/). Proxy HTTPS saja belum membuktikan UDP/TCP media berhasil lintas PC.
5. Gunakan kunci LiveKit sendiri untuk produksi. Backend menolak kunci dev ketika `NODE_ENV=production`.

Endpoint penerbitan token masih untuk identitas demo yang dimasukkan pengguna. Token per meeting membatasi akses sesi, tetapi **tidak menggantikan login karyawan**. Integrasi SSO kantor dan penerbit token terpercaya diperlukan sebelum membuka aplikasi sebagai layanan bersama untuk data kantor.

## Memeriksa masalah suara tanpa teks

1. Di lobby, gunakan **Test Mic Input** dan pastikan level bergerak.
2. Di panggilan, pastikan Voice menunjukkan connected dan mikrofon aktif. Status Transcription harus Listening.
3. Browser STT: cek error layanan/izin/jaringan dan bahasa yang dipilih. Backend STT: cek endpoint/model, format audio, dan koneksi dari backend ke layanan STT.
4. Pastikan antrean penyimpanan kosong dan kalimat final tampil di Live Transcript.
5. Uji dua peserta dengan identitas berbeda, lalu diam sebentar, mute/unmute, dan berbicara lagi. ID yang sama pada dua jendela ditolak agar tidak saling menggantikan peserta LiveKit.

[Rencana perbaikan](REPAIR_PLAN.md), [hasil implementasi](REPAIR_RESULTS.md), dan [laporan pemeriksaan awal](PROJECT_REVIEW.md) tersedia di repository.
