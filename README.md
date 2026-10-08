# 📡 Bali Tower Sentra (BaliCall) — Video Call, AI Meeting Minutes & Cloud Recording Platform

A private, enterprise PC video and voice calling platform designed for **Bali Tower Telecom** internal operations, field transmission synchronization, and attendance coordination.

Combines **real-time WebRTC audio/video calling**, camera & screen sharing, active speaker spotlighting, dual-engine speech-to-text (Browser Web Speech API & Backend STT), **PostgreSQL database persistence (`jds3_db`)** with strict employee ID verification, **Meeting Scheduling (Kalender Interaktif)**, **Docker-based Cloud Meeting Recording (LiveKit Egress)**, and an **embedded AI Meeting Secretary** powered by the internal office LLM (`qwen-35b` at `http://10.7.1.21/v1`), Google Gemini, or Smart Demo Engine.

---

## 🌟 Key Features & Architecture

### 1. 📹 Video Calling, Camera & Screen Sharing
* **Video Grid & Spotlight:** Multi-party responsive video grid with active speaker spotlighting that automatically detects and elevates the currently speaking participant.
* **Camera Controls:** Seamless camera toggle, graceful fallback when cameras are disconnected or permissions denied, and non-blocking audio continuation.
* **Screen Sharing:** High-framerate desktop/window presentation stage with active presenter ribbon.
* **Device Settings Dialog:** Hardware selection for microphone, camera, and speaker audio output with real-time level feedback.

### 2. ⚡ LiveKit WebRTC SFU (Port 7880, 7881, 7882)
* High-performance, low-latency WebRTC media delivery powered by LiveKit SFU.
* Automatic room lifecycle and participant management.
* WebRTC token authorization scoping each user to an active session.

### 3. 🔴 Cloud Meeting Recording (LiveKit Egress + Redis in Docker)
* **Server-side Composite Recording:** Menggunakan headless Chromium dan GStreamer pipeline terisolasi di dalam container Docker (`livekit/egress`) untuk merekam seluruh tampilan room panggilan (video peserta, screen share, dan audio) ke file `.mp4` berkualitas tinggi.
* **Sinkronisasi Status Real-time:** Status perekaman dipancarkan secara otomatis ke semua peserta melalui event `RoomEvent.RecordingStatusChanged` (indikator `🔴 Merekam`).
* **Penyimpanan Lokal & Otomatis:** Video disimpan di direktori volume host [`infrastructure/livekit/recordings/`](infrastructure/livekit/recordings/) dan perekaman otomatis dihentikan saat rapat berakhir.

### 4. 📅 Meeting Scheduling (Jadwal Rapat & Kalender Interaktif)
* **Antarmuka Kalender & Time Picker:** Menu penjadwalan langsung di beranda dan sidebar dengan kalender interaktif serta preset durasi (15m, 30m, 45m, 1h, 1.5h, 2h).
* **Validasi Waktu Ketat:**
  * Menolak tanggal dan jam masa lalu.
  * Menolak waktu selesai yang lebih awal daripada waktu mulai.
  * Mendukung rapat lintas tengah malam (*cross-midnight shift*) hingga batas 8 jam.
* **Slug Otomatis:** Menghasilkan slug room URL yang ramah (`room_slug`) secara dinamis berdasarkan judul rapat dan tanggal.
* **Persistensi Database:** Tersimpan di tabel `balicall_schedules` dengan status terverifikasi dan tombol pintas langsung ke room rapat.

### 5. 🎙️ Dual Speech-to-Text (STT) Engine
* **Browser STT (`STT_PROVIDER=browser`):** Built-in Web Speech API recognition untuk Bahasa Indonesia (`id-ID`) dan English (`en-US`) dengan render transkrip instan lokal.
* **Backend STT (`STT_PROVIDER=server`):** Menangkap audio mikrofon (~8 detik) dan mengirimkannya ke layanan `/audio/transcriptions` internal tanpa mengekspos API key ke browser.
* **Resilient Save Queue:** Idempotent dialogue buffering dengan optimistic UI updates dan deduplikasi unik (`tx-...`).

