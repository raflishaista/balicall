# P1-07–P1-10 — Pengaturan workspace

Tanggal: 6 Oktober 2026. Baseline terbaru: `main` / `ffbd333` (`addscheduling`). Branch kerja: `testingsam`, mengikuti baseline melalui fast-forward. Pengaturan digabungkan dengan fitur Jadwal Rapat.

## Hasil dan batas cakupan

Konsep pengguna diterapkan untuk overview Pengaturan, Audio & Video, serta Tampilan Rapat. Menu ada di sidebar, kategori dapat dicari, identitas rapat ditampilkan secara informatif, dan kartu integrasi berikutnya diberi status jelas. Logo dan warna mengikuti workspace yang sudah ada.

Preferensi disimpan di `localStorage` browser ini dengan schema versi 1. Ini belum sinkronisasi per akun/perangkat melalui database. Tidak ada endpoint profil, 2FA, notifikasi, perekaman video, atau role admin baru. Field identitas berasal dari formulir rapat; pengguna tidak diasumsikan sudah login lewat sesi perusahaan.

## Alur data

`Pengaturan → draft → Simpan → validasi schema/localStorage → preferensi App → prejoin → snapshot pilihan saat bergabung → publikasi/render media LiveKit`.

- `SettingsPage.tsx/.css`: overview, form perangkat, switch tampilan, desktop/mobile, dan status penyimpanan.
- `preferences.ts` / `usePreferences.ts`: whitelist preferensi, versioning, fallback data rusak, kegagalan storage, serta pemetaan pilihan input.
- `usePreJoinMedia.ts`: menerima pilihan awal dan menyediakan `applyChoices`, menghentikan preview lama sebelum preferensi baru diterapkan.
- `usePreferredAudioOutput.ts`: menerapkan output tersimpan setelah koneksi pertama, fallback ketika tidak tersedia, mengabaikan enumerasi terlambat setelah disconnect, mempertahankan pilihan manual saat reconnect, dan membersihkan warning setelah pergantian output.
- `MeetingRoom.tsx` / `ParticipantVideoTile.tsx` / `PreJoinPreview.tsx`: grid/sorotan, mirror video lokal, dan orientasi preview.
- `App.tsx` / `Workspace.tsx`: navigasi Pengaturan, snapshot preferensi per call, reduced motion, dan handoff ke preview.

Membuka Pengaturan hanya melakukan enumerateDevices. Menyimpan kondisi awal mic/kamera tidak menangkap media. Capture memerlukan aksi preview/tes atau bergabung. Device ID hanya disimpan sebagai preferensi browser; schema tidak menyimpan nama, NIK, atau token.

Speaker mengikuti dukungan browser dan izin perangkat. Pilihan tidak terlihat diberi pesan; browser yang tidak mendukung output selection menggunakan output sistem. Pergantian perangkat selama rapat tetap dilakukan lewat dialog P1-03 dan tidak otomatis menimpa default tersimpan. Input mikrofon LiveKit belum mengendalikan input Web Speech API; batasan STT tersebut masih berlaku.

## Perbaikan frontend dari review main

- **MAIN-01:** SummaryView dirender saat view notulen aktif, termasuk summary null. Loading, error, transkrip, dan retry bisa terlihat. Sidebar tetap menyediakan akses ketika notulen gagal.
- **MAIN-03:** URL ekspor menggunakan API_BASE dan meetingPath yang sama dengan API utama; tidak lagi memaksa localhost:3001.
- Respons notulen lama diberi guard generation sehingga tidak mengisi hasil sesi baru.
- Kegagalan saveQueue.flush diteruskan ke UI. Meeting tidak ditutup atau diringkas ketika masih ada ucapan gagal tersimpan; pengguna dapat retry.
- Kontras breadcrumb/header Pengaturan serta tombol kembali diperbaiki berdasarkan hasil axe.

**MAIN-02 tetap terbuka:** urutan route riwayat PostgreSQL perlu dibenahi oleh Person 2. Perubahan frontend tidak membuktikan timeout Qwen atau integrasi database sebenarnya sudah selesai.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit frontend | 105/105 lulus |
| Unit backend main | 22/22 lulus |
| Build dan lint | Exit 0; warning bundle JS >500 kB dan 10 warning bawaan update Jadwal masih ada |
| Alur browser | 10 pemeriksaan lulus, 0 page errors; lihat [SETTINGS_VERIFICATION.json](./SETTINGS_VERIFICATION.json) |
| Layout | Desktop 1440×1000 dan mobile 390×844 |
| Axe | Nol pelanggaran otomatis pada overview, audio/video, display desktop, display mobile; incomplete kontras perlu review manual |

