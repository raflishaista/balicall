# 📡 Bali Tower Voice Call & AI Meeting Minutes Platform

A private, enterprise PC voice calling platform designed for **Bali Tower Telecom** internal operations, site maintenance, and attendance coordination. Features an **embedded AI Meeting Secretary** powered by the internal office LLM (`qwen-35b` at `http://10.7.1.21/v1`), sub-10ms real-time WebRTC Data Channels, cryptographic LiveKit Webhook integration, and automated meeting minutes synthesis.

---

## 🌟 Key Architecture & Features

### 1. ⚡ LiveKit WebRTC Data Channels (Sub-10ms P2P)
* Transcripts are transmitted peer-to-peer across all participants in `<10ms` using WebRTC Data Channels (`publishData` on topic `transcript`).
* **Zero Latency Feedback:** Local speech turns render with 0ms optimistic updates while asynchronously syncing to the backend.
* **Deterministic Deduplication:** Every dialogue entry has a unique UUID (`tx-...`) ensuring zero duplicate lines across data channel broadcasts and server synchronization.

### 2. 🤖 Non-Blocking "End Meeting First" & Background AI Synthesis
* **Instant Media Disconnect:** Ending a meeting immediately terminates the LiveKit audio room, releases the microphone, and transitions directly to the summary view (`SummaryView`). Users are never trapped waiting inside an active room while the LLM generates notes.
* **Asynchronous AI Processing:** The summary screen displays a sleek loading state with an animated spinner, room turn metrics, and a scrollable transcript preview.
* **Error Resilience & Retry:** If corporate VPN or LLM connectivity drops, dialogue turns are preserved safely, offering a **"🔄 Retry AI Generation"** button without losing discussion history.

### 3. 🛡️ Session Isolation (One Call = One Transcript)
* Each call session is isolated with a unique `callId` (`call-...`) and lifecycle state (`active` vs `ended`).
* Finished calls are sealed and automatically archived into `meetingHistory`.
* Re-entering the same room name (e.g., `#site-sync-tower-jakarta`) automatically initializes a clean session with an empty transcript feed.

### 4. 🔗 Cryptographic LiveKit Webhooks & ERP Outbound Dispatch
* **Inbound SFU Webhooks (`POST /api/livekit/webhook`):**
  * Cryptographically verified using `WebhookReceiver` from `livekit-server-sdk` (JWT signature & SHA-256 body checksum).
  * Automatically synchronizes attendance rosters directly from media server events (`participant_joined`, `participant_left`, `room_started`, `room_finished`, `track_published`).
  * In-memory rolling event audit log accessible via `GET /api/livekit/webhooks`.
* **Outbound Notification Webhooks (`OUTBOUND_WEBHOOK_URL`):**
  * Dispatches structured AI meeting minutes and action items to external enterprise endpoints (e.g., HR attendance portal, Bali Tower ERP, Microsoft Teams, or Telegram bots).
  * Manual dispatch endpoint available via `POST /api/meetings/:roomName/dispatch-webhook`.

### 5. 🧪 Speech Diagnostics Lab
* Integrated diagnostic modal to test and troubleshoot microphone hardware decibel levels, recording playback, and Web Speech API network connectivity in enterprise desktop environments.

---

## ⚙️ Configuration (`server/.env`)

Configure your environment variables in [`server/.env`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/server/.env) (created automatically from [`server/.env.example`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/server/.env.example)):

```env
PORT=3001
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# LLM Provider Configuration ("office" | "gemini" | "demo")
LLM_PROVIDER=office

# Office Gateway (Internal Bali Tower Qwen-35b)
LLM_KEY=your_office_api_key_here
LLM_BASE_URL=http://10.7.1.21/v1
TEXT_MODEL=qwen-35b

# Fallback Google Gemini (Optional)
GEMINI_API_KEY=

# Outbound Integration Webhook (Optional: ERP, Teams, Telegram, Slack)
OUTBOUND_WEBHOOK_URL=http://your-internal-erp/api/meeting-minutes-webhook
```

> **Note:** If `LLM_KEY` is not provided, the server automatically defaults to the built-in **Smart Demo Engine** so that all UI, call, and summary workflows can be fully tested without errors.

---

## 🚀 Quick Start (Running on Windows)

### 1. Instant Automated Launch:
Double-click [`start.bat`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/start.bat).
The script is **self-healing** and will automatically:
1. Verify **Node.js** is installed.
2. Generate `server/.env` if not present.
3. Automatically download `bin/livekit-server.exe` (Windows binary) if missing.
4. Run `npm install` in both `server/` and `client/` if needed.
5. Launch the LiveKit SFU server with [`livekit.yaml`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/livekit.yaml) configuration (Port 7880).
6. Launch the Express Backend API (Port 3001).
7. Launch the Vite PC Web Client (Port 5173).

### 2. Manual Launch via Terminal:
```powershell
# 1. Start LiveKit SFU Server (Terminal 1)
bin\livekit-server.exe --config livekit.yaml --dev

# 2. Start Backend API Server (Terminal 2)
cd server
npm run dev

# 3. Start Frontend Client (Terminal 3)
cd client
npm run dev
```