### 6. 🗄️ PostgreSQL Database Integration (`jds3_db`)
Penyimpanan data perusahaan persisten di PostgreSQL (`10.17.101.232:5432/jds3_db`) dengan prefix `balicall_*`:
* **`balicall_employees`**: Direktori resmi karyawan (`employee_id`, `name`, `department`, `position`, `status`).
* **`balicall_meetings`**: Riwayat sesi rapat dan timestamp (`id`, `room_name`, `status`, `created_at`, `ended_at`).
* **`balicall_summaries`**: Notulen terstruktur (`executive_summary`, `key_discussion_points`, `decisions`, `action_items`, `attendance_summary`).
* **`balicall_transcripts`**: Log percakapan berurutan terindeks ID meeting.
* **`balicall_attendees`**: Daftar presensi kehadiran dengan waktu join dan leave.
* **`balicall_schedules`**: Data rapat terjadwal dan slot kalender.

#### 🔒 Validasi Ketat Format ID Karyawan
* Format NIK resmi: `/^BT-\d{4,6}$/i` (contoh: `BT-10492`).
* Format teks salah (misal: `ns-12nsunauu`) ditolak dengan **`400 Bad Request`**: `"Format ID Salah."`.
* NIK tidak terdaftar (misal: `BT-99999`) ditolak dengan **`403 Forbidden`**: `"Akses ditolak: Employee ID tidak terdaftar di database resmi perusahaan."`.

### 7. 🤖 AI Meeting Secretary (Office Qwen-35b & Gemini)
* Menghasilkan notulen rapat terstruktur langsung dari riwayat transkrip dialog:
  * Executive Summary
  * Poin Pembahasan Utama
  * Keputusan yang Disepakati
  * Action Items (Tugas, PIC, Prioritas, Deadline)
  * Ringkasan Kehadiran
* Mendukung gateway internal kantor (`LLM_PROVIDER=office`, `qwen-35b`), Google Gemini (`LLM_PROVIDER=gemini`), atau fallback offline (`LLM_PROVIDER=demo`).
* Tersimpan otomatis ke PostgreSQL saat rapat selesai.

### 8. 🔗 Cryptographic LiveKit Webhooks & ERP Outbound Dispatch
* **Inbound SFU Webhooks (`POST /api/livekit/webhook`):** Verifikasi signature kriptografis JWT & checksum SHA-256 via `WebhookReceiver`.
* **Outbound Webhooks (`OUTBOUND_WEBHOOK_URL`):** Mengirim payload notulen rapat ke ERP internal, Microsoft Teams, atau bot Telegram.

---

## 🐳 Panduan Menjalankan Docker (LiveKit + Redis + Egress)

Jika Anda ingin mengaktifkan fitur **Perekaman Video (Recording)**, gunakan Docker Compose yang telah disediakan di folder [`infrastructure/livekit/`](infrastructure/livekit/).

### Prasyarat:
* **Windows:** Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) (dengan backend WSL 2 aktif).
* **Linux:** Install `docker.io` dan `docker-compose-v2` (`sudo apt install -y docker.io docker-compose-v2`).

### 1. Menyalakan Layanan Docker
Buka terminal dan masuk ke folder infrastruktur:
```bash
cd infrastructure/livekit
docker compose up -d
```
Docker akan menyalakan 3 container di background:
* `balicall-redis` (Redis 7) — IPC & antrean tugas Egress.
* `balicall-livekit` (LiveKit SFU v1.13.7) — Port 7880 (HTTP/WS), 7881 (TCP RTC), 7882 (UDP RTC).
* `balicall-egress` (LiveKit Egress v1.14.1) — Headless Chrome recorder dengan capability `SYS_ADMIN`.

