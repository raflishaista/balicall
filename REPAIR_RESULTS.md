# Log pemeriksaan dan perbaikan BaliCall

Tanggal: 2 Oktober 2026 (Asia/Bangkok)  
Repo: `https://github.com/raflishaista/balicall`  
Commit awal: `0d63cb5bb4a2ed70f0b61063ba27d741ee647c5f`

## Gejala dan temuan utama

Gejala yang dilaporkan: percakapan sudah berlangsung, tetapi teks/transkrip tidak muncul. Di klien, efek React yang mengelola pengenal ucapan bergantung pada callback yang berubah pada setiap render. Pembaruan berkala dapat membuat pengenal dihentikan dan dibuat ulang berulang kali; penangan `onend` juga memakai nilai `isListening` lama. Siklus ini berisiko memutus pengenalan sebelum hasil ucapan disimpan.

Ada dua jalur pengenalan teks: Web Speech API di browser dan STT server opsional. Jalur server memerlukan endpoint dan model STT yang belum diberikan/dikonfigurasi, jadi STT server belum dapat diuji dengan layanan kantor.

## Yang sudah dikerjakan

- Menstabilkan siklus hidup pengenal ucapan browser, penangan hasil akhir, restart setelah berhenti, status/error UI, dan transkrip akhir ketika pengguna berhenti dengan normal.
- Menambahkan jalur STT server opsional yang mengirim segmen audio dari trek LiveKit ke endpoint multipart. Kredensial dan konfigurasi tetap di server; segmen direkam dengan batas hening.
- Membuat antrean simpan transkrip berurutan dengan retry terbatas, ID idempotensi yang sama untuk retry, dan aksi retry manual. Keluar/meringkas rapat menunggu hasil ucapan, segmen audio, dan antrean simpan selesai; kegagalan simpan tidak diam-diam membuang pengguna dari rapat.
- Memisahkan server menjadi modul aplikasi, konfigurasi, penyimpanan rapat, dan provider; menambahkan validasi input, pemeriksaan JWT dan pembatasan token ke sesi rapat.
- Memisahkan ID sesi dan nama room LiveKit, menambahkan persistensi JSON atomik, heartbeat/presence, pengarsipan sesi idle, dan pemeriksaan status SFU melalui RoomService.
- Memvalidasi keluaran ringkasan serta menangani timeout/kegagalan provider. Mode demo tidak lagi mengarang keputusan atau tugas.
- Memperbarui setup LiveKit, konfigurasi contoh, proxy API dev, `.gitignore`, `start.bat`, paket test, serta dokumentasi Bahasa Indonesia.

Dokumen awal arsitektur/temuan: [`PROJECT_REVIEW.md`](PROJECT_REVIEW.md). Rencana dan kriteria perbaikan: [`REPAIR_PLAN.md`](REPAIR_PLAN.md).

## Verifikasi yang sudah selesai

- `npm test`: 43 test lulus (25 client, 18 server), tidak ada yang gagal atau dilewati.
- `npm --prefix client run lint`: lulus.
- `npm --prefix client run build`: lulus. Bundel JavaScript sekitar 839 kB sebelum gzip; Rollup memberi peringatan ukuran chunk lebih dari 500 kB.
- `git diff --check`: lulus.
- Verifikasi browser lokal: UI dapat bergabung ke room LiveKit, mengirim baris transkrip sintetis melalui API, memuatnya kembali, lalu menampilkan ringkasan setelah keluar. Sesi baru memakai room terpisah dan tidak menampilkan transkrip sesi lama.
- LiveKit lokal berhasil dijalankan dan status room dapat diperiksa. Setup PowerShell berhasil memakai aset lokal; unduhan rilis LiveKit v1.13.7 sebelumnya juga diverifikasi dengan SHA-256 resmi.

## Batas verifikasi

- Audio mikrofon nyata sampai menjadi teks **belum terverifikasi**. Izin mikrofon browser tidak diberikan saat pemeriksaan UI, dan layanan STT kantor belum dikonfigurasi. Tes browser di atas menggunakan baris teks sintetis, bukan ucapan.
- Web Speech API bergantung pada dukungan browser, izin mikrofon, dan layanan pengenalan yang tersedia bagi browser. Jalur STT server perlu diuji dengan URL, model, dan kredensial lingkungan kantor yang sebenarnya.
- Belum diuji lintas komputer melalui LAN dengan HTTPS/WSS. Pastikan browser klien menggunakan origin HTTPS dan LiveKit memakai WSS; `localhost` hanya sesuai untuk pengujian mesin yang sama.
- Login saat ini identitas demo, bukan SSO kantor. Penyimpanan JSON ditujukan untuk satu proses server; evaluasi database bersama bila beberapa instance atau penulisan serentak diperlukan.
- Kode setup yang mengekstrak hanya binary/license sudah diubah untuk menjaga lisensi tracked, tetapi jalur ekstraksi baru itu belum dicoba ulang dari cache unduhan yang bersih.

## Status proyek saat serah-terima

- Perubahan tersimpan lokal di folder clone dan belum di-commit atau di-push.
- `server/data/browser-verification.json` adalah data lokal hasil pemeriksaan dengan percakapan sintetis, bukan data rapat pengguna; lokasinya diabaikan Git.
- Bundel klien besar adalah catatan optimasi, bukan kegagalan build.
- `.env` lokal dipakai untuk menjalankan aplikasi. Jangan menyalin rahasia ke commit atau chat; atur endpoint/model STT di lingkungan lokal.

## Langkah berikut yang disarankan

1. Dapatkan URL endpoint STT kantor, nama model, format autentikasi, batas ukuran/durasi audio, dan format respons yang diharapkan. Atur nilai lokal dari `server/.env.example` tanpa memasukkan rahasia ke Git.
2. Uji percakapan mikrofon nyata di browser yang didukung: izin mikrofon, transkrip parsial/final, retry saat jaringan terputus, lalu keluar rapat dan pastikan semua teks tersimpan.
3. Uji dari dua komputer melalui HTTPS/WSS untuk validasi audio, presence, dan sesi terpisah.
4. Bahas integrasi SSO dan persistensi database bila aplikasi akan dipakai di luar prototipe satu server.
