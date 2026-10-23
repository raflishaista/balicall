#!/usr/bin/env bash

# ========================================================
#   Bali Tower Voice Call, Video & AI Workspace (Linux)
# ========================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-dev}"

echo "========================================================"
echo "  Bali Tower Voice Call, Video & AI Workspace (Linux)"
echo "========================================================"
echo ""

# Helper: check if a TCP port is in use
is_port_in_use() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -tuln 2>/dev/null | grep -q ":$port "
    elif command -v netstat >/dev/null 2>&1; then
        netstat -tuln 2>/dev/null | grep -q ":$port "
    elif command -v lsof >/dev/null 2>&1; then
        lsof -i ":$port" >/dev/null 2>&1
    else
        python3 -c "import socket; s = socket.socket(); s.settimeout(0.3); res = s.connect_ex(('127.0.0.1', $port)); s.close(); exit(0 if res == 0 else 1)" 2>/dev/null
    fi
}

# 1. Check / Create server/.env
if [ ! -f "server/.env" ] && [ -f "server/.env.example" ]; then
    echo "[*] Creating server/.env from template..."
    cp "server/.env.example" "server/.env"
fi

# 2. Check dependencies & LiveKit SFU binary
if [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ] || ([ ! -f "bin/livekit-server" ] && ! command -v livekit-server >/dev/null 2>&1); then
    echo "[*] Initial setup required. Running scripts/setup.sh..."
    bash "$PROJECT_ROOT/scripts/setup.sh"
fi

# Locate LiveKit server binary
if command -v livekit-server >/dev/null 2>&1; then
    LIVEKIT_CMD="livekit-server"
elif [ -f "$PROJECT_ROOT/bin/livekit-server" ]; then
    LIVEKIT_CMD="$PROJECT_ROOT/bin/livekit-server"
else
    echo "❌ livekit-server binary not found in PATH or bin/."
    echo "👉 Run ./scripts/setup.sh to download it."
    exit 1
fi

# Locate Python environment for Whisper STT (optional / local)
WHISPER_PYTHON=""
if [ -x "$PROJECT_ROOT/server/speech/.venv/bin/python" ]; then
    WHISPER_PYTHON="$PROJECT_ROOT/server/speech/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1 && python3 -c "import faster_whisper" >/dev/null 2>&1; then
    WHISPER_PYTHON="python3"
fi

# Track launched PIDs for clean termination
PIDS=()

cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "[*] Stopping all BaliCall services..."
    for pid in "${PIDS[@]}"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            # Kill process group or process
            kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    sleep 1
    for pid in "${PIDS[@]}"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
        fi
    done
    echo "✅ All BaliCall services stopped."
    exit 0
}
trap cleanup EXIT INT TERM

# Start Service 1: LiveKit SFU (Port 7880)
if is_port_in_use 7880; then
    echo "[1/4] Port 7880 is already active [LiveKit SFU]."
else
    echo "[1/4] Starting LiveKit SFU Server on Port 7880..."
    if [ -f "livekit.yaml" ]; then
        "$LIVEKIT_CMD" --config livekit.yaml --dev < /dev/null &
    else
        "$LIVEKIT_CMD" --dev < /dev/null &
    fi
    PIDS+=($!)
    sleep 2
fi

# Start Service 2: Whisper STT & Diarization Server (Port 8001)
if is_port_in_use 8001; then
    echo "[2/4] Port 8001 is already active [Whisper STT Server]."
elif [ -n "$WHISPER_PYTHON" ] && [ -f "scripts/whisper_server.py" ]; then
    echo "[2/4] Starting Local Whisper STT + Diarization on Port 8001..."
    DIAR_ARGS=()
    if [ -d "models/nemotron3-diarization" ]; then
        DIAR_ARGS=(--diarization-model "models/nemotron3-diarization")
    fi
    "$WHISPER_PYTHON" scripts/whisper_server.py --model "small" "${DIAR_ARGS[@]}" --host 127.0.0.1 --port 8001 < /dev/null &
    PIDS+=($!)
    sleep 2
