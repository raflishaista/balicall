# Rencana perbaikan BaliCall

Tanggal: 2 Oktober 2026.

## Urutan implementasi

1. **P0 — Suara menjadi teks.** Pertahankan recognizer saat render ulang; tampilkan kondisi mikrofon, koneksi, dan layanan STT yang sebenarnya. Tambahkan jalur STT melalui backend untuk layanan audio/transcriptions yang kompatibel, supaya tidak wajib memakai layanan pengenalan browser. Kunci STT tetap di server. Jalur ini membutuhkan endpoint/model STT yang benar; Qwen untuk ringkasan tidak dianggap sebagai STT.
2. **P0 — Teks tidak hilang.** Antrean penyimpanan dengan ID permintaan, retry terbatas, dan tombol retry. Hentikan transkripsi dan tunggu antrean tersimpan sebelum membuat ringkasan. Tampilkan kegagalan agar pengguna dapat mencoba kembali tanpa keluar panggilan.
3. **P1 — Meeting dan jaringan.** API relatif melalui proxy, URL LiveKit dapat dikonfigurasi, ID sesi meeting terpisah dari nama room, dan penyimpanan disk atomik. Sesi yang selesai tidak bercampur dengan meeting berikutnya. Tampilkan kegagalan koneksi LiveKit.
4. **P1 — Ringkasan yang dapat dipercaya.** Gunakan transkrip server, batasi waktu panggilan model, validasi schema hasil, dan jangan menyamarkan kegagalan model sebagai ringkasan AI sukses.
5. **P1 — Verifikasi dan panduan.** Tes regresi transkripsi, antrean, API, restart/persistensi, pemisahan sesi, respons model rusak, timeout, dan integrasi STT menggunakan layanan mock. Build, lint, serta pemeriksaan browser. Dokumentasikan konfigurasi lokal dan antar-PC.

## Batas integrasi yang perlu lingkungan kantor

- Aktivasi STT internal membutuhkan URL/model dan, bila diperlukan, kunci yang dimasukkan langsung ke `.env` lokal. Implementasi dapat diuji dengan mock, tetapi kualitas pengenalan suara nyata harus diuji terhadap layanan sebenarnya.
- Login karyawan yang memverifikasi identitas membutuhkan sistem autentikasi kantor. Token meeting dapat membatasi akses API per sesi, tetapi login demo bukan bukti identitas karyawan. Integrasi SSO dijadwalkan setelah penyedia identitas ditentukan.
- Pengujian dua PC, HTTPS/WSS, jaringan SFU, dan mikrofon nyata memerlukan akses ke lingkungan tersebut. Hasilnya akan dibedakan dari pengujian otomatis lokal.

## Kriteria penerimaan

- Timer/polling tidak menghentikan transkripsi; mute/disconnect menghentikan pengambilan suara.
- POST gagal tidak membuang kalimat; retry tidak menduplikasi transkrip.
- Ringkasan menunggu penyimpanan lokal selesai dan tidak mengambil snapshot browser yang tertinggal.
- Restart backend mempertahankan transkrip; meeting baru memiliki ID dan riwayat sendiri.
- Error jaringan, timeout, dan format model salah ditampilkan dengan jelas.
- Jalur backend STT diuji tanpa mengirim audio atau kunci ke endpoint yang tidak dikonfigurasi pengguna.

Status implementasi dan hasil tes diperbarui setelah pekerjaan selesai.
