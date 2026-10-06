# P1-05 — Preview dan pemeriksaan perangkat sebelum bergabung

Tanggal: 6 Oktober 2026. Branch: `testingsam`. Implementasi setelah commit `cabb56d`, disertakan dalam commit gabungan P1-05/P1-06.

## Hasil

- Lobby menyediakan preview kamera lokal dengan mirror, avatar saat preview berhenti, serta kontrol “Preview kamera” / “Hentikan preview”. Video selalu muted, tanpa playback suara mikrofon sendiri.
- Tes mikrofon yang sudah ada dipindahkan ke `MicrophoneDiagnostic.tsx` dan memakai stream dari pengelolaan preview bersama. Meter dan animasi mengikuti input suara; konteks audio dan frame animasi dibersihkan ketika tes berhenti atau lobby ditinggalkan.
- Daftar mikrofon/kamera berasal dari `enumerateDevices()`, diperbarui saat `devicechange` atau lewat tombol. Label yang disembunyikan diberi nama generik. Pilihan yang hilang tetap terlihat sebagai tidak tersedia; pengguna memilih penggantinya.
- Membuka lobby atau mengganti pilihan tanpa preview tidak meminta capture. Klik preview, tes suara, atau mengaktifkan input memulai permintaan izin. Kamera dan mic saat masuk tetap aktif secara default, sesuai perilaku sebelumnya, dengan status yang jelas dan pilihan untuk mematikannya.
- Mematikan kontrol input menghentikan preview dan membuat input itu nonaktif saat bergabung. Menghentikan tes/preview saja membebaskan perangkat tanpa mengubah pilihan status saat masuk. Memulai tes/preview yang berhasil mengaktifkan pilihan input tersebut.
- Saat join, aplikasi mengambil snapshot pilihan, menghentikan semua preview, lalu meminta token. Room LiveKit menggunakan `audioCaptureDefaults` / `videoCaptureDefaults` dengan pilihan device ID; publikasi mic dan kamera mengikuti status awal masing-masing.
- Masuk dengan mic dan kamera nonaktif tidak meminta capture. Peserta tetap dapat menerima media remote, lalu mengaktifkan perangkat pilihan dari kontrol rapat.
- Penolakan izin, input tidak ditemukan, dan track berhenti mematikan pilihan input yang gagal serta menampilkan pesan. Input lainnya tetap dapat digunakan. Perangkat fisik yang dicabut tidak diganti secara diam-diam oleh UI.
- Nomor generasi per input membatalkan hasil capture lama. Izin yang selesai setelah cancel, pergantian perangkat, join, atau keluar lobby langsung dihentikan tanpa mengganti state preview terbaru.
- Navigasi membatalkan generasi join; respons token sukses/gagal yang terlambat tidak membawa pengguna kembali ke rapat atau menambahkan error ke lobby baru. Preview tidak berjalan kembali setelah kegagalan join sampai pengguna memulainya.
- Pilihan disimpan di state sesi aplikasi saja. Device ID tidak ditambahkan ke request token, database, atau telemetry.

## Perbaikan terkait alur lobby

Pengujian menemukan departemen masih opsional pada form sementara API mewajibkannya. Form dan validasi awal sekarang meminta departemen sebelum mengirim token. Lobby baru membersihkan error preview lama sambil mempertahankan pilihan perangkat/status awal. Favicon diarahkan ke `favicon.svg` yang sudah tersedia untuk menghilangkan permintaan `/favicon.ico` yang gagal.

## Berkas