else
    echo "[2/4] Whisper Python runtime not configured; skipping local STT worker (Port 8001)."
    echo "      (Set up server/speech/.venv or rely on browser/cloud STT)"
fi

# Start Optional Service: SEA Live STT Worker (Port 8010)
if is_port_in_use 8010; then
    echo "[*] Port 8010 is already active [SEA Live STT]."
elif [ -f "server/speech/start_sea_live.sh" ] && grep -E -q '^\s*SEA_LIVE_PILOT_ENABLED\s*=\s*true' "server/.env" 2>/dev/null; then
    if [ -r "${SEA_ASR_ROOT:-/var/tmp/jds3-sea-asr}/sea-worker.env" ]; then
        echo "[*] Starting SEA Live STT on Port 8010..."
        bash server/speech/start_sea_live.sh < /dev/null &
        PIDS+=($!)
        sleep 2
    else
        echo "[*] ⚠️  File secret SEA (/var/tmp/jds3-sea-asr/sea-worker.env) tidak ditemukan; SEA dilewati."
    fi
fi

if [ "$MODE" = "prod" ] || [ "$MODE" = "production" ] || [ "$MODE" = "deploy" ]; then
    echo "========================================================"
    echo "  Mode: PRODUCTION (Port 3001 serves API & Web Client)"
    echo "========================================================"

    # Ensure frontend client is built
    if [ ! -f "client/dist/index.html" ]; then
        echo "[*] Building frontend client for production..."
        (cd "$PROJECT_ROOT/client" && npm run build)
    fi

    # Start Service 3: Node Backend in Production
    if is_port_in_use 3001; then
        echo "[3/4] Port 3001 is already active [Backend Server]."
    else
        echo "[3/4] Starting Backend Server on Port 3001..."
        (cd "$PROJECT_ROOT/server" && NODE_ENV=production node index.js) < /dev/null &
        PIDS+=($!)
    fi

    echo ""
    echo "========================================================"
    echo "  ✅ BaliCall production services running!"
    echo "  Web Workspace: http://127.0.0.1:3001"
    echo "  LiveKit SFU:   ws://127.0.0.1:7880"
    [ -n "$WHISPER_PYTHON" ] && echo "  Whisper STT:   http://127.0.0.1:8001"
    echo "  Press Ctrl+C to stop all services."
    echo "========================================================"

else
    echo "========================================================"
    echo "  Mode: DEVELOPMENT (Vite Dev Client + Express API)"
    echo "========================================================"

    # Start Service 3: Node Backend in Development
    if is_port_in_use 3001; then
        echo "[3/4] Port 3001 is already active [Backend API]."
    else
        echo "[3/4] Starting Backend API on Port 3001..."
        (cd "$PROJECT_ROOT/server" && npm run dev) < /dev/null &
        PIDS+=($!)
        sleep 2
    fi

    # Start Service 4: Vite Dev Client
    if is_port_in_use 5187; then
        echo "[4/4] Port 5187 is already active [Vite Dev Client]."
    else
        echo "[4/4] Starting Vite Dev Client on Port 5187..."
        # Detach stdin (< /dev/null) to prevent SIGTTIN signal from suspending Vite in background
        (cd "$PROJECT_ROOT/client" && npm run dev) < /dev/null &
        PIDS+=($!)
    fi

    echo ""
    echo "========================================================"
    echo "  ✅ BaliCall services launched!"
    echo "  Web Client:  http://127.0.0.1:5187"
    echo "  Backend API: http://127.0.0.1:3001"
    echo "  LiveKit SFU: ws://127.0.0.1:7880"
    [ -n "$WHISPER_PYTHON" ] && echo "  Whisper STT: http://127.0.0.1:8001"
    echo "  Press Ctrl+C to stop all services."
    echo "========================================================"
fi

# Keep script running and wait for background jobs
wait

