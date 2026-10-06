# P1-06 — Layout, aksesibilitas, dan verifikasi media

Tanggal: 6 Oktober 2026. Branch: `testingsam`. Perubahan setelah `cabb56d`, disertakan dalam commit gabungan P1-05/P1-06.

## Hasil dan perbaikan

- Kontrol rapat dipindahkan keluar dari area video yang bergulir. Desktop menempatkan panel transkrip di kanan; layar sampai 1024 px menempatkannya di bawah media dengan kontrol sticky. Pada mobile, enam kontrol disusun tiga kolom, dan tombol **Keluar** tetap tersedia. Target kontrol utama minimal 44 px tinggi; padding bawah memakai safe area. Layar desktop pendek dapat bergulir tanpa memotong kontrol. Nama ruang/peserta panjang tidak memperlebar halaman.
- Tab Transkrip/Peserta memiliki `tablist`, `tab`, `tabpanel`, hubungan ID, status pilihan, dan satu tab dalam urutan Tab. ArrowLeft/Right, Home, dan End memindahkan fokus dan pilihan. Tombol Peserta memfokuskan tab peserta; strip video saat presentasi dapat digulir dengan keyboard. Transkrip memakai log berlabel dan pengumuman polite. Indikator mic memiliki peran dan label; status koneksi tidak bergantung hanya pada warna. Fokus keyboard tetap terlihat, termasuk forced colors.
- Teks panel, pengaturan perangkat, lobby, serta tombol selesai diperjelas kontrasnya. Kontrol input dan tombol menampilkan status aktual, pending, disabled, serta busy. Reduced motion tetap dihormati oleh animasi aplikasi; tes menunggu perubahan preferensi diterapkan browser sebelum menilai animasi.
- `useMicrophoneControl` mencegah capture ganda pada klik berulang, menampilkan proses/kegagalan, dan menghentikan track jika izin selesai setelah pengguna keluar atau koneksi berubah. Kamera memakai generation guard sehingga permintaan izin dari sebelum reconnect tidak menjadi valid lagi setelah koneksi pulih. Pilihan awal P1-05 tetap dipakai; reconnect tidak memaksa kamera yang dimatikan pengguna menjadi aktif.
- `useTrackUnavailable` menangani `mute`, `unmute`, `ended`, dan penggantian native track. Kamera menampilkan avatar/fallback ketika track tidak tersedia; layar presenter menampilkan pesan menunggu, lalu pulih ketika track kembali. Presenter dan spotlight tetap mengikuti identitas peserta, dengan screen share mengambil prioritas area utama.
- Status SDK LiveKit membedakan menghubungkan, terhubung, reconnect, dan terputus. Kontrol media diblokir selama pemulihan koneksi. Komponen SDK `StartAudio` memberi tombol **Aktifkan suara peserta** ketika browser menolak autoplay. Audio remote tetap memakai renderer yang sudah ada, tanpa playback mic lokal atau audio dari video yang muted.
- Klik Keluar/Selesai berulang mengirim satu request penyelesaian. Guard presence mencegah request baru setelah proses keluar dimulai. Pada pengujian awal ditemukan respons 409 akibat update presence setelah leave; pengujian akhir tidak menemukan error HTTP API.

## Lokasi implementasi

| File | Peran |
| --- | --- |
| `client/src/MeetingControls.tsx` | Kontrol rapat, label aksi, pressed/busy/disabled |
| `client/src/MeetingRoom.tsx`, `client/src/App.css` | Layout, tab/fokus/keyboard, status koneksi, pemulihan autoplay |
| `client/src/useMicrophoneControl.ts`, `client/src/useCameraControl.ts` | Capture terkelola, aksi berurutan, cleanup dan invalidasi izin terlambat |
| `client/src/useTrackUnavailable.ts` | Subscription siklus native track dan cleanup listener |
| `client/src/ParticipantVideoTile.tsx`, `client/src/ScreenShareStage.tsx` | Fallback kamera/presentasi dan pemulihan track |
| `client/src/App.tsx` | Integrasi hook, pending perangkat, guard penyelesaian/presence |
| `client/src/Workspace.tsx` | Grup aksi lobby berlabel |
| `client/tests/{cameraControl,microphoneControl,trackUnavailable}.test.mjs` | Regresi izin terlambat, serialisasi, mute/reconnect, lifecycle track |
| `scripts/verify-media-experience.mjs` | Verifikasi browser, SFU, signaling, layout, keyboard, audio, dan axe |

Script verifikasi P1-01 sampai P1-05 disesuaikan dengan label mikrofon baru. Perubahan P1-05 tetap didokumentasikan terpisah pada [laporan prejoin](./P1_05_PREJOIN_IMPLEMENTATION.md).

## Verifikasi otomatis

Lingkungan: Microsoft Edge headless melalui Playwright, frontend `127.0.0.1:5187`, API lokal, dan SFU LiveKit `127.0.0.1:7880`. Versi browser aktual dan waktu run tersimpan pada [MEDIA_EXPERIENCE_VERIFICATION.json](./MEDIA_EXPERIENCE_VERIFICATION.json).

| Pemeriksaan | Hasil |
| --- | --- |
| Build TypeScript/Vite | Lulus; peringatan ukuran bundle sekitar 899 kB minified tetap ada |
| Lint oxlint | Lulus tanpa temuan |
| Tes frontend | 86 lulus, 0 gagal; harness lama memakai react-test-renderer yang memberi peringatan deprecation |
| Integrasi P1-06 | 10 skenario lulus, enam sesi peserta, tiga kamera/mic aktif dan tiga audio/video awal mati |
| Regresi device settings | 9 pemeriksaan lulus, termasuk switch kamera/mic saat share, hotplug, input recorder server, dan output sink simulasi |
| Regresi prejoin | 9 pemeriksaan lulus, termasuk handoff perangkat, cleanup, navigasi, izin ditolak/terlambat, dan masuk tanpa capture |
| Axe-core 4.10.3 | 0 pelanggaran otomatis pada lobby, transkrip rapat, dialog perangkat, dan screen share mobile |
| Error browser/API P1-06 | 0 error tak terduga; dua error transport saat pemutusan signaling yang sengaja dibuat tercatat terpisah |

