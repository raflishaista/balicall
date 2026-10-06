# Task Person 1 — Frontend & Media Experience

**Tujuan:** mengembangkan pengalaman kamera, berbagi layar, kontrol perangkat, tata letak pembicara, dan Pengaturan workspace Bali Tower Sentra.

**Update pengembangan 6 Oktober 2026:** fitur P1-01–P1-06 sudah masuk `main` pada `1917948`. Branch `testingsam` mengikuti update Jadwal pada `ffbd333` melalui fast-forward. Pengaturan P1-07–P1-10 selesai dan terintegrasi dengan Jadwal; lima blok konflik diselesaikan dengan mempertahankan kedua fitur. Preferensi disimpan di browser, tidak mengubah profil atau kebijakan perusahaan. Lihat [laporan Pengaturan](./P1_07_10_SETTINGS_IMPLEMENTATION.md) dan [verifikasi browser](./SETTINGS_VERIFICATION.json).

**Referensi implementasi:** [PERSON_1_MEDIA_REFERENCES.md](./PERSON_1_MEDIA_REFERENCES.md) memetakan dokumentasi dan contoh resmi ke setiap task.

**Audit awal:** pada commit `a2b841e`, rapat masih audio-only (`video={false}`), dengan avatar, mic, indikator berbicara, transkrip, dan peserta. Kamera, screen share, dan pemilih perangkat belum tersedia.

**Riwayat verifikasi P1-01–P1-06:** P1-01 di-push ke `testingsam` pada commit `fc7f0e3`; P1-02 sampai P1-04 pada commit `cabb56d`; P1-05 dan P1-06 pada `7fe6800`. Build, lint, 86 tes frontend, 10 pemeriksaan P1-06 dengan enam sesi LiveKit, serta regresi perangkat dan prejoin masing-masing 9 pemeriksaan lulus pada tahap tersebut. Axe tidak menemukan pelanggaran otomatis pada empat tampilan yang diuji; temuan yang membutuhkan penilaian manual tetap dicatat. Perangkat fisik, percakapan manusia, output suara nyata, screen reader, dan dialog berbagi layar sistem belum diuji. Lihat [laporan P1-01](./P1_01_CAMERA_IMPLEMENTATION.md), [laporan P1-02](./P1_02_SCREEN_SHARE_IMPLEMENTATION.md), [laporan P1-03](./P1_03_DEVICE_SETTINGS_IMPLEMENTATION.md), [laporan P1-04](./P1_04_SPEAKER_SPOTLIGHT_IMPLEMENTATION.md), [laporan P1-05](./P1_05_PREJOIN_IMPLEMENTATION.md), dan [laporan P1-06](./P1_06_MEDIA_EXPERIENCE_IMPLEMENTATION.md).

| Tanggung jawab Person 1 | Status kode saat ini | Sisa pekerjaan |
| --- | --- | --- |
| Video kamera | Implementasi dan verifikasi otomatis lokal selesai: inisialisasi kamera terkelola, tile video lokal/remote, toggle, dan fallback | Uji webcam fisik dengan dua peserta/perangkat |
| Screen share | Kontrol mulai/berhenti, area presentasi, strip kamera, pilihan presenter, dan verifikasi simulasi tersedia | Acceptance dengan dialog browser/izin sistem nyata di perangkat kantor |
| Device switcher | Dialog mikrofon/kamera/speaker, enumerasi, pergantian SDK, hotplug, fallback, dan verifikasi simulasi tersedia | Acceptance headset/webcam fisik, izin output browser, dan kualitas suara nyata |
| Active speaker spotlight | Pembicara terbaru, konfirmasi 600 ms, jeda pergantian 1,2 detik, fallback peserta, prioritas screen share, dan verifikasi tiga peserta tersedia | Acceptance percakapan nyata, interupsi singkat, dan kebisingan kantor |
| Pemeriksaan sebelum bergabung | Preview kamera lokal, tes mic, pilihan input, status awal, handoff ke room, cleanup, dan verifikasi simulasi tersedia | Acceptance webcam/headset kantor, izin browser nyata, dan kualitas input suara |
| Layout, aksesibilitas, dan media | Kontrol mobile tetap tersedia, keyboard/fokus, fallback track, reconnect, pemulihan autoplay, dan verifikasi enam peserta tersedia | Acceptance screen reader, perangkat fisik, lintas browser, dan pergantian jaringan kantor |