| Berkas | Peran |
| --- | --- |
| `client/src/usePreJoinMedia.ts` | Enumerasi, pilihan perangkat/status awal, ownership capture, cancel, hotplug, track ended, dan snapshot join |
| `client/src/PreJoinPreview.tsx` | Preview video lokal, kontrol status awal, daftar perangkat, dan pesan perangkat |
| `client/src/MicrophoneDiagnostic.tsx` | Meter/animasi mikrofon terisolasi, tanpa mengubah state seluruh aplikasi pada setiap frame |
| `client/src/App.tsx` | Cleanup sebelum token, guard navigasi join, pilihan capture default LiveKit, dan status kamera awal |
| `client/src/Workspace.tsx`, `client/src/App.css` | Integrasi lobby dan layout desktop/mobile |
| `client/index.html` | Referensi favicon yang tersedia |
| `client/tests/preJoinMedia.test.mjs` | 13 tes lifecycle, pilihan, izin terlambat, failure/retry, hotplug, dan StrictMode |
| `scripts/verify-prejoin.mjs` | Skenario browser dengan tiga peserta terhubung dan satu sesi pengujian cancel |

## Verifikasi

- Build TypeScript/Vite lulus. Peringatan ukuran bundle lebih dari 500 kB masih ada.
- Lint lulus tanpa warning.
- 76 tes frontend lulus (13 tambahan untuk P1-05).
- 9 pemeriksaan integrasi lulus melalui LiveKit lokal: preview perangkat kedua, meter, cleanup sebelum respons token, handoff perangkat, join tanpa capture, audio-only setelah izin kamera ditolak, izin terlambat, hotplug, retry mic, respons join terlambat, layout mobile, dan cleanup keluar.
- Pemeriksaan awal dev server memverifikasi home/lobby, navigasi, elemen penting, serta tidak adanya overlay Vite atau console error setelah favicon diperbaiki.
- Review React: options room tetap stabil selama call; meter terisolasi dari App; preview tidak memutar audio; request lama tidak menimpa pilihan baru; listener/track/context dibersihkan; kontrol menggunakan label, status pressed, meter, dan focus visible.

Media pengujian menggunakan video canvas dan audio oscillator dengan WebRTC/SFU LiveKit sebenarnya. Enumerasi, izin, hotplug, dan SpeechRecognition memakai fixture. Tidak ada pengujian webcam fisik, headset fisik, dialog izin OS sebenarnya, kualitas suara manusia, atau kualitas transkripsi. Satu respons HTTP 500 sengaja digunakan untuk membuktikan kegagalan join yang dibatalkan tidak mencemari UI; respons tersebut dipisahkan dari error tak terduga.

Artefak:

- [Hasil terstruktur](./PREJOIN_VERIFICATION.json)
- [Lobby sebelum preview](./screenshots/prejoin-initial.png)
- [Preview desktop](./screenshots/prejoin-desktop.png)
- [Preview mobile](./screenshots/prejoin-mobile.png)

Jalankan ulang dari root repo setelah frontend, API, dan LiveKit lokal aktif:

```powershell
npm.cmd --prefix client run build
npm.cmd --prefix client run lint
npm.cmd --prefix client test
$env:PLAYWRIGHT_MODULE_PATH = 'C:/Users/heraldmichain.intern/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:PREJOIN_TEST_URL = 'http://127.0.0.1:5187'
$env:PREJOIN_TEST_BROWSER = 'msedge'
node scripts/verify-prejoin.mjs
```

Sesuaikan path Playwright jika environment berbeda. Script membuat room dan sesi browser miliknya sendiri, meninggalkan call, dan menutup browser setelah selesai. Layanan lokal tidak dihentikan oleh script.

## Acceptance di kantor dan task berikutnya

Uji webcam/headset fisik: pilih perangkat kedua, lihat preview, uji input, matikan kamera atau mic, lalu masuk dari alur buat/gabung. Pastikan pilihan aktual di dialog perangkat sesuai; berhenti/keluar harus melepaskan indikator capture browser. Uji cabut/pasang input, izin ditolak/dibatalkan, izin selesai terlambat, dan mobile nyata. Konfigurasi mic LiveKit tetap tidak mengikat input SpeechRecognition browser; penanganan transkripsi terpusat tetap bagian Person 3.

P1-06 masih tersisa untuk verifikasi layout, aksesibilitas, reconnect, dan media lintas fitur. P1-05 tidak mengubah autentikasi karyawan atau pipeline backend tim lain.

Referensi: [LiveKitRoom audio dan RoomOptions](https://docs.livekit.io/reference/components/react/component/livekitroom/), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