### 2. Memeriksa Status & Log
```bash
# Cek container yang sedang berjalan
docker compose ps

# Cek log recorder Egress realtime
docker compose logs -f egress

# Menghentikan container jika sudah selesai
docker compose down
```

### 3. Lokasi File Rekaman
Hasil rekaman panggilan `.mp4` akan otomatis tersimpan di folder:
```
infrastructure/livekit/recordings/
```

> [!TIP]
> Skrip [`start.bat`](start.bat) di Windows sudah **otomatis mendeteksi** jika LiveKit sedang berjalan di Docker (port 7880 aktif). Skrip akan melewati peluncuran binary LiveKit native agar tidak terjadi bentrok port, dan langsung menjalankan backend API serta web client.

---

## 🚀 Menjalankan Aplikasi di Windows

Gunakan **Node.js 24 LTS** (minimum 22.18).

### Cara Cepat (Otomatis):
Cukup klik dua kali [`start.bat`](start.bat).
Skrip ini akan otomatis:
1. Memverifikasi instalasi Node.js dan dependensi.
2. Mendeteksi apakah LiveKit berjalan di Docker; jika tidak, menjalankan binary native.
3. Menjalankan Backend API Express (Port 3001).
4. Menjalankan Frontend Vite (Port 5187).
5. Membuka peramban di `http://localhost:5187`.

### Peluncuran Manual via Terminal:
```powershell
# Terminal 1: Backend API (Port 3001)
npm run dev --prefix server

# Terminal 2: Frontend Web (Port 5187)
npm run dev --prefix client
```

Buka browser di **`http://localhost:5187`**.

---

## 🐧 Menjalankan & Deploy di Linux (SSH Environment)

Untuk panduan lengkap deployment di server Linux (Ubuntu/Debian) seperti `sv-training-2`, reverse proxy Nginx HTTPS, dan daemon PM2, silakan baca dokumentasi khusus:
👉 **[Panduan Lengkap Linux Deployment](docs/LINUX_DEPLOYMENT.md)**

Ringkasan perintah di Linux:
```bash
# 1. Setup & build
chmod +x scripts/setup.sh start.sh
./scripts/setup.sh

# 2. Menjalankan via PM2 (Background Daemon)
pm2 start ecosystem.config.cjs
pm2 status
```

---

## ⚙️ Konfigurasi Environment (`server/.env`)

Salin dari [`server/.env.example`](server/.env.example) ke `server/.env`:

```env
PORT=3001
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=c35dce5eb68185c1ba3b140ab408da916a75c0d297f42c96cbbe5aa362f7b082

# Database PostgreSQL Intranet (jds3_db)
DATABASE_URL=postgresql://jds3:PASSWORD@10.17.101.232:5432/jds3_db
VERIFY_EMPLOYEE_ID=true

# LLM Provider Configuration ("office" | "gemini" | "demo")
LLM_PROVIDER=office
LLM_BASE_URL=http://10.7.1.21/v1
LLM_MODEL=qwen-35b
LLM_KEY=sk-c1PP5Ngd9Dh7q2ZjiwZAIg
LLM_TIMEOUT_MS=60000

# Google Gemini (Alternatif)
GEMINI_API_KEY=

# Speech-to-Text Configuration ("browser" | "server")
STT_PROVIDER=browser
STT_BASE_URL=http://HOST-STT:8000/v1
STT_MODEL=whisper-large-v3
STT_API_KEY=

# Outbound Notification Webhook (Opsional: ERP, Teams, Telegram)
OUTBOUND_WEBHOOK_URL=
```

---