Kode server saat ini memberikan `canPublish` dan `canSubscribe` pada token rapat (`server/app.js:46`), tanpa pembatasan sumber kamera/screen share yang terlihat pada grant tersebut. Tidak ditemukan penghalang grant untuk mulai mengerjakan fitur media; hasil publikasi tetap perlu diuji pada server LiveKit yang digunakan.

## Urutan kerja

### P1-01 — Video kamera peserta

**Hasil:** implementasi tersedia; verifikasi dengan media simulasi lulus. Pengujian webcam fisik masih perlu dilakukan sebelum acceptance pada perangkat kantor.

**Prioritas:** P0 · **Lokasi utama:** `client/src/App.tsx`, `client/src/MeetingRoom.tsx`, `client/src/App.css`

Aktifkan publikasi kamera LiveKit dan tambahkan tombol kamera di sebelah kontrol mikrofon. Saat kamera aktif, tile peserta menampilkan video lokal atau remote; saat kamera mati, izin ditolak, kamera tidak tersedia, atau track terputus, tile menampilkan avatar/fallback yang jelas.

Gunakan track kamera melalui komponen LiveKit `VideoTrack`/`ParticipantTile` sesuai kebutuhan layout. Mengubah `video={false}` menjadi `true` saja belum menyelesaikan fitur: pilihan awal kamera harus konsisten dengan lobby, render track remote, dan toggle `localParticipant.setCameraEnabled(...)`.

Implementasi menginisialisasi kamera lewat `useCameraControl` setelah room terhubung, bukan prop publikasi otomatis `LiveKitRoom`. Alasannya: tes browser menemukan track kamera dapat tetap hidup jika izin awal baru selesai setelah pengguna keluar. Hook memiliki track sebelum publikasi sehingga bisa menghentikannya ketika room ditinggalkan. Sejak P1-05, kamera diminta saat bergabung hanya jika pilihan awal kamera di lobby aktif; perangkat kamera mengikuti pilihan lobby.

**Kriteria selesai**

- Kamera mulai hanya setelah persetujuan/aksi pengguna; status tombol mencerminkan status kamera LiveKit yang sebenarnya.
- Pengguna dapat menyalakan dan mematikan kamera selama rapat tanpa mengganggu mikrofon atau transkrip.
- Video peserta tampil pada tile yang benar, dengan nama dan indikator mikrofon tetap terbaca.
- Preview kamera lokal dapat dicerminkan; video remote dan screen share ditampilkan dengan orientasi aslinya.
- Penolakan izin, kamera tidak ditemukan, dan kegagalan publikasi menampilkan fallback/pesan yang bisa dipahami.
- Track kamera dihentikan saat kamera dimatikan atau peserta keluar.
- Layout tetap usable pada 1, 2, dan beberapa peserta, termasuk layar sempit.

### P1-02 — Berbagi layar

**Hasil:** implementasi tersedia dan verifikasi otomatis dengan media simulasi lulus. Dialog pemilihan layar, izin OS, dan penghentian lewat toolbar browser asli masih perlu acceptance manual. Lihat [laporan P1-02](./P1_02_SCREEN_SHARE_IMPLEMENTATION.md).

**Prioritas:** P0 · **Lokasi utama:** `client/src/App.tsx`, `client/src/MeetingRoom.tsx`, `client/src/App.css`

Tambahkan kontrol “Bagikan layar” dan tampilkan track screen share dengan area utama yang lebih besar. Gunakan state/track LiveKit sebagai sumber status, termasuk ketika pengguna menghentikan share melalui toolbar browser.

**Kriteria selesai**

