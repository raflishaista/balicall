# P1-02 — Screen share

Tanggal: 5 Oktober 2026. Implementasi lokal untuk branch `testingsam`.

## Perilaku

- Tombol **Bagikan layar** membuka pemilih layar/jendela/tab setelah klik pengguna. Tidak ada permintaan screen capture saat masuk rapat.
- Status tombol berasal dari `useLocalParticipant().isScreenShareEnabled`. Saat aktif, tombol menjadi **Hentikan layar**.
- Layar presenter mendapat area utama, dengan `object-fit: contain` tanpa mirror. Kamera dan avatar tetap tersedia pada strip peserta yang dapat digeser.
- Jika beberapa peserta berbagi, tersedia **Pilih presenter layar**. Ketika presenter yang dipilih berhenti/keluar, layar peserta lain menjadi fallback; ketika tidak ada share, grid kamera dipulihkan.
- Pembatalan/penolakan pemilih layar menampilkan pesan dan tombol dapat dicoba kembali. Browser tanpa `getDisplayMedia` menampilkan keterangan dan menonaktifkan mulai share; layar peserta lain tetap dapat ditonton.
- SDK LiveKit menangani event native `ended` dengan unpublish. Layout dan tombol mengikuti track publikasi, termasuk penghentian dari toolbar browser.
- Screen capture yang baru selesai setelah keluar/disconnect dihentikan sebelum publikasi. Track yang sedang dipublikasikan dihentikan segera ketika disconnect dan dibersihkan setelah publikasi selesai.
- Fitur ini membagikan **video layar saja** (`audio: false`). Mikrofon rapat dan transkrip memakai jalur yang sudah ada. Audio tab/sistem belum termasuk P1-02 ini.

## File utama

| File | Perubahan |
| --- | --- |
| `client/src/useScreenShareControl.ts` | Kendali capture/publikasi, pesan error, mutex klik, cleanup, dan invalidasi capture lama setelah reconnect |
| `client/src/ScreenShareStage.tsx` | Video layar utama, pemilih presenter, dan fallback playback |
| `client/src/App.tsx` | Track `ScreenShare`, state publikasi, dan integrasi hook |
| `client/src/MeetingRoom.tsx` | Tombol share, status/error, area presentasi, dan strip kamera |
| `client/src/App.css` | Layout desktop/mobile, konten layar utuh, dan strip peserta |
| `client/tests/screenShareControl.test.mjs` | Sembilan tes lifecycle screen capture |
| `scripts/verify-screen-share.mjs` | Verifikasi multi-peserta melalui SFU LiveKit lokal dan screenshot |

Inisialisasi menggunakan `createScreenTracks({ audio: false })` kemudian `publishTrack(..., { source: Track.Source.ScreenShare })`. Ini memberi hook kepemilikan track sebelum publish, sehingga dialog izin yang selesai setelah room ditinggalkan tidak meninggalkan capture aktif. Penghentian memakai `setScreenShareEnabled(false)`. Pemanggilan capture langsung dari handler klik menjaga syarat user activation browser. Tidak ada await lain sebelum membuka pemilih.

## Verifikasi

- Build TypeScript/Vite: lulus. Warning ukuran bundle >500 kB sudah ada sebelum task ini dan masih muncul.
- Lint: lulus tanpa warning.
- Tes frontend: **41 lulus**, termasuk sembilan tes screen share: start/stop independen dari kamera/mic, pembatalan dan retry, unsupported browser, klik ganda, keluar saat pemilih terbuka, disconnect saat publish, hasil pemilih lama setelah reconnect, kegagalan publish, dan track ended saat publish.
- Browser Microsoft Edge headless: **9 pemeriksaan integrasi lulus**, sampai tiga peserta. Video kamera dan display memakai canvas simulasi, mikrofon memakai fake Chromium device, dan transport WebRTC/SFU LiveKit benar-benar digunakan. SpeechRecognition di-stub untuk mengisolasi tes dari layanan STT eksternal.
- Integrasi memverifikasi: pengiriman frame remote, konten layar utuh/tanpa mirror, kamera dan mic tetap berjalan, toggle kamera/mic selama share, stop dari tombol, cancel/retry, native ended event simulasi toolbar, beberapa presenter, fallback, browser tanpa kemampuan capture sebagai viewer, layout 390px, keluar presenter, serta izin terlambat setelah keluar.
- Tidak ada uncaught browser error atau overlay Vite. Laporan: [SCREEN_SHARE_VERIFICATION.json](./SCREEN_SHARE_VERIFICATION.json).
- Screenshot: [desktop](./screenshots/screen-share-desktop.png), [beberapa presenter](./screenshots/screen-share-presenters.png), [mobile](./screenshots/screen-share-mobile.png). Isi layar dan kamera adalah fixture pengujian.

Jalankan API, LiveKit, dan aplikasi lokal, kemudian:

```powershell
npm --prefix client run build
npm --prefix client run lint
npm --prefix client test
# Jika Playwright tidak ada pada node_modules proyek, isi path paket yang sudah terpasang.
$env:PLAYWRIGHT_MODULE_PATH = 'C:/path/to/node_modules/playwright'
node scripts/verify-screen-share.mjs
```

`SCREEN_TEST_URL` mengubah alamat aplikasi (default `http://127.0.0.1:5187`), dan `SCREEN_TEST_BROWSER` memilih channel browser (default `msedge` pada Windows). Script tidak menginstal dependency dan tidak menyalakan/mematikan layanan pengguna. Browser pengujian ditutup setelah selesai dan peserta keluar melalui UI.

## Acceptance manual yang tersisa

1. Di dua perangkat/browser kantor, pilih layar penuh, jendela, dan tab melalui dialog browser asli. Pastikan isi layar diterima dan tetap terbaca.
2. Batalkan dialog; coba lagi. Verifikasi izin screen recording OS jika diperlukan.
3. Hentikan lewat toolbar browser asli dan tombol rapat; pastikan kedua klien kembali ke grid, lalu mulai lagi.
4. Keluar atau selesaikan rapat saat share aktif; pastikan indikator screen recording OS berhenti. Coba juga keluar saat dialog pemilihan masih terbuka.
5. Jalankan dua presenter sekaligus, pilih salah satunya, lalu hentikan presenter terpilih untuk memeriksa fallback.

Pemilih layar dan toolbar OS asli belum diuji oleh tes simulasi. Tidak ada klaim bahwa audio sistem/tab atau STT multi-peserta sudah ditangani.

## Referensi resmi

- [LiveKit — Screen sharing](https://docs.livekit.io/transport/media/screenshare/)
- [LiveKit — LocalParticipant: createScreenTracks dan setScreenShareEnabled](https://docs.livekit.io/reference/client-sdk-js/classes/LocalParticipant.html)
- Implementasi dependency terpasang: `livekit-client/src/room/participant/LocalParticipant.ts`, termasuk `handleTrackEnded` untuk source `ScreenShare`.

Berikutnya: P1-03 pemilih perangkat audio/video dan P1-04 spotlight pembicara. Pembatasan presenter melalui server, autentikasi, dan pipeline STT tetap mengikuti pembagian kerja Person 2/3.