## 🛠️ API Reference

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Status server, LiveKit SFU, LLM, STT, PostgreSQL, dan webhook |
| `GET` | `/api/employees` | Mengambil direktori resmi karyawan dari `balicall_employees` |
| `POST` | `/api/token` | Menghasilkan token LiveKit JWT & memverifikasi NIK karyawan |
| `GET` | `/api/meetings/:id/transcript` | Mengambil riwayat transkrip dialog dan kehadiran rapat |
| `POST` | `/api/meetings/:id/transcript` | Menyimpan transkrip percakapan dengan deduplikasi id |
| `POST` | `/api/meetings/:id/audio` | Mengirim segmen audio untuk transkripsi backend STT |
| `POST` | `/api/meetings/:id/presence` | Sinkronisasi heartbeat kehadiran peserta |
| `POST` | `/api/meetings/:id/leave` | Mencatat peserta keluar (otomatis stop recording jika meeting berakhir) |
| `POST` | `/api/meetings/:id/recording/start` | **Mulai Perekaman:** Menjalankan LiveKit Egress composite recording |
| `POST` | `/api/meetings/:id/recording/stop` | **Hentikan Perekaman:** Menghentikan Egress & menyimpan file video |
| `POST` | `/api/meetings/:id/summarize` | Menghasilkan notulen AI & menyimpannya ke PostgreSQL |
| `GET` | `/api/meetings/db-summaries` | Mengambil daftar riwayat notulen dari PostgreSQL |
| `GET` | `/api/meetings/db-details/:id` | Mengambil detail lengkap rapat (notulen, transkrip, presensi) |
| `GET` | `/api/schedules` | Mengambil daftar rapat terjadwal aktif dari `balicall_schedules` |
| `POST` | `/api/schedules` | Menjadwalkan rapat masa depan dengan validasi tanggal & jam ketat |
| `PUT` | `/api/schedules/:id` | **Jadwal Ulang:** Memperbarui tanggal, jam mulai/selesai rapat terjadwal |
| `DELETE` | `/api/schedules/:id` | Membatalkan / menghapus jadwal rapat |
| `POST` | `/api/livekit/webhook` | **Inbound LiveKit Webhook:** Verifikasi cryptographic signature event SFU |
| `GET` | `/api/livekit/webhooks` | Melihat log audit riwayat webhook |
| `POST` | `/api/meetings/:id/dispatch-webhook` | **Outbound Webhook:** Mengirim notulen ke webhook ERP eksternal |

---

## 🧪 Pengujian & Verifikasi (149 Passing Tests)

Seluruh komponen dilengkapi dengan automated unit & integration test suites:

### 1. Test Suite Backend API (22 tests):
```powershell
npm --prefix server test
```
*Memverifikasi token session, kehadiran, deduplikasi transkrip, timeout LLM, validasi format NIK (`ns-12nsunauu` -> 400), penolakan ID tidak terdaftar (403), Egress recording lifecycle, serta pembuatan, reschedule (PUT), dan pembatalan jadwal rapat.*

### 2. Test Suite Frontend Client (127 tests):
```powershell
npm --prefix client test
```
*Memverifikasi kontrol kamera, screen share, pemilih perangkat audio/video, active speaker spotlighting, Web Speech API recognizer, validasi kalender jadwal, penjadwalan ulang rapat (rescheduling), dan antrean simpan.*

### 3. Build Produksi Frontend:
```powershell
npm --prefix client run build
```

### 4. Uji Integrasi Database:
```powershell
node scripts/test_db.js
```
*Memverifikasi koneksi PostgreSQL `jds3_db`, skema tabel `balicall_*`, dan query transaksi.*

---

## 💻 Pengaturan & Preferensi Pengguna

Menu **Pengaturan** di aplikasi menyediakan opsi:
* Default input mikrofon, kamera, dan speaker audio output.
* Konfigurasi kondisi awal saat masuk panggilan (Mute by default / Camera on).
* Pengaturan sorotan otomatis pembicara aktif (*Speaker Spotlight*).
* Mirror video lokal dan preferensi pengurangan animasi (*Reduced Motion*).
* Seluruh preferensi disimpan di `localStorage` per peramban dan diterapkan otomatis saat memasuki sesi rapat.