- Pengguna dapat mulai dan menghentikan screen share dari kontrol rapat.
- Share yang aktif tampil jelas; tile kamera/peserta masih dapat diakses.
- Screen share mengambil prioritas area utama di atas spotlight pembicara; konten layar tidak dipotong untuk memenuhi tile.
- Jika beberapa peserta share bersamaan, tersedia pilihan presenter yang jelas. Jika pembatasan satu presenter dibutuhkan, sepakati penegakannya dengan Person 2.
- Berhenti dari tombol rapat maupun toolbar browser mengembalikan layout ke grid tanpa state macet.
- Pembatalan dialog izin dan browser yang tidak mendukung share ditangani dengan aman.
- Screen share berhenti ketika pemilik share keluar atau rapat diselesaikan.

### P1-03 — Pemilih perangkat audio/video

**Hasil:** implementasi lokal tersedia. Build/lint, 52 tes frontend, dan 9 pemeriksaan integrasi simulasi lulus. Perangkat fisik dan output suara nyata masih membutuhkan acceptance. Lihat [laporan P1-03](./P1_03_DEVICE_SETTINGS_IMPLEMENTATION.md).

**Prioritas:** P1 · **Lokasi utama:** `client/src/MeetingRoom.tsx` dan komponen dialog baru bila diperlukan

Buat dialog pengaturan perangkat untuk memilih mikrofon, kamera, dan output audio selama rapat. Enumerasi perangkat dari browser dan hubungkan pilihan ke publikasi/track LiveKit aktif.

API versi LiveKit yang terpasang menyediakan `room.switchActiveDevice(kind, deviceId)` dan `room.getActiveDevice(kind)` untuk `audioinput`, `videoinput`, serta `audiooutput` pada browser yang mendukungnya. Memperbarui dropdown saja tidak mengganti perangkat yang dipakai room.

**Kriteria selesai**

- Daftar perangkat menampilkan pilihan yang tersedia dan pilihan perangkat aktif.
- Perubahan mikrofon/kamera berlaku tanpa keluar dari rapat; output audio berpindah bila browser mendukungnya.
- Perubahan perangkat fisik (dicabut/disambungkan) memperbarui pilihan dan memiliki fallback yang aman.
- Kondisi izin belum diberikan, label perangkat disembunyikan browser, dan tidak adanya perangkat ditangani.
- Jika pemilihan output audio tidak didukung browser, UI menjelaskan batasan tanpa membuat kontrol palsu.
- Perpindahan mikrofon diuji bersama indikator volume dan mode transkripsi server. `useBackendTranscription` sudah bergantung pada `MediaStreamTrack`; pastikan perpindahan track tidak menghentikan atau menggandakan rekaman.
- Mode transkripsi browser saat ini membuat `SpeechRecognition` tersendiri tanpa menerima track pilihan LiveKit (`useSpeechTranscription.ts`). Jangan menganggap dropdown mikrofon otomatis mengganti input pengenal ucapan. Catat batasan tersebut dan koordinasikan penanganan transkripsi dengan Person 3.
- Pemilihan perangkat tidak mencatat atau mengirim device ID ke server.
- Dialog dapat dibuka/ditutup dengan keyboard, mengelola fokus, dan menampilkan kegagalan pergantian perangkat tanpa mengklaim perangkat baru sudah aktif.

### P1-04 — Active speaker spotlight yang stabil

**Hasil:** implementasi lokal tersedia. Build/lint, 63 tes frontend, dan 9 pemeriksaan integrasi dengan audio/video simulasi melalui SFU LiveKit lulus. Percakapan manusia dan mikrofon fisik masih membutuhkan acceptance. Lihat [laporan P1-04](./P1_04_SPEAKER_SPOTLIGHT_IMPLEMENTATION.md).

**Prioritas:** P1 · **Lokasi utama:** `client/src/MeetingRoom.tsx`, `client/src/App.css`

Gunakan status suara peserta dari LiveKit untuk mempromosikan pembicara terbaru ke tile spotlight. `ParticipantVideoTile` sudah memberi kelas `is-speaking` dan label “Berbicara” melalui hook LiveKit; pertahankan penanda tersebut sambil menambahkan tata letak spotlight.