Open your browser at **`http://localhost:5173`**.

---

## 📡 LiveKit SFU Server Configuration (`livekit.yaml`)

The SFU server is configured to fire webhooks directly to the backend Express server:

```yaml
port: 7880
bind_addresses:
  - "127.0.0.1"

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: false

keys:
  devkey: secret

webhook:
  api_key: devkey
  urls:
    - http://127.0.0.1:3001/api/livekit/webhook
```

---

## 🛠️ API & Webhook Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health status, LLM configuration, active rooms, webhook stats |
| `POST` | `/api/token` | Issues a LiveKit JWT token with Employee ID, name, and permissions |
| `GET` | `/api/meetings/:roomName/transcript` | Fetches active transcripts and attendance for a room |
| `POST` | `/api/meetings/:roomName/transcript` | Persists a dialogue line (idempotent with deduplication) |
| `POST` | `/api/meetings/:roomName/summarize` | Triggers AI meeting minutes synthesis (`qwen-35b` / Gemini) & saves to PostgreSQL |
| `POST` | `/api/meetings/:roomName/reset` | Resets and archives a room session for a fresh call |
| `GET` | `/api/meetings/history` | Retrieves list of completed past meetings and summaries (in-memory) |
| `GET` | `/api/employees` | Lists authorized company employees from `balicall_employees` |
| `GET` | `/api/meetings/db-summaries` | Retrieves persisted meeting summaries directly from PostgreSQL |
| `GET` | `/api/meetings/db-details/:meetingId` | Retrieves complete meeting record, transcripts, and attendees from PostgreSQL |
| `POST` | `/api/livekit/webhook` | **Inbound LiveKit Webhook:** Cryptographically verified room/peer events |
| `GET` | `/api/livekit/webhooks` | Returns recent LiveKit webhook event audit log |
| `POST` | `/api/livekit/webhook/test` | Local simulation endpoint for testing webhook payloads |
| `POST` | `/api/meetings/:roomName/dispatch-webhook` | **Outbound Webhook:** Dispatches minutes to external ERP/webhooks |

---

## 🗄️ PostgreSQL Database Integration

Bali Tower Call integrates with the company PostgreSQL instance (`jds3_db` on `10.17.101.232:5432`) without requiring `CREATE DATABASE` privileges. All tables use the prefix `balicall_*`:

* **`balicall_employees`**: Authorized company employee registry (`employee_id`, `name`, `email`, `department`, `position`, `status`). When creating/joining calls, the backend strictly verifies the participant's Employee ID against this table.
* **`balicall_meetings`**: Meeting session lifecycle (`id`, `room_name`, `status`, `created_at`, `ended_at`).
* **`balicall_summaries`**: Structured AI meeting minutes (`title`, `executive_summary`, `key_discussion_points`, `decisions`, `action_items`, `attendance_summary`, `provider`).
* **`balicall_transcripts`**: Real-time dialogue turns indexed by `meeting_id`.
* **`balicall_attendees`**: Attendance roster (`employee_id`, `employee_name`, `department`, `joined_at`, `left_at`).

### Setup & Verification

1. In [`server/.env`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/server/.env), set your database credentials:
   ```env
   DATABASE_URL=postgresql://jds3:YOUR_PASSWORD@10.17.101.232:5432/jds3_db
   ```
2. You can review and execute mock employee data via [`scripts/create_mock_employees.sql`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/scripts/create_mock_employees.sql) in DBeaver.
3. Run the database integration test:
   ```powershell
   node scripts/test_db.js
   ```
   *The test automatically runs schema migrations (`CREATE TABLE IF NOT EXISTS`), tests employee validation and mock data, tests full CRUD operations, and verifies relational integrity.*

---

## 🧪 Testing Webhooks

A dedicated verification script is included to test cryptographic LiveKit webhook processing:

```powershell
node scripts/test_webhook.js
```

This script generates a valid JWT signed with `LIVEKIT_API_SECRET`, attaches the body's SHA-256 hash claim, and sends it to `http://localhost:3001/api/livekit/webhook`.

You can also view the live webhook event logs via:
```bash
curl http://localhost:3001/api/livekit/webhooks
```

---

## 👥 How to Test Multi-User Calling & AI Minutes

1. Open `http://localhost:5173` in **two separate browser windows** (or two separate profiles/PCs).
2. Set Window 1 as **Rafli Aditya** (NOC) and Window 2 as **Budi Santoso** (Field Transmission).
3. Connect both to the same room: `#site-sync-tower-jakarta`.
4. Speak into your microphone or click the operational phrase presets. Notice:
   * Dialogue turns appear on both screens in **<10ms** via WebRTC Data Channels.
   * Both participants' attendance is automatically tracked.
5. Click **"End Meeting & Generate Minutes"**:
   * The call ends instantly and frees media devices.
   * The AI Secretary synthesizes the Executive Summary, Key Decisions, and Action Items.
   * Click **"Copy Summary"** to export clean Markdown meeting minutes for reports.