Pengujian browser menggunakan Edge headless, backend port acak, provider demo, storage sementara, dan SFU LiveKit lokal. Media/recognition adalah fixture. Respons timeout, ekspor, serta keterlambatan notulen disimulasikan. `DATABASE_URL` dikosongkan dalam proses harness; tidak menjalankan initDb/migrasi/SQL perusahaan dan tidak menghubungi Office LLM.

Harness juga menguji storage ditolak, output tidak didukung, capture mati saat mic/kamera default off, input kamera terpilih, output room, mirror off, grid mode, cleanup setelah keluar, loading/error/retry notulen, URL ekspor, hasil lama yang terlambat, serta retry transkrip gagal.

### Menjalankan ulang

```powershell
npm --prefix client run build
npm test
npm --prefix client run lint
# Set path ke instalasi Playwright/axe-core yang sudah tersedia pada mesin testing.
$env:PLAYWRIGHT_MODULE_PATH = '<path-playwright>'
$env:AXE_CORE_PATH = '<path-axe.min.js>'
node scripts/verify-settings.mjs
```

LiveKit lokal harus tersedia di port 7880 dengan devkey/secret untuk harness ini. Jangan menjalankan `scripts/test_db.js` untuk pengujian frontend karena skrip tersebut melakukan inisialisasi database.

## Screenshot aplikasi

- [Overview desktop](./screenshots/settings-overview-desktop.png)
- [Audio & Video desktop](./screenshots/settings-audio-video-desktop.png)
- [Tampilan desktop](./screenshots/settings-display-desktop.png)
- [Overview mobile](./screenshots/settings-overview-mobile.png)
- [Audio & Video mobile](./screenshots/settings-audio-video-mobile.png)
- [Tampilan mobile](./screenshots/settings-display-mobile.png)
- [Loading notulen yang sudah tampil](./screenshots/settings-summary-processing.png)
- [Integrasi Jadwal desktop](./screenshots/settings-schedule-desktop.png)
- [Integrasi Jadwal mobile](./screenshots/settings-schedule-mobile.png)

## Acceptance manual

- Coba headset/webcam kantor: simpan pilihan, reload, tes sebelum rapat, join, lalu ganti perangkat selama rapat.
- Cabut perangkat yang tersimpan; pastikan pesan membantu memilih perangkat yang tersedia dan status capture benar.
- Uji audio peserta remote memakai headset fisik; output sintetis hanya memverifikasi pemanggilan SDK/state, belum kualitas suara.
- Uji izin kamera/mic/output nyata dan browser target perusahaan.
- Uji keyboard Tab/Space pada switch, fokus, screen reader, dan contrast incomplete dari axe.
- Uji reduced motion dari sistem dan preferensi aplikasi; mirror tidak mengubah video remote/screen share.
- Koordinasikan akun/profil, notifikasi, kebijakan AI per room, rekaman, retensi, dan admin sesuai backlog P1-11–P1-14.

## Handoff

Lanjutkan dari branch `testingsam` di atas `ffbd333`. Jangan menganggap semua file untracked sebagai bagian perubahan ini: `.agents/`, `anti-slop/`, serta laporan/screenshot skenario monitoring sebelumnya sudah ada sebelum task Pengaturan. `.env` tetap lokal dan tidak boleh dimasukkan commit.

## Integrasi dengan update Jadwal Rapat

Lima blok konflik diselesaikan dengan mempertahankan kedua fitur: union view mencakup `schedule` dan `settings`, sidebar menerima `onSchedule` serta `onSettings`, breadcrumb mengenali keduanya, import ikon Calendar/Settings digabung, dan ScheduleView/SettingsPage dirender sesuai navigasi. Reduced motion serta akses notulen saat gagal tetap aktif.

Menu mobile menggunakan tiga kolom sehingga enam menu dapat tersusun dalam dua baris tanpa meluber. Harness diperluas untuk membuat jadwal fixture melalui API demo, berpindah Jadwal–Pengaturan pada desktop/mobile, mempertahankan preferensi, bergabung ke kode ruang jadwal dengan mic/kamera nonaktif, dan membatalkan jadwal milik harness setelah keluar.

Fitur Jadwal dari main tetap memiliki isu terpisah: endpoint create/cancel belum memakai autentikasi sesi, auto-slug judul, serta preset durasi melewati tengah malam. Pengujian integrasi mengisi kode ruang eksplisit dan waktu dalam satu hari. Ini tidak membuktikan isu tersebut sudah diperbaiki; autentikasi tetap perlu koordinasi Person 2 sebelum produksi.