**Kriteria selesai**

- Pembicara aktif terbaru mendapat posisi utama dan peserta lain tetap terlihat.
- Perubahan pembicara tidak membuat seluruh grid berkedip atau berpindah-pindah karena fluktuasi audio singkat.
- Saat semua peserta diam, pertahankan pembicara terbaru sebagai spotlight; sebelum ada pembicara gunakan urutan awal yang stabil. Jika peserta spotlight keluar, pilih peserta yang masih terhubung.
- Saat screen share aktif, pembicara tidak mengambil alih area presentasi. Riwayat pembicara tetap diperbarui untuk digunakan setelah share berhenti.
- Penanda “Kamu”, status mic, dan status kamera tetap benar setelah urutan berubah.
- Verifikasi dengan minimal tiga peserta dan dua peserta yang bergantian berbicara.

### P1-05 — Preview dan pemeriksaan perangkat sebelum bergabung

**Hasil:** implementasi lokal tersedia. Build/lint, 76 tes frontend, dan 9 pemeriksaan integrasi simulasi lulus, termasuk pilihan perangkat nyata pada room LiveKit, cleanup sebelum respons token, izin terlambat, perangkat terputus, dan masuk tanpa capture. Lihat [laporan P1-05](./P1_05_PREJOIN_IMPLEMENTATION.md). Acceptance perangkat fisik masih diperlukan.

**Prioritas:** P2 · **Lokasi utama:** alur create/join meeting di `client/src`

Kembangkan `MicrophoneDiagnostic` yang sudah ada; tidak perlu membuat tes suara dari awal. Tambahkan preview kamera dan pemilihan perangkat, lalu teruskan pilihan perangkat/status awal ke room saat pengguna bergabung.

**Kriteria selesai**

- Pengguna dapat melihat preview kamera dan mencoba mikrofon sebelum bergabung.
- Pengguna dapat memilih kamera/mikrofon dan mengatur status awal kamera serta mic.
- Preview berhenti dan track dibersihkan setelah bergabung atau membatalkan.
- Alur bergabung tetap bisa digunakan audio-only.

### P1-06 — Layout, aksesibilitas, dan verifikasi media

**Hasil:** implementasi lokal dan verifikasi otomatis selesai. Tujuh ukuran layar, enam peserta, reconnect signaling LiveKit nyata, fallback track, izin terlambat, dan pemulihan autoplay lulus. Build/lint dan 86 tes frontend lulus; axe mendeteksi nol pelanggaran otomatis pada lobby, ruang rapat, dialog perangkat, dan screen share mobile. Pengujian media memakai capture sintetis; acceptance hardware dan aksesibilitas manual masih diperlukan. Lihat [laporan P1-06](./P1_06_MEDIA_EXPERIENCE_IMPLEMENTATION.md) dan [hasil terstruktur](./MEDIA_EXPERIENCE_VERIFICATION.json).

**Prioritas:** P1 · **Dependensi:** P1-01 sampai P1-04

Selesaikan penyesuaian layout setelah kontrol dan track media tersedia. Layout audio-only yang sekarang sudah memiliki breakpoint mobile, tetapi tambahan kontrol kamera/share/perangkat dan area presentasi perlu diverifikasi kembali.

**Kriteria selesai**

- Pada desktop, video/share dan panel transkrip tetap terbaca; pada mobile kontrol tidak meluber atau tertutup panel.
- Tombol memiliki label yang jelas, status aktif/nonaktif, serta state sedang diproses untuk mencegah aksi ganda.
- Peserta reconnect, kehilangan track, atau keluar memperbarui tile dan kontrol dengan benar.
- Video/share tidak menghasilkan audio ganda; preview lokal tidak memutar suara mikrofon sendiri.
- Animasi media menghormati preferensi reduced motion yang sudah ada di stylesheet.
- Jalankan build/lint dan tes yang relevan; catat browser, jumlah peserta, hasil uji media nyata, dan batasan yang ditemukan.

## Lanjutan Pengaturan — mengikuti konsep pengguna

