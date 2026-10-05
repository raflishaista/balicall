# P1-03 — Pemilih perangkat audio/video

Tanggal: 5 Oktober 2026. Implementasi lokal pada branch `testingsam`, melanjutkan P1-01/P1-02.

## Hasil

- Tombol **Perangkat** di kontrol rapat membuka dialog **Perangkat audio & video**.
- Mikrofon, kamera, dan speaker/headphone ditampilkan dari `navigator.mediaDevices.enumerateDevices()`. Pilihan aktif dibaca dari track/perangkat LiveKit, termasuk preferensi kamera yang belum dipublikasikan.
- Pilihan langsung memakai `room.switchActiveDevice(kind, deviceId)`. Status mute/kamera dipertahankan; memilih perangkat ketika nonaktif menyimpan pilihan tanpa menyalakannya.
- Dialog menampilkan meter mikrofon yang sama dengan rapat dan preview kamera yang sudah aktif. Tidak ada capture tambahan untuk preview/daftar perangkat dan tidak ada audio renderer tambahan.
- Event `devicechange` menyegarkan daftar. Jika pilihan hilang dari daftar, UI menyebut perangkat tidak tersedia dan meminta pengguna memilih alternatif atau menyambungkan kembali. Tidak ada janji perpindahan fisik otomatis; SDK dapat melakukan pemulihan sendiri pada kondisi tertentu.
- Label yang disembunyikan memakai nama generik. Tanpa perangkat/izin tersedia, UI menjelaskan kondisi tersebut.
- Speaker memakai output LiveKit untuk audio peserta saat ini dan yang baru masuk. Jika browser menyediakan `selectAudioOutput`, tombol izin/pemilih browser tersedia. Tanpa `setSinkId`, kontrol speaker dinonaktifkan dan UI mengarahkan ke pengaturan suara sistem.
- Saat switch gagal, track lama mungkin sudah dihentikan oleh browser/SDK. Aplikasi mencoba memulihkan perangkat sebelumnya. Bila input tidak dapat dipulihkan, input dimatikan dan pesan meminta pengguna memilih perangkat serta mengaktifkannya kembali. Pilihan yang gagal tidak diklaim berhasil.
- Dialog native mengelola modal/inert, fokus awal, putaran Tab/Shift+Tab, Escape, backdrop, dan pengembalian fokus. Ukuran dibatasi viewport; konten mobile dapat digulir dan footer tetap terlihat.
- Pilihan berlaku untuk sesi rapat, tanpa menyimpan device ID di server atau menambah telemetry perangkat.

## Transkripsi mikrofon

`useBackendTranscription` menambahkan flush sebelum switch dan pause/resume recorder selama pergantian track. Segmen terakhir dari track lama diselesaikan sebelum SDK restart. Track baru mendapat satu recorder; perubahan volume/timer tetap tidak menggandakan recorder. Permintaan flush yang bersamaan berbagi Promise supaya keluar rapat saat pergantian tidak memanggil `finish()` ganda.

`useDeviceSettings` juga mengikuti `TrackEvent.Restarted` dan native `ended` dengan cleanup listener, sehingga meter/transkripsi dapat membaca MediaStreamTrack baru walaupun objek LocalTrack LiveKit tetap sama.

**Batasan transkripsi browser:** `SpeechRecognition` saat ini memiliki input sendiri, tanpa menerima track LiveKit terpilih. Dropdown mikrofon rapat tidak menjamin input pengenal suara browser ikut berubah. Dialog menjelaskan ini; integrasi STT terpusat tetap bagian Person 3. Mode server mengikuti track mikrofon rapat, tetapi provider STT kantor tidak dipanggil dalam tes ini.

## File utama

