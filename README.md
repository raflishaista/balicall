# 📡 Bali Tower Voice Call & AI Minutes Environment (Base Prototype)

A dedicated, private PC voice calling platform designed for **Bali Tower** internal operations and attendance coordination, featuring an **embedded AI Meeting Secretary** that logs dialogue and generates structured meeting minutes with action items.

---

## ⚙️ AI Baseline Configuration (Office Gateway & Qwen-35B)

The backend is configured to use the internal Bali Tower AI gateway (`http://10.7.1.21/v1` with `qwen-35b`).

Edit [`server/.env`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/server/.env):
```env
# LLM Provider Configuration
LLM_PROVIDER=office

# Office Gateway (Qwen-35b)
LLM_KEY=your_office_api_key_here
# or LLM_API_KEY=your_office_api_key_here
LLM_BASE_URL=http://10.7.1.21/v1
LLM_MODEL=qwen-35b
TEXT_MODEL=qwen-35b
```

*Note: If `LLM_KEY` is not filled yet, the server automatically uses a built-in Smart Demo Engine so you can test the entire workflow without crashes.*

---

## 🎙️ Why Wasn't It "Listening to Your Voice"? (How to Test)

There are two separate layers in voice call systems:

### 1. WebRTC Voice Transmission (Hearing other people)
* **How it works:** When you speak, LiveKit streams your microphone audio to **other participants** in the room.
* **Why you don't hear yourself on a single tab:** WebRTC intentionally mutes your own local voice so your speakers don't create an infinite screeching audio feedback loop.
* **How to test audio transmission:** Open `http://localhost:5173` in **two separate browser windows** (Window 1 as *Rafli*, Window 2 as *Budi*). Speak into the mic in Window 1, and you will hear your voice coming out of the speakers of Window 2!

### 2. Speech-to-Text (AI Transcription)
* **Do you need a LiveKit API key?** **No.** The local SFU server (`bin/livekit-server.exe --dev`) uses the default dev keys (`devkey` and `secret`), which are already built-in.
* **Why words weren't appearing:**
  1. **Microphone Permissions:** Chrome requires explicit permission to access your microphone. If permission was dismissed, the browser blocked audio input.
  2. **Speech Recognition Toggle:** Live speech recognition previously required manual activation.
  3. **Browser STT Service:** Chrome's `webkitSpeechRecognition` routes audio through Google's cloud speech recognizer. If on an internal corporate intranet without external Google Speech access, the browser speech API may encounter network blocks.

### 🛠️ What We Added to Fix and Test This:
1. **Microphone Hardware Diagnostic & Volume Bar:**
   * In the lobby, click **"Test Mic Input"**.
   * Speak into your mic — you will see a real-time **green volume meter (0% to 100%)** showing whether the browser is actually receiving decibels from your microphone!
2. **In-Call Mic Signal Indicator:**
   * Inside the call, there is a real-time mic meter in the header.
3. **Live Hearing Banner:**
   * Words you speak are shown live as you talk: `Hearing your voice: "..."`.
4. **Preset Speech Buttons & Manual Input:**
   * If working in a noisy room or offline, click any of the preset operational phrases (e.g., *"+ Say: Fiber optic link site 4A is fully restored..."*) or type what you want to say.

---

## 🚀 Quick Start (Running on Windows)

### On a Fresh Clone / New PC:
Simply double-click [`start.bat`](file:///c:/Users/rafliaditya.intern/Documents/video%20call/start.bat).
The script is **self-healing** and will automatically:
1. Verify **Node.js** is installed.
2. Create `server/.env` from `server/.env.example` if missing.
3. Automatically download `bin/livekit-server.exe` if not present.
4. Run `npm install` in both `server/` and `client/` if `node_modules` are missing.
5. Launch all 3 services in separate windows!

### Manual Setup via Terminal (Alternative):
If you prefer running commands manually:
```powershell
# 1. Install all dependencies (both server and client)
npm run install:all

# 2. Setup .env and download LiveKit SFU (if needed)
npm run setup

# 3. Launch services:
npm run sfu       # Terminal 1: LiveKit SFU (Port 7880)
npm run server    # Terminal 2: Backend API & Office LLM (Port 3001)
npm run client    # Terminal 3: PC Web Client (Port 5173)
```

Then open **`http://localhost:5173`** in your browser.
