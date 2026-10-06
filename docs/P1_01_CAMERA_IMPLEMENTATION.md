# P1-01 — Implementasi video kamera peserta

Tanggal: 5 Oktober 2026. Implementasi P1-01 untuk branch `testingsam`.

## Perilaku yang tersedia

- `InCallView` meminta audio dan kamera ketika pengguna masuk, dengan pemberitahuan di lobby.
- Video lokal dan remote dirender memakai `ParticipantTile` dan `VideoTrack` LiveKit. Hanya preview lokal dicerminkan.
- Kamera mati, track tidak tersedia, atau playback gagal menampilkan avatar dan status. Nama serta indikator mic tetap terlihat.
- Tombol kamera mengikuti status LiveKit, memiliki label aksesibel, menampilkan proses permintaan, dan menolak klik berulang saat masih diproses.
- Izin kamera ditolak atau perangkat tidak tersedia menampilkan pesan kamera dan pilihan mencoba lagi, tanpa mengubah mic.
- Track yang baru berhasil dibuat setelah pengguna keluar dihentikan dan dilepas.
- Subscription event native track dibersihkan ketika tile dilepas. `RoomAudioRenderer` tetap satu agar audio tidak digandakan.
- Error kamera/mic dipisahkan dari error koneksi. Callback koneksi stabil agar perubahan UI tidak berulang kali memanggil koneksi room.

## File utama

| File | Perubahan |
| --- | --- |
| `client/src/App.tsx` | Kamera aktif saat join, referensi track, status lokal, dan penanganan error media |
| `client/src/ParticipantVideoTile.tsx` | Video/placeholder, mirroring lokal, nama, mic, dan penanda pembicara |
| `client/src/useCameraControl.ts` | Toggle serial, pesan error, dan pembersihan request yang selesai terlambat |
| `client/src/MeetingRoom.tsx` | Grid video, tombol kamera, dan pesan/retry |
| `client/src/App.css` | Video di tile, overlay agar nama terbaca, fokus tombol, dan kontrol yang dapat membungkus pada layar sempit |
| `client/src/Workspace.tsx` | Pemberitahuan permintaan kamera di lobby |
| `client/tests/cameraControl.test.mjs` | Tujuh tes lifecycle dan error kamera |
| `scripts/verify-camera.mjs` | Verifikasi UI dan WebRTC lintas sesi browser |

## Hasil verifikasi

Build produksi berhasil. Lint tanpa warning. Seluruh **32 tes frontend lulus**, termasuk tujuh tes kamera. Build masih melaporkan ukuran chunk lebih dari 500 kB; pemecahan bundle tidak dikerjakan dalam task ini. Tes yang menggunakan `react-test-renderer` mengikuti harness proyek yang ada dan masih mengeluarkan pemberitahuan deprecation.

Tes menemukan race pada publikasi otomatis kamera: izin yang baru selesai setelah pengguna keluar dapat membuat capture tetap hidup. Implementasi akhir tidak menggunakan prop `video={true}` pada `LiveKitRoom`; `useCameraControl` membuat track setelah room terhubung, memegang track sebelum publikasi, dan menghentikannya jika pengguna sudah keluar. Kamera masih diminta otomatis saat bergabung. Toggle track yang sudah dipublikasikan tetap memakai `setCameraEnabled`.

Pengujian browser memakai Microsoft Edge, video canvas yang bergerak, mic simulasi Chromium, dan transport LiveKit lokal yang sebenarnya. Pengenal ucapan browser di-stub untuk memisahkan pengujian media dari layanan STT eksternal.

Kasus yang diverifikasi: video lokal/remote, mirroring lokal saja, toggle kamera di kedua klien, mic tetap independen, recognizer tetap hidup ketika kamera berubah, izin ditolak, kamera tidak ditemukan, retry, track kamera terputus, layout tiga peserta pada lebar 390 px tanpa overflow horizontal, pelepasan track saat keluar, dan izin kamera awal yang baru selesai setelah pengguna keluar. Tidak ditemukan exception browser yang tidak ditangani. Rincian mesin tersedia di [CAMERA_VERIFICATION.json](./CAMERA_VERIFICATION.json).

Screenshot menggunakan video simulasi:

- [Kamera aktif, desktop](./screenshots/camera-on-desktop.png)
- [Kamera mati, desktop](./screenshots/camera-off-desktop.png)
- [Tiga peserta, mobile](./screenshots/camera-mobile.png)

## Menjalankan ulang

Gunakan app lokal pada port 5187, API pada 3001, dan LiveKit pada 7880. Bila sudah berjalan, gunakan layanan tersebut tanpa mematikan proses lain. Runner membuat identitas/room pengujian sendiri dan meninggalkan room melalui UI saat selesai.

```powershell
npm --prefix client run build
npm --prefix client run lint
npm --prefix client test

# Playwright harus tersedia di lingkungan pengujian.
# Bila dipasang di luar proyek, isi dengan path absolut modul Playwright.
$env:PLAYWRIGHT_MODULE_PATH = '<path-ke-modul-playwright>'
node scripts/verify-camera.mjs
```

Runner tidak menginstal dependency, membuat server, memanggil ringkasan AI, atau membaca kredensial GitHub. URL/browser dapat disesuaikan melalui `CAMERA_TEST_URL` dan `CAMERA_TEST_BROWSER`.

## Acceptance yang masih memerlukan perangkat nyata

- Webcam fisik dan mic/headset pada dua PC: kamera on/off, video remote, dan suara dua arah.
- Perangkat dicabut atau dipakai aplikasi lain, lalu dipasang kembali dan dicoba ulang.
- Browser target kantor lainnya, terutama jika harus mendukung Safari/Firefox.

Emulator kamera native Chromium pada mesin ini sempat menghasilkan track yang berakhir lalu gagal membuka perangkat `default`. Karena itu verifikasi yang stabil menggunakan video canvas; hasil tersebut tidak membuktikan kompatibilitas driver webcam. Fallback track terputus diuji secara terpisah, dan penerimaan dengan webcam fisik tetap terbuka.

Screen share, pemilih perangkat, spotlight, dan preview kamera sebelum masuk masih mengikuti task P1-02 sampai P1-06.