### P1-07 — Overview dan navigasi Pengaturan

**Status:** implementasi lokal dan verifikasi otomatis selesai.

- Menu Pengaturan di sidebar; overview dengan pencarian kategori dan kartu identitas rapat yang bersifat informatif.
- Kategori aktif Audio & Video serta Tampilan Rapat.
- Notifikasi, AI & Notulen, Rekaman & Penyimpanan, serta Keamanan & Akses ditandai menunggu integrasi; tidak menyediakan toggle palsu.
- Identitas ditampilkan sebagai data formulir rapat, bukan klaim sesi login perusahaan yang sudah terverifikasi.

**Kriteria selesai:** navigasi desktop/mobile, pencarian termasuk hasil kosong, label aksesibilitas, dan membuka halaman tanpa menyalakan media terverifikasi.

### P1-08 — Preferensi audio/video dan handoff ke prejoin

**Status:** implementasi lokal dan verifikasi otomatis selesai; acceptance headset/webcam fisik belum dilakukan.

- Simpan mikrofon, kamera, speaker/headset default, serta kondisi awal mic/kamera.
- Penyimpanan browser menggunakan schema versi 1; hanya preferensi yang diizinkan, tanpa nama/NIK/token.
- Simpan, Batal, Default, pesan gagal simpan, serta pilihan perangkat yang sudah tidak tersedia.
- Simpan & periksa perangkat membuka preview P1-05 dengan pilihan baru; preview tidak otomatis menangkap media.
- Speaker diterapkan saat room terhubung; perangkat tidak tersedia/izin gagal menggunakan fallback/pesan yang jelas. Pergantian manual selama rapat dipertahankan saat reconnect.

**Kriteria selesai:** persistensi setelah reload, input dipakai oleh capture LiveKit, output browser didukung, cleanup media, storage ditolak, serta output tidak didukung terverifikasi. Input SpeechRecognition browser tetap mengikuti keterbatasan P1-03; pilihan perangkat LiveKit tidak menjamin perangkat STT browser sama.

### P1-09 — Preferensi tampilan rapat

**Status:** implementasi lokal dan verifikasi otomatis selesai.

- Sorotan pembicara otomatis bisa dinonaktifkan menjadi grid; riwayat speaker tetap diproses dan screen share tetap prioritas.
- Mirror hanya pada preview/video lokal; kamera remote dan screen share tidak ikut dicerminkan.
- Kurangi animasi tersimpan dan diterapkan pada workspace. Preferensi reduced motion sistem tetap dihormati.

**Kriteria selesai:** perubahan benar-benar memengaruhi preview/room, tetap tersimpan setelah reload, dan Batal mengembalikan pilihan tersimpan.

### P1-10 — Verifikasi Pengaturan dan regresi frontend dari main

**Status:** implementasi dan verifikasi otomatis lokal selesai. Acceptance hardware dan screen reader masih terbuka.

- Setelah integrasi dengan `main/ffbd333`: 105 tes frontend dan 22 tes backend lulus; build/lint exit 0 dengan warning bawaan Jadwal dan ukuran bundle.
- Harness `scripts/verify-settings.mjs` memverifikasi browser, storage, prejoin, room LiveKit, dan notulen dengan backend terisolasi serta media/respons simulasi.
- Overview, Audio & Video, dan Tampilan Rapat diuji pada 1440 px dan 390 px; empat tampilan diuji axe, nol pelanggaran otomatis. Hasil `incomplete` kontras tetap perlu penilaian manual.
- Perbaikan MAIN-01: loading/error/retry notulen tampil walaupun hasil masih null.
- Perbaikan MAIN-03: ekspor memakai API_BASE yang sama. Isi PDF/database sebenarnya belum diuji.
- Hasil notulen lama tidak menimpa sesi baru. Kegagalan flush transkrip tetap mempertahankan ruang rapat dan menyediakan retry.
- Lima blok konflik integrasi Jadwal/Pengaturan diselesaikan dengan mempertahankan kedua menu, view, dan callback. Menu mobile disusun tiga kolom untuk menghindari overflow.
- Harness memeriksa create/cancel jadwal fixture, navigasi desktop/mobile, persistensi preferensi, serta handoff kode ruang dan media default dari Jadwal ke prejoin.