Ukuran grid enam peserta: 1440×1000, 1280×600, 1024×768, 768×1024, 390×844, 320×640, dan 844×390. Screen share diperiksa pada lima ukuran plus mobile reduced motion. Pemeriksaan mencakup lebar halaman, keterlihatan tombol Keluar, posisi/ukuran kontrol, fokus tab/dialog, contain tanpa mirror pada presentasi, dan satu renderer per mic remote.

Reconnect diuji dengan menutup WebSocket signaling LiveKit yang sebenarnya, membiarkan SDK mencoba kembali, lalu membuka akses signaling kembali. Media tetap melalui WebRTC/SFU lokal. Kamera, mikrofon, izin, autoplay rejection, dan event native mute/unmute memakai fixture sintetis; ini tidak membuktikan kualitas audio fisik atau perpindahan jaringan perusahaan. SpeechRecognition distub; tes ini tidak memverifikasi akurasi transkripsi atau memastikan semua peserta ditranskripsikan.

Axe menyimpan hasil `incomplete` untuk kontras di atas gradient/video serta penilaian caption video. Hasil nol pelanggaran otomatis belum merupakan sertifikasi WCAG. Penilaian visual, screen reader, dan kebutuhan caption rapat perlu diuji manual. Caption/transkripsi terpusat tetap memerlukan pipeline Person 3.

## Bukti

- [JSON media P1-06](./MEDIA_EXPERIENCE_VERIFICATION.json)
- [JSON perangkat](./DEVICE_SETTINGS_VERIFICATION.json)
- [JSON prejoin](./PREJOIN_VERIFICATION.json)
- [Desktop enam peserta](./screenshots/media-qa-desktop.png)
- [Screen share mobile](./screenshots/media-qa-mobile-share.png)
- [Status reconnect](./screenshots/media-qa-reconnecting.png)

## Menjalankan ulang

Jalankan frontend/API/LiveKit sesuai README. Port frontend yang dipakai verifikasi adalah 5187. Script membutuhkan Playwright dan distribusi axe-core lokal; dependency produksi tidak berubah.

```powershell
npm --prefix client run build
npm --prefix client run lint
npm --prefix client test

# Sesuaikan ke lokasi instalasi Playwright dan axe-core pada komputer developer.
$env:PLAYWRIGHT_MODULE_PATH = 'C:/Users/heraldmichain.intern/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:AXE_CORE_PATH = 'C:/Users/heraldmichain.intern/Documents/RecordMeeting/.verification-tools/axe-4.10.3.min.js'
$env:MEDIA_TEST_URL = 'http://127.0.0.1:5187'
node scripts/verify-media-experience.mjs
node scripts/verify-device-settings.mjs
node scripts/verify-prejoin.mjs
```

Axe-core distribusi 4.10.3 dapat diperoleh dari [paket resmi axe-core](https://www.npmjs.com/package/axe-core/v/4.10.3) jika file lokal belum tersedia. `MEDIA_TEST_BROWSER`, `DEVICE_TEST_BROWSER`, dan `PREJOIN_TEST_BROWSER` dapat menentukan channel Chromium yang terpasang. Script menutup sesi pengujiannya sendiri dan membiarkan layanan lokal tetap berjalan.

## Acceptance manual

1. Uji Chrome/Edge dan browser target perusahaan, termasuk perangkat mobile fisik. Gunakan dua atau lebih komputer dengan webcam/headset nyata; periksa kamera off/on, mute, output speaker/headset, kualitas suara, dan tidak ada echo dari playback lokal.
2. Mulai/batalkan screen share melalui dialog OS, ganti presenter, hentikan dari toolbar browser, dan keluar saat share aktif. Periksa video, nama peserta, dan prioritas presentasi.
3. Cabut/sambungkan webcam/headset, tolak lalu beri ulang izin, dan pindah perangkat ketika transkripsi server aktif. Pastikan satu recorder mengikuti track baru; validasi transkripsi terpisah bersama Person 3.
4. Putus/sambung jaringan fisik, pindah Wi-Fi/VPN kantor, dan uji signaling maupun full reconnect. Pastikan tombol/status pulih, preferensi kamera/mic tetap benar, dan peserta/attendance disinkronkan bersama Person 2.
5. Jalankan NVDA atau screen reader target: baca label/status media, navigasikan tab dan dialog, uji fokus saat scroll/zoom, serta nilai kontras pada video/gradient. Uji reduced motion dan high contrast pada OS nyata.
6. Uji browser yang membatasi autoplay tanpa flag pengujian. Klik Aktifkan suara peserta dan pastikan suara terdengar satu kali melalui perangkat output yang dipilih. Sepakati kebutuhan caption rapat dengan Person 3.

## Referensi

- [WAI-ARIA APG: tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) untuk peran, fokus, pilihan, dan tombol navigasi.
- [WCAG 2.2: target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html); implementasi kontrol utama memakai tinggi minimal 44 px.
- [LiveKit: connection lifecycle](https://docs.livekit.io/intro/basics/connect/) dan [ConnectionState](https://docs.livekit.io/reference/client-sdk-js/enums/ConnectionState.html) untuk status/reconnect SDK.
- [LiveKit React: useConnectionState](https://docs.livekit.io/reference/components/react/hook/useconnectionstate/) untuk integrasi status room.
