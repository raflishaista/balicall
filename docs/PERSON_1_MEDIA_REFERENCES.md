# Referensi Person 1 — Frontend & Media Experience

Diperiksa 5 Oktober 2026. Pendamping [daftar task Person 1](./PERSON_1_FRONTEND_MEDIA_TASKS.md). Referensi di bawah berasal dari dokumentasi LiveKit, contoh resmi LiveKit, MDN, dan W3C. Arahan penerapan adalah rekomendasi untuk proyek BaliCall, bukan fitur yang sudah diimplementasikan.

## Mulai dari contoh aplikasi lengkap

[LiveKit Meet — source code](https://github.com/livekit-examples/meet) adalah aplikasi rapat terbuka yang menggunakan LiveKit Components dan Next.js. Repositorinya menyertakan tautan demo untuk melihat perilaku aplikasi.

**Cara memakainya untuk task kamu:** pelajari hubungan preview sebelum masuk, kontrol media, grid peserta, dan area presentasi. Karena BaliCall memakai React/Vite, adaptasikan komponen dan pola media ke `MeetingRoom`; template aplikasi Next.js tersebut tidak perlu dipindahkan ke proyek.

[VideoConference](https://docs.livekit.io/reference/components/react/component/videoconference/) menyediakan contoh komposisi rapat: grid, fokus peserta, pagination, kontrol, dan screen share. Ini bisa menjadi acuan layout untuk P1-01, P1-02, P1-04, dan P1-06. Rekomendasi untuk BaliCall: pertahankan panel transkrip serta branding yang ada dan gunakan bagian komponen yang diperlukan.

## P1-01 — Kamera dan video peserta

| Referensi | Yang dipelajari | Penerapan di BaliCall |
| --- | --- | --- |
| [Rendering video tracks](https://docs.livekit.io/reference/components/react/concepts/rendering-video/) | Mengambil referensi track lalu menampilkannya dengan `VideoTrack` | Ganti avatar dengan video ketika track kamera tersedia |
| [useTracks](https://docs.livekit.io/reference/components/react/hook/usetracks/) | Track kamera dan placeholder peserta tanpa kamera | Pertahankan peserta yang kameranya mati di grid |
| [TrackToggle](https://docs.livekit.io/reference/components/react/component/tracktoggle/) | Kontrol kamera/mic dengan status dan penanganan error | Tombol kamera di samping mic |
| [LocalParticipant API](https://docs.livekit.io/reference/client-sdk-js/classes/LocalParticipant.html#setCameraEnabled) | `setCameraEnabled` dan status kamera peserta lokal | Alternatif kontrol custom yang mengikuti status SDK |

**Arahan:** ambil track kamera melalui `useTracks([{ source: Track.Source.Camera, withPlaceholder: true }])`. Placeholder menjaga tile peserta tetap ada saat kamera tidak tersedia. Mengubah `video` pada `LiveKitRoom` saja belum menyediakan render video maupun kontrol pengguna.

Untuk kontrol custom gunakan hook state LiveKit. [Best practices React](https://docs.livekit.io/reference/components/react/guide/) menyarankan komponen/hook bawaan untuk kontrol media dan menghindari remount `LiveKitRoom` ketika props berubah. Untuk task ini, toggle kamera tidak boleh menyebabkan pengguna keluar/masuk room berulang kali.

## P1-02 — Screen share

- [Panduan screen sharing LiveKit](https://docs.livekit.io/transport/media/screenshare/): mulai berbagi dengan `localParticipant.setScreenShareEnabled(true)`; screen share dipublikasikan sebagai video track. Panduan juga membahas audio tab dan penerimaan audio.
- [LocalParticipant API](https://docs.livekit.io/reference/client-sdk-js/classes/LocalParticipant.html#setScreenShareEnabled): API mulai/berhenti share.
- [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): izin, error, kompatibilitas, dan kebutuhan interaksi pengguna sebelum dialog share bisa dibuka.

**Arahan:** pisahkan `Track.Source.ScreenShare` dari kamera. Tampilkan konten share pada area utama dengan `object-fit: contain` agar isi layar tidak terpotong. Tombol share harus memicu permintaan dari aksi pengguna; jangan otomatis memulai share dari efek React. Saat toolbar browser menghentikan share, gunakan perubahan track/state LiveKit untuk memperbarui UI dan memulihkan layout.

**Batasan:** audio screen share bergantung pada browser dan sumber yang dipilih. Jangan menjanjikan bahwa share jendela selalu membawa audio. Pertahankan `RoomAudioRenderer` yang sudah ada dan hindari memasang renderer audio tambahan untuk track yang sama.

## P1-03 — Device switcher

| Referensi | Yang dipelajari |
| --- | --- |
| [useMediaDeviceSelect](https://docs.livekit.io/reference/components/react/hook/usemediadeviceselect/) | Daftar perangkat, ID aktif, pergantian perangkat, dan error |
| [MediaDeviceSelect](https://docs.livekit.io/reference/components/react/component/mediadeviceselect/) | Komponen pemilihan perangkat yang bisa menjadi acuan dialog custom |
| [Room.switchActiveDevice](https://docs.livekit.io/reference/client-sdk-js/classes/Room.html#switchActiveDevice) | Mengganti perangkat room untuk mic, kamera, atau output audio |
| [MDN enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices) | Daftar input/output serta pembatasan izin |
| [MDN devicechange](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event) | Menanggapi perangkat disambungkan atau dicabut; cek tabel dukungan browser |
| [MDN setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId) | Dukungan dan izin pemilihan output audio |

**Arahan:** buat tiga pilihan: mikrofon (`audioinput`), kamera (`videoinput`), dan speaker/headset (`audiooutput`). Gunakan hook/SDK LiveKit untuk pergantian perangkat aktif; `enumerateDevices()` sendiri hanya mengembalikan daftar. Perbarui pilihan setelah hasil pergantian berhasil dan tampilkan error ketika gagal.

Daftar/label perangkat dapat dibatasi izin. LiveKit juga mencatat bahwa permintaan izin berulang melalui `getUserMedia` bisa memunculkan prompt berulang; koordinasikan permintaan izin dengan preview/lobby. Output audio perlu fallback jika API browser tidak tersedia atau izin tidak diberikan.

**Kaitan dengan transkripsi:** dari kode lokal, `useBackendTranscription` menerima track mikrofon LiveKit, sedangkan `useSpeechTranscription` menginisialisasi pengenal ucapan browser secara terpisah. Ini temuan proyek, bukan jaminan dari SDK. Uji hasil pergantian mic pada setiap mode dan koordinasikan keterbatasan input transkripsi browser dengan Person 3.

## P1-04 — Active speaker spotlight

- [useSpeakingParticipants](https://docs.livekit.io/reference/components/react/hook/usespeakingparticipants/): daftar peserta yang sedang berbicara.
- [Active speaker identification](https://docs.livekit.io/guides/room/receive#active-speaker-identification): event perubahan pembicara di room dan peserta.
- [LocalParticipant/Participant properties](https://docs.livekit.io/reference/client-sdk-js/classes/LocalParticipant.html#lastSpokeAt): properti `lastSpokeAt` yang diwariskan dari Participant.
- [useVisualStableUpdate](https://docs.livekit.io/reference/components/react/hook/usevisualstableupdate/): acuan menjaga grid/pagination agar perubahan peserta tidak membuat tile melompat berlebihan.

**Arahan:** gunakan perubahan speaker sebagai pemicu render dan timestamp pembicara terakhir sebagai acuan recency. Versi SDK lokal menyediakan `lastSpokeAt`; tentukan fallback stabil jika nilainya belum tersedia. Daftar speaker aktif dan urutan berdasarkan importance bukan jaminan urutan “paling baru berbicara”, sehingga aturan pemilihan spotlight tetap perlu dibuat.

Rekomendasi perilaku untuk BaliCall:

1. Screen share aktif tetap menjadi area utama.
2. Tanpa share, pilih pembicara terbaru sebagai spotlight.
3. Saat diam, pertahankan spotlight terakhir; ketika peserta itu keluar, pilih peserta yang masih ada.
4. Hindari sorting ulang pada setiap sampel volume. Gunakan aturan penundaan/tie-break yang diuji dengan pergantian speaker cepat.

`useVisualStableUpdate` membantu grid berpaginasi ketika track melebihi kapasitas satu halaman; hook ini tidak otomatis menyelesaikan seluruh aturan spotlight di atas.

## P1-05 — Preview sebelum bergabung

- [PreJoin](https://docs.livekit.io/reference/components/react/component/prejoin/): preview/pemilihan kamera dan mikrofon, dengan hasil pilihan diteruskan ke `LiveKitRoom`. Komponen ini bekerja tanpa koneksi server dan berada di luar `LiveKitRoom`.
- [usePreviewTracks](https://docs.livekit.io/reference/components/react/hook/usepreviewtracks/): acuan preview custom menggunakan track audio/video lokal.

**Arahan:** kembangkan lobby dan tes mic yang sudah ada. Tambahkan preview kamera dan simpan pilihan perangkat/status awal untuk dipakai ketika room terhubung. Jangan membuka kamera/mic kedua tanpa mengelola track preview sebelumnya. Uji pembatalan, perpindahan halaman, serta pembersihan track setelah bergabung.

## P1-06 — Layout dan dialog yang bisa diakses

- [VideoConference](https://docs.livekit.io/reference/components/react/component/videoconference/): acuan komposisi grid, fokus, dan pagination.
- [W3C Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): fokus di dalam dialog, navigasi Tab/Shift+Tab, Escape, dan pengembalian fokus setelah dialog ditutup.

**Arahan:** gunakan pola dialog tersebut untuk pengaturan perangkat. Uji kontrol kamera/share pada lebar mobile bersama panel transkrip. Buat label status serta tombol tutup yang jelas, dan pertahankan preferensi reduced motion yang sudah ada.

## Cocokkan dengan dependency proyek

Manifest lokal mendeklarasikan `@livekit/components-react ^2.9.24` dan `livekit-client ^2.22.3`. Deklarasi tipe yang terpasang sudah diperiksa untuk `useSpeakingParticipants`, `useMediaDeviceSelect`, dan `Participant.lastSpokeAt`; ketiganya tersedia. Referensi web dapat berubah, sehingga saat implementasi cocokkan argumen komponen/hook dengan tipe dan lockfile lokal.

**Urutan membaca:** contoh LiveKit Meet → rendering video + useTracks → screen sharing → device selection → speaker spotlight → PreJoin dan dialog. Setelah itu gunakan kriteria selesai di dokumen task untuk verifikasi dengan perangkat nyata.