**Masih perlu dilakukan:** webcam/headset kantor, browser target, pemilihan output/izin nyata, screen reader, dan uji ulang Office LLM dengan Person 3. MAIN-02 (routing riwayat DB) tetap tugas Person 2; tidak diubah dalam pengembangan frontend ini.

### Backlog lanjutan setelah kontrak backend tersedia

| Task | Kebutuhan | Koordinasi | Status |
| --- | --- | --- | --- |
| P1-11 — Profil perusahaan | API sesi pengguna, field yang boleh diedit, upload foto; NIK/departemen/jabatan mengikuti sumber resmi | Person 2 | Menunggu autentikasi dan API profil |
| P1-12 — Notifikasi | Event undangan, jadwal, pengingat, notulen siap; preferensi delivery dan izin browser | Person 2 | Menunggu sumber event dan jadwal |
| P1-13 — UI preferensi AI | Default bahasa, hak host, status transkripsi, format notulen; berlaku konsisten per ruang | Person 2 + Person 3 | Menunggu kontrak room dan pipeline |
| P1-14 — Rekaman, keamanan, admin | API rekaman/kuota/retensi, session auth, role/RBAC; halaman admin hanya untuk pengguna berhak | Person 2 + Person 3 | Menunggu layanan dan kebijakan perusahaan |

## Checklist verifikasi lintas fitur

- Rapat audio yang sudah ada tetap berjalan; mute/unmute, transkrip, peserta, dan keluar rapat tidak regresi.
- Uji setidaknya dua sesi browser dengan kondisi kamera aktif/mati, screen share mulai/berhenti, dan pergantian speaker.
- Uji izin kamera/mikrofon ditolak, perangkat tidak tersedia, perangkat dicabut, dan pengguna membatalkan screen share.
- Uji ukuran desktop dan mobile; tidak ada kontrol tertutup panel transkrip atau tile yang meluber.
- Periksa konsol browser dan pastikan tombol disabled/loading mengikuti status koneksi atau proses penyelesaian rapat.

## Batas integrasi tim

- **Person 1:** UI dan kontrol media di atas, termasuk publikasi/render track LiveKit dan pengujian pengalaman browser.
- **Person 2:** autentikasi, penyimpanan, webhook, attendance, dan pengiriman event/transkrip lintas peserta melalui data channel. Jangan menganggap publish data dari klien sebagai penyimpanan permanen atau kontrol akses.
- **Person 3:** transkripsi terpusat/server-side, ringkasan AI, ekspor, dan persiapan Android. UI Person 1 perlu menampilkan status/hasil yang disediakan layanan tersebut, tetapi pipeline transkripsi bukan bagian task media ini.

## Langkah berikutnya untuk Person 1

Kode P1-01 sampai P1-10 sudah tersedia pada tahap implementasi lokal. Lanjutkan acceptance perangkat kantor sesuai [checklist P1-06](./P1_06_MEDIA_EXPERIENCE_IMPLEMENTATION.md#acceptance-manual) dan [checklist Pengaturan](./P1_07_10_SETTINGS_IMPLEMENTATION.md#acceptance-manual). P1-01–P1-06 sudah dipublikasikan; perubahan P1-07–P1-10 dan laporan testing terbaru masih lokal. Untuk P1-11–P1-14, sepakati kontrak autentikasi/API/event dengan Person 2/3 terlebih dahulu.

## Catatan implementasi

Sebelum memakai komponen atau hook LiveKit tertentu, cocokkan dengan versi dependency yang telah dipasang (`@livekit/components-react` dan `livekit-client`) dan pola koneksi room yang ada. Pertahankan audio-only sebagai fallback yang jelas untuk browser/perangkat tanpa dukungan video atau screen share. Jangan mengubah task ini menjadi klaim bahwa transkripsi sudah menangkap semua peserta; itu perlu disediakan dan diverifikasi pada pipeline Person 3.
