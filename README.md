# 📡 Bali Tower Sentra (BaliCall) — Video Call & AI Meeting Minutes Platform

A private, enterprise PC video and voice calling platform designed for **Bali Tower Telecom** internal operations, field transmission synchronization, and attendance coordination. 

Combines **real-time WebRTC audio/video calling**, camera and screen sharing, active speaker spotlighting, hardware device selection, dual-engine speech-to-text (Browser Web Speech API & Backend STT), **PostgreSQL database persistence (`jds3_db`)** with strict employee ID verification, and an **embedded AI Meeting Secretary** powered by the internal office LLM (`qwen-35b` at `http://10.7.1.21/v1`), Google Gemini, or Smart Demo Engine.

---

## 🌟 Key Features & Architecture

### 1. 📹 Video Calling, Camera & Screen Sharing
* **Video Grid & Spotlight:** Multi-party video grid with speaker spotlighting that automatically elevates the currently speaking participant.
* **Camera Controls:** Seamless camera toggle, graceful fallback when cameras are disconnected or permissions denied, and non-blocking audio continuation.
* **Screen Sharing:** High-framerate desktop/window presentation stage with active presenter ribbon.
* **Device Settings Dialog:** Hardware selection for microphone, camera, and speaker audio output with real-time level feedback.

### 2. ⚡ LiveKit WebRTC SFU (Port 7880)
* High-performance, low-latency WebRTC media delivery powered by LiveKit SFU.
* Automatic room lifecycle and participant management.
* WebRTC token authorization scoping each user to an active session.

### 3. 🎙️ Dual Speech-to-Text (STT) Engine
* **Browser STT (`STT_PROVIDER=browser`):** Built-in Web Speech API recognition for Indonesian (`id-ID`) and English (`en-US`) with instant local transcript rendering.
* **Backend STT (`STT_PROVIDER=server`):** Captures microphone audio segments (~8 seconds) and sends them to an internal OpenAI-compatible `/audio/transcriptions` service without exposing API credentials to the browser.
* **Resilient Save Queue:** Idempotent dialogue buffering with optimistic UI updates and deduplication (`tx-...`).

### 4. 🗄️ PostgreSQL Database Integration (`jds3_db`)
Persistent enterprise data storage in company PostgreSQL (`10.17.101.232:5432/jds3_db`) with prefix `balicall_*` (does not require `CREATE DATABASE` privilege):
* **`balicall_employees`**: Authorized company employee directory (`employee_id`, `name`, `department`, `position`, `status`).
* **`balicall_meetings`**: Meeting records and lifecycle timestamps (`id`, `room_name`, `status`, `created_at`, `ended_at`).
* **`balicall_summaries`**: Structured meeting minutes (`executive_summary`, `key_discussion_points`, `decisions`, `action_items`, `attendance_summary`).
* **`balicall_transcripts`**: Speech dialogue logs indexed by meeting ID.
* **`balicall_attendees`**: Participant attendance roster with joined/left timestamps.

#### 🔒 Strict Employee ID Verification & Format Validation
* Enforces official ID format: `/^BT-\d{4,6}$/i` (e.g. `BT-10492`).
* Malformed non-ID text (e.g. `ns-12nsunauu`) is rejected with **`400 Bad Request`**: `"Format ID Salah."`.
* Unregistered IDs (e.g. `BT-99999`) are rejected with **`403 Forbidden`**: `"Akses ditolak: Employee ID tidak terdaftar di database resmi perusahaan."`.
* Registered employees automatically load authoritative names and departments from the database.

### 5. 🤖 AI Meeting Secretary (Office Qwen-35b & Gemini)
* Generates structured minutes directly from conversation transcripts:
  * Executive Summary
  * Key Discussion Points
  * Agreed Decisions
  * Action Items (Task, Assignee, Priority, Deadline)
  * Attendance Roster
* Supports internal office gateway (`LLM_PROVIDER=office`, `qwen-35b`), Google Gemini (`LLM_PROVIDER=gemini`), or offline standby (`LLM_PROVIDER=demo`).
* Automatically persists minutes to PostgreSQL upon meeting completion.

### 6. 🔗 Cryptographic LiveKit Webhooks & ERP Outbound Dispatch
* **Inbound SFU Webhooks (`POST /api/livekit/webhook`):**
  * Cryptographically verified using `WebhookReceiver` from `livekit-server-sdk` (JWT signature & SHA-256 body checksum).
  * Automatically records room lifecycle and participant join/leave events.
  * In-memory rolling event audit log accessible via `GET /api/livekit/webhooks`.
* **Outbound Webhooks (`OUTBOUND_WEBHOOK_URL`):**
  * Dispatches structured minutes and attendance payload to corporate ERP, Microsoft Teams, or Telegram bots.

---

## 🚀 Menjalankan di Windows

Gunakan **Node.js 24 LTS** (minimum 22.18).