| File | Perubahan |
| --- | --- |
| `client/src/useDeviceSettings.ts` | Enumerasi, event perangkat/track, switch SDK, error/rollback, izin output, dan serialisasi request |
| `client/src/DeviceSettingsDialog.tsx` | Dialog selector, preview, meter, pesan kemampuan, dan fokus keyboard |
| `client/src/App.tsx`, `MeetingRoom.tsx`, `App.css` | Integrasi room, tombol, state proses, dan layout |
| `client/src/useBackendTranscription.ts` | Flush/pause/resume saat switch dan berbagi flush untuk permintaan bersamaan |
| `client/tests/deviceSettings.test.mjs`, `backendHook.test.mjs` | Tes controller perangkat dan kontinuitas recorder |
| `scripts/verify-device-settings.mjs` | Tes UI multi-peserta dan screenshot |

## Verifikasi

- Build TypeScript/Vite dan lint lulus. Warning bundle >500 kB tetap ada seperti sebelum task ini.
- **52 tes frontend lulus**: 10 tes controller perangkat ditambahkan dan satu tes recorder saat ganti mikrofon. Tes flush yang sudah ada juga memeriksa dua pemanggilan flush bersamaan.
- **9 pemeriksaan browser integrasi lulus**, Microsoft Edge headless, sampai tiga peserta, melalui room/SFU/WebRTC LiveKit lokal yang sebenarnya.
- Fixture: enumerasi perangkat sintetis, kamera canvas, mikrofon oscillator, output sink/izin/hotplug simulasi. MediaRecorder browser benar-benar merekam; respons endpoint audio di-stub agar tidak menghubungi STT kantor. Tidak ada perangkat/suara output fisik yang dibuktikan oleh tes ini.
- Integrasi mencakup fokus modal, switch kamera/mic saat share, video remote, meter mic, flush recorder dan track baru, output ke peserta lama/baru, izin ditolak dan rollback, unplug/replug serta label tersembunyi, menjaga mute/off, output unsupported, mobile 390px, dan keluar saat capture switch belum selesai. Tidak ada uncaught browser error.
- [Laporan JSON](./DEVICE_SETTINGS_VERIFICATION.json), [screenshot desktop](./screenshots/device-settings-desktop.png), [screenshot mobile](./screenshots/device-settings-mobile.png).

Dengan aplikasi/API/LiveKit lokal berjalan:

```powershell
npm --prefix client run build
npm --prefix client run lint
npm --prefix client test
# Isi hanya jika Playwright dipasang di luar proyek.
$env:PLAYWRIGHT_MODULE_PATH = 'C:/path/to/node_modules/playwright'
node scripts/verify-device-settings.mjs
```

`DEVICE_TEST_URL` default `http://127.0.0.1:5187`, `DEVICE_TEST_BROWSER` default `msedge` pada Windows. Script memakai browser miliknya sendiri, keluar melalui UI dan menutup browser setelah selesai.

## Acceptance perangkat kantor

1. Hubungkan dua mic/webcam dan headset. Ganti selama rapat dua perangkat; dengarkan hasil dari peserta lain dan periksa meter/preview.
2. Pilih speaker/headphone dan pastikan suara benar-benar berpindah, termasuk audio peserta yang baru bergabung. Uji prompt izin output browser dan pembatalannya.
3. Cabut perangkat terpilih dan sambungkan lagi; periksa daftar/status, pilih alternatif, lalu aktifkan kembali bila perlu.
4. Uji izin ditolak, perangkat sedang dipakai aplikasi lain, dan kegagalan pemulihan. Pastikan UI tidak mengklaim capture berhasil.
5. Dengan STT server yang dikonfigurasi Person 3, bicara sebelum/sesudah switch dan cek segmen/transkrip. Pengenal suara browser masih memiliki batasan input tersendiri di atas.

## Referensi

- [LiveKit LocalParticipant/Room SDK](https://docs.livekit.io/reference/client-sdk-js/classes/Room.html): `getActiveDevice` dan `switchActiveDevice`.
- [LiveKit useMediaDeviceSelect](https://docs.livekit.io/reference/components/react/hook/usemediadeviceselect/): pola pilihan perangkat dan kehati-hatian saat meminta izin.
- [MDN enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices), [selectAudioOutput](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/selectAudioOutput), [setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId).

Berikutnya: P1-04 — spotlight pembicara yang stabil.
