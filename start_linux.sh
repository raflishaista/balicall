#!/usr/bin/env bash

# ========================================================
#   Bali Tower Voice Call, Video & AI Workspace (Linux)
# ========================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"
source "$PROJECT_ROOT/scripts/service-readiness.sh"
balicall_start_lock || exit 1
if balicall_port_in_use 3001; then
    balicall_wait_ready 3001 api 8 || exit 1
fi

# Enable job control so each service gets its own process group for clean shutdown
set -m

MODE="${1:-dev}"

echo "========================================================"
echo "  Bali Tower Voice Call, Video & AI Workspace (Linux)"
echo "========================================================"
echo ""


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
if [ -f "$PROJECT_ROOT/bin/livekit-server" ]; then
    chmod +x "$PROJECT_ROOT/bin/livekit-server" 2>/dev/null || true
fi

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
    local status=$?
    trap - EXIT INT TERM
    echo ""
    echo "[*] Stopping all BaliCall processes..."
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
    exit "$status"
}
trap cleanup EXIT INT TERM

# Start Service 1: LiveKit SFU (Port 7880)
if balicall_port_in_use 7880; then
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
if balicall_port_in_use 8001; then
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
if balicall_port_in_use 8010; then
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

# Start Optional Service: Qwen Live STT Workers (Port 8008 & 8009)
if balicall_port_in_use 8008; then
    echo "[*] Port 8008 is already active [Qwen Live STT]."
elif [ -f "scripts/start-qwen-live.sh" ] && grep -E -q '^\s*QWEN_LIVE_STT_URL\s*=' "server/.env" 2>/dev/null; then
    echo "[*] Starting Qwen Live STT Workers on Ports 8008 & 8009..."
    bash scripts/start-qwen-live.sh || true
fi

# Start Optional Service: Qwen + Nemotron Batch Workers (Port 8006 & 8007)
if balicall_port_in_use 8006; then
    balicall_wait_ready 8006 qwen 8 || exit 1
fi
if balicall_port_in_use 8007; then
    balicall_wait_ready 8007 nemotron 8 || exit 1
fi
if ! balicall_port_in_use 8006 || ! balicall_port_in_use 8007; then
    if [ -f "scripts/start-qwen-batch.sh" ] && grep -E -q '^\s*QWEN_BATCH_ENABLED\s*=\s*true' "server/.env" 2>/dev/null; then
        if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
            balicall_compose_workers "$PROJECT_ROOT" qwen nemotron || exit 1
        else
            bash scripts/start-qwen-batch.sh 9>&- || exit 1
        fi
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

    # Backend API
    if balicall_port_in_use 3001; then
        balicall_wait_ready 3001 api 8 || exit 1
        echo "Reusing healthy BaliCall API on port 3001."
    else
        (cd "$PROJECT_ROOT/server" && NODE_ENV=production node index.js) < /dev/null 9>&- &
        balicall_api_pid=$!
        PIDS+=("$balicall_api_pid")
        balicall_wait_ready 3001 api 30 "$balicall_api_pid" || exit 1
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

    # Backend API
    if balicall_port_in_use 3001; then
        balicall_wait_ready 3001 api 8 || exit 1
        echo "Reusing healthy BaliCall API on port 3001."
    else
        (cd "$PROJECT_ROOT/server" && npm run dev) < /dev/null 9>&- &
        balicall_api_pid=$!
        PIDS+=("$balicall_api_pid")
        balicall_wait_ready 3001 api 30 "$balicall_api_pid" || exit 1
    fi

    # Start Service 4: Vite Dev Client
    if balicall_port_in_use 5187; then
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
flock -u 9
wait