### 1. Peluncuran Otomatis (Start Bat):
Cukup klik dua kali [`start.bat`](start.bat).
Skrip ini otomatis:
1. Memverifikasi instalasi Node.js.
2. Mengunduh LiveKit SFU server jika belum ada.
3. Menginstal dependensi client dan server.
4. Menjalankan LiveKit SFU (Port 7880).
5. Menjalankan Backend API Express (Port 3001).
6. Menjalankan Frontend Vite (Port 5187).

### 2. Peluncuran Manual via Terminal:
```powershell
# 1. Jalankan setup awal (hanya pertama kali atau bila dependensi berubah)
npm run setup

# 2. Terminal 1: LiveKit SFU (Port 7880)
npm run sfu

# 3. Terminal 2: Backend API (Port 3001)
npm run server

# 4. Terminal 3: Frontend Client (Port 5187)
npm run client
```

Buka browser di **`http://127.0.0.1:5187`**.

---

## ⚙️ Konfigurasi (`server/.env`)

Salin dari [`server/.env.example`](server/.env.example) ke `server/.env`:

```env
PORT=3001
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Database PostgreSQL Intranet (jds3_db)
DATABASE_URL=postgresql://jds3:PASSWORD@10.17.101.232:5432/jds3_db
VERIFY_EMPLOYEE_ID=true

# LLM Provider Configuration ("office" | "gemini" | "demo")
LLM_PROVIDER=office
LLM_BASE_URL=http://10.7.1.21/v1
LLM_MODEL=qwen-35b
LLM_KEY=your_office_api_key_here
LLM_TIMEOUT_MS=30000

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

## 🛠️ API & Webhook Reference

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Status server, LiveKit SFU, LLM, STT, database PostgreSQL, dan webhook |
| `GET` | `/api/employees` | Mengambil daftar direktori karyawan resmi dari `balicall_employees` |
| `POST` | `/api/token` | Menghasilkan token LiveKit JWT & memverifikasi NIK karyawan di database |
| `GET` | `/api/meetings/:id/transcript` | Mengambil transkrip dialog dan daftar kehadiran untuk meeting |
| `POST` | `/api/meetings/:id/transcript` | Menyimpan baris ucapan dengan idempotensi deduplikasi |
| `POST` | `/api/meetings/:id/audio` | Mengirim audio rekaman untuk transkripsi server (Backend STT) |
| `POST` | `/api/meetings/:id/presence` | Sinkronisasi status kehadiran peserta |
| `POST` | `/api/meetings/:id/leave` | Mencatat peserta keluar dari sesi panggilan |
| `POST` | `/api/meetings/:id/summarize` | Menghasilkan notulen rapat AI dan menyimpannya ke PostgreSQL |
| `GET` | `/api/meetings/db-summaries` | Mengambil daftar riwayat notulen langsung dari PostgreSQL |
| `GET` | `/api/meetings/db-details/:id` | Mengambil detail lengkap rapat (notulen, transkrip, peserta) dari DB |
| `POST` | `/api/livekit/webhook` | **Inbound LiveKit Webhook:** Verifikasi signature kriptografis event SFU |
| `GET` | `/api/livekit/webhooks` | Melihat log audit event webhook LiveKit |
| `POST` | `/api/meetings/:id/dispatch-webhook` | **Outbound Webhook:** Mengirim notulen ke webhook ERP eksternal |

---

## 🧪 Pengujian & Verifikasi

### 1. Test Suite Backend API (20 tests):
```powershell
npm --prefix server test
```
*Memverifikasi token session, kehadiran, deduplikasi transkrip, timeout, validasi format NIK (`ns-12nsunauu` -> 400), penolakan ID tidak terdaftar (403), dan direktori karyawan.*

### 2. Test Suite Frontend Client (63 tests):
```powershell
npm --prefix client test
```
*Memverifikasi kontrol kamera, screen share, pemilih perangkat audio/video, speaker spotlighting, Web Speech API, dan antrean simpan.*

### 3. Build Produksi Frontend:
```powershell
npm --prefix client run build
```

### 4. Integrasi Database PostgreSQL:
```powershell
node scripts/test_db.js
```
*Memverifikasi koneksi PostgreSQL, pembuatan skema `balicall_*`, validasi NIK karyawan, dan operasi CRUD.*

### Pengaturan dan dokumen Person 1

Menu **Pengaturan** menyediakan default mikrofon/kamera/speaker, kondisi awal media, sorotan pembicara, mirror video lokal, dan pengurangan animasi. Preferensi tersimpan di browser dan diteruskan ke preview/room saat bergabung. Lihat [task Person 1](docs/PERSON_1_FRONTEND_MEDIA_TASKS.md), [implementasi Pengaturan](docs/P1_07_10_SETTINGS_IMPLEMENTATION.md), serta [hasil verifikasi](docs/SETTINGS_VERIFICATION.json).
