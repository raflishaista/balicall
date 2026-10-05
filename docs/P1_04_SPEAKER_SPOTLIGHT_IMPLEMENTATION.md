# P1-04 — Active speaker spotlight yang stabil

Tanggal: 5 Oktober 2026. Branch: `testingsam`. Fitur disertakan dalam paket perubahan media P1-02, P1-03, dan P1-04.

## Perilaku

- Pembicara yang baru mulai berbicara mendapat posisi utama setelah terdeteksi aktif selama 600 ms. Jarak minimum antarpergantian spotlight adalah 1,2 detik. Waktu ini dihitung sejak event LiveKit, bukan sejak suara pertama secara akustik.
- Pemilihan mengikuti perubahan peserta yang sedang berbicara, sehingga perubahan urutan berdasarkan volume tidak mengganti spotlight. Jika beberapa peserta mulai dalam event yang sama, peserta pertama dari SDK menjadi pemecah seri.
- Saat semua diam, pembicara terakhir tetap disorot. Sebelum ada pembicara, urutan awal peserta dipertahankan. Jika peserta sorotan keluar, gunakan pembicara terakhir yang sudah dikonfirmasi dan masih hadir, lalu peserta pertama yang tersisa.
- Kandidat yang berhenti berbicara sebelum konfirmasi tidak dipromosikan. Disconnect membatalkan timer; reconnect membutuhkan pengamatan baru.
- Screen share tetap mendapat area utama. Riwayat pembicara terus diperbarui saat presentasi dan dipakai kembali setelah share berhenti.
- Kamera mati memakai avatar peserta yang benar. Penanda “Kamu”, mirror video lokal, dan status mikrofon tetap mengikuti identitas peserta.

Tile tetap berada dalam daftar React dengan key identitas yang sama. Posisi visual berubah melalui CSS, sehingga elemen video tidak dibuat ulang saat pergantian spotlight. Pengujian juga memeriksa bahwa pergantian sorotan tidak meminta kamera lagi atau memulai ulang pengenal ucapan. Audio renderer dan pipeline transkripsi tidak diubah oleh fitur ini.

## Berkas implementasi

| Berkas | Peran |
| --- | --- |
| `client/src/speakerSpotlight.ts` | Seleksi pembicara, konfirmasi, jeda pergantian, riwayat, dan fallback; timer dapat diinjeksi untuk pengujian |
| `client/src/useSpeakerSpotlight.ts` | Menghubungkan event pembicara, peserta, mute, dan status koneksi LiveKit ke seleksi spotlight; membersihkan listener/timer |
| `client/src/App.tsx` | Mengambil identitas spotlight dari room dan meneruskannya ke tampilan |
| `client/src/MeetingRoom.tsx` | Area sorotan otomatis, prioritas presentasi, dan daftar tile dengan key tetap |
| `client/src/ParticipantVideoTile.tsx` | Penanda tile spotlight tanpa mengganti render kamera/fallback |
| `client/src/App.css` | Tata letak utama dan tile pendamping untuk desktop/mobile |
| `client/tests/speakerSpotlight.test.mjs` | 11 tes seleksi dengan waktu terkontrol |
| `scripts/verify-speaker-spotlight.mjs` | Verifikasi tiga peserta browser melalui LiveKit lokal |

## Hasil verifikasi

- `npm.cmd --prefix client run build`: lulus TypeScript dan Vite. Peringatan ukuran chunk di atas 500 kB masih ada.
- `npm.cmd --prefix client run lint`: lulus.
- `npm.cmd --prefix client test`: 63 tes lulus, termasuk 11 tes spotlight.
- `node scripts/verify-speaker-spotlight.mjs`: 9 pemeriksaan integrasi lulus, tanpa uncaught browser error.

Pengujian integrasi menggunakan tiga sesi browser dengan audio oscillator dan video canvas, melalui WebRTC/SFU LiveKit sebenarnya. Event pembicara tidak diinjeksi. SpeechRecognition distub; perangkat fisik, percakapan manusia, dan kualitas transkripsi tidak diuji oleh skenario ini.

Skenario mencakup pembicara bergantian dan bertumpang tindih, perubahan volume, mempertahankan fokus saat diam, kamera mati/mute, riwayat saat share aktif, berhenti share, peserta sorotan keluar, penanda lokal, layout mobile 390 px, reduced motion, serta cleanup saat keluar. Elemen tile/video, jumlah capture kamera, dan jumlah start pengenal ucapan tetap saat sorotan berubah.

Artefak:

- [Hasil terstruktur](./SPEAKER_SPOTLIGHT_VERIFICATION.json)
- [Screenshot desktop](./screenshots/speaker-spotlight-desktop.png)
- [Screenshot saat screen share](./screenshots/speaker-spotlight-screen-share.png)
- [Screenshot mobile](./screenshots/speaker-spotlight-mobile.png)

## Mengulang pengujian

Jalankan frontend, API, dan LiveKit sesuai konfigurasi lokal repo. Script memakai frontend `http://127.0.0.1:5187` secara default. Di PowerShell dari root repo:

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'C:/Users/heraldmichain.intern/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPOTLIGHT_TEST_URL = 'http://127.0.0.1:5187'
$env:SPOTLIGHT_TEST_BROWSER = 'msedge'
node scripts/verify-speaker-spotlight.mjs
```

Jika Playwright tersedia pada dependency lingkungan lain, sesuaikan `PLAYWRIGHT_MODULE_PATH`. Script membuat room khusus, meninggalkan room setelah pengujian, dan menutup sesi browser miliknya sendiri.

## Acceptance di kantor

Uji tiga pengguna dengan mikrofon nyata: percakapan normal, interupsi singkat, suara bertumpang tindih, dan kebisingan ruangan. Pastikan fokus terasa stabil tanpa terlalu lambat. Uji kamera mati, mute, screen share, peserta keluar, serta reconnect. Sesuaikan `SPEAKER_SETTLE_MS` dan `SPEAKER_HOLD_MS` bila hasil percakapan nyata memerlukan perubahan; waktu deteksi suara SFU terpisah dari waktu konfirmasi UI.

Task berikutnya dalam daftar Person 1: P1-05 preview/pilihan perangkat sebelum bergabung, lalu P1-06 verifikasi layout dan aksesibilitas lintas fitur. Fitur tersebut belum dikerjakan dalam P1-04.

Referensi: [event pembicara dan subscription LiveKit](https://docs.livekit.io/transport/media/subscribe/), [useSpeakingParticipants](https://docs.livekit.io/reference/components/react/hook/usespeakingparticipants/), dan [useSortedParticipants](https://docs.livekit.io/reference/components/react/hook/usesortedparticipants/). Seleksi khusus diperlukan untuk mempertahankan pembicara terbaru tanpa mengikuti fluktuasi urutan volume.
