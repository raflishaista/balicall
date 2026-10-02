# Serah-terima pengembangan BaliCall untuk Antigravity

## Konteks

Clone proyek ada di `C:\Users\heraldmichain.intern\Documents\RecordMeeting\balicall`. Repo asal: `https://github.com/raflishaista/balicall`, commit awal `0d63cb5bb4a2ed70f0b61063ba27d741ee647c5f`.

Perbaikan saat ini hanya ada di working tree lokal, belum di-commit/push. Sebelum mengubah apa pun, periksa `git status` dan pertahankan perubahan yang sudah ada. Jangan mengganti folder clone dengan salinan upstream.

## Mulai dari sini

1. Baca `README.md` untuk arsitektur, instalasi, konfigurasi, dan cara menjalankan.
2. Baca `REPAIR_RESULTS.md` untuk gejala, diagnosis, perubahan, verifikasi, dan batas tes.
3. Baca `REPAIR_PLAN.md` untuk tahapan dan kriteria penerimaan.
4. `PROJECT_REVIEW.md` menyimpan tinjauan arsitektur awal.

## Kondisi teknis saat ini

Perbaikan inti mengatasi siklus Web Speech API yang dapat terus ter-reset karena dependensi callback React yang tidak stabil. Aplikasi juga memiliki jalur STT server pilihan, antrean transkrip dengan retry/idempotensi, penyimpanan rapat persisten, token yang dibatasi ke sesi, serta validasi ringkasan.

Verifikasi otomatis terakhir: 43 test lulus, lint lulus, build lulus, dan pemeriksaan whitespace lulus. Browser lokal berhasil memeriksa alur LiveKit → simpan/muat transkrip sintetis → tampilkan ringkasan. Ini **belum membuktikan audio mikrofon nyata ditranskripsikan**. Izin mikrofon tidak diberikan saat verifikasi dan belum tersedia URL/model STT kantor. Jangan menandai masalah ucapan sebagai selesai sebelum uji nyata tersebut lulus.

## Pekerjaan lanjutan yang paling penting

1. **Hubungkan layanan STT kantor.** Minta administrator/developer memberikan URL, model, metode auth, format file audio yang diterima, batas ukuran/durasi, serta contoh respons/error. Masukkan konfigurasi hanya ke `.env` lokal/server. Cocokkan implementasi provider di `server/providers.js` dan konfigurasi di `server/.env.example` bila format layanan berbeda.
2. **Uji ucapan dari awal sampai akhir.** Beri izin mikrofon, bicarakan beberapa kalimat, cek teks muncul dan tersimpan, uji gangguan jaringan/retry, kemudian keluar rapat dan pastikan teks terakhir masuk ke ringkasan. Pastikan juga tidak ada pengiriman teks/audio ganda.
3. **Uji dua perangkat lewat jaringan kantor.** Konfigurasikan HTTPS/WSS dan alamat server yang bisa dijangkau klien; uji room, audio, heartbeat/presence, dan sesi yang terisolasi.
4. **Tentukan kebutuhan produksi.** Identitas sekarang masih demo; rencanakan SSO. Penyimpanan JSON sesuai server satu proses; jika perlu beberapa instance atau banyak penulis, rencanakan database bersama.
5. **Pertimbangkan ukuran bundle.** Build lulus dengan peringatan chunk JavaScript sekitar 839 kB sebelum gzip. Pecah lazy-load hanya jika prioritas performa produk membutuhkannya.

## Perintah lokal

Jalankan dari folder `balicall`:

```powershell
npm test
npm --prefix client run lint
npm --prefix client run build
```

Setup/run aplikasi dijelaskan di `README.md`. Gunakan versi Node yang tercantum di README. Jangan commit `.env`, rekaman, atau kredensial.

## Pesan awal untuk melanjutkan di Antigravity

```text
Lanjutkan pengembangan dari working tree lokal yang sudah ada; jangan reset atau menimpa perubahan. Baca README.md, REPAIR_RESULTS.md, REPAIR_PLAN.md, dan PROJECT_REVIEW.md. Fokus utama adalah memastikan percakapan mikrofon benar-benar menjadi transkrip: periksa jalur Web Speech API dan konfigurasi provider STT server. Sebelum integrasi STT, identifikasi konfigurasi yang kurang dan minta URL/model/auth/format audio dari pemilik layanan; jangan mengarang nilai atau menaruh rahasia di source code. Setelah tersedia, implementasikan integrasi, uji audio nyata dan simpan transkrip sampai ringkasan, lalu jalankan npm test, lint, dan build. Laporkan jelas bukti uji serta batas yang masih ada.
```
