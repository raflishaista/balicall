# Pembaruan desain Bali Tower Sentra

Tanggal: 5 Oktober 2026. Acuan: gambar konsep biru/navy BaliTower yang diberikan pengguna. Antislop dinonaktifkan atas permintaan pengguna.

## Perubahan

- Sidebar navy menjadi navigasi utama. Navigasi ganda pada header dihapus.
- Logo resmi berwarna dan foto menara BaliTower disimpan lokal; URL sumber dicatat di `client/public/brand/README.md`.
- Dashboard memakai banner menara, tiga aksi rapat, gabung cepat dengan kode, keadaan kosong aktivitas, dan status layanan nyata.
- Create/Join memakai form dengan label, validasi browser, pratinjau peserta, dan pemeriksaan mikrofon. Persona demo dilipat dan hanya tersedia saat development.
- Ruang rapat memakai tile peserta suara, kontrol mikrofon/transkripsi, panel transkrip putih, status layanan, bahasa, dan peserta. Ucapan manual untuk pengujian dilipat.
- Notulen memakai tab, pencarian transkrip, dan pratinjau keputusan serta tugas.
- Komponen tampilan dipisahkan ke `Workspace.tsx` dan `MeetingRoom.tsx`; logika sesi, antrean simpan, dan hook transkripsi tetap di `App.tsx`.
- Port frontend tetap 5187 dengan `strictPort`.

## Verifikasi

- Build produksi berhasil. Warning ukuran bundle >500 kB masih ada.
- Lint berhasil tanpa warning pada pemeriksaan terakhir.
- 25 tes client dan 18 tes server lulus.
- Browser: dashboard, panduan dengan Escape/fokus, gabung dengan kode, validasi NIK/nama, room connection, panel peserta/transkrip, penyimpanan ucapan manual, penyelesaian rapat, tab notulen, serta pencarian dengan hasil kosong diuji.
- Desktop 1440×900 dan mobile 360×800 diperiksa. Home, lobby, dan notulen tidak menghasilkan overflow horizontal pada mobile.
- Tidak ada error console baru setelah reload verifikasi.
- Sesi lokal `ui-redesign-check-27c3` memakai identitas `UI-TEST-27C3 / Uji Desain`, satu ucapan manual berlabel pengujian, dan sudah diselesaikan. Preview kemudian di-reload untuk membersihkan state pengujian dari layar.
- Screenshot nyata disimpan di `docs/screenshots/` untuk Home, Lobby, Room, dan Recap. Screenshot room/recap memuat data uji tersebut.

## Batas verifikasi dan pekerjaan lanjutan

- Pengujian ucapan manual memverifikasi penyimpanan dan tampilan transkrip, bukan pengenalan suara mikrofon.
- Health lokal menunjukkan STT browser; STT server belum dikonfigurasi. LLM masih memakai mode demo. Ringkasan AI produksi perlu konfigurasi provider/kunci dan pengujian tersendiri.
- Video, share screen, chat, kalender, rekaman, dan Ask AI saat rapat pada gambar konsep belum diimplementasikan. Kontrol fitur itu belum ditampilkan.
- Aktivitas dashboard menyimpan rapat terakhir dalam state sesi halaman; riwayat lintas reload belum dihubungkan ke backend.
- Pemicu Antislop berada di `.agents/disabled/`. Jangan aktifkan kembali kecuali pengguna meminta.
