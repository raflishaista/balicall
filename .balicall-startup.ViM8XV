#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-dev}"

echo "========================================================"
echo "  Bali Tower Voice Call, Video & AI Workspace (Linux)"
echo "========================================================"
echo ""

# 1. Run setup if dependencies or LiveKit binary are missing
if [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ] || ([ ! -f "bin/livekit-server" ] && ! command -v livekit-server >/dev/null 2>&1); then
    echo "[*] Initial setup required. Running setup.sh..."
    bash "$PROJECT_ROOT/scripts/setup.sh"
fi

# Ensure server/.env exists
if [ ! -f "server/.env" ] && [ -f "server/.env.example" ]; then
    cp "server/.env.example" "server/.env"
fi

# Locate LiveKit server
if command -v livekit-server >/dev/null 2>&1; then
    LIVEKIT_CMD="livekit-server"
elif [ -f "$PROJECT_ROOT/bin/livekit-server" ]; then
    LIVEKIT_CMD="$PROJECT_ROOT/bin/livekit-server"
else
    echo "❌ livekit-server not found. Run ./scripts/setup.sh first."
    exit 1
fi

# Graceful cleanup on exit or Ctrl+C
cleanup() {
    echo ""
    echo "[*] Stopping all BaliCall processes..."
    for pidfile in "$PROJECT_ROOT"/logs/qwen-live-build/*.pid "$PROJECT_ROOT"/logs/qwen-batch/*.pid; do
        if [ -f "$pidfile" ]; then
            kill $(cat "$pidfile") 2>/dev/null || true
            rm -f "$pidfile"
        fi
    done
    kill $(jobs -p) 2>/dev/null || true
    wait $(jobs -p) 2>/dev/null || true
    echo "✅ All services stopped."
    exit 0
}
trap cleanup EXIT INT TERM

if [ "$MODE" = "prod" ] || [ "$MODE" = "production" ] || [ "$MODE" = "deploy" ]; then
    echo "========================================================"
    echo "  Mode: PRODUCTION (Port 3001 serves API & Web Client)"
    echo "========================================================"

    # Ensure client is built
    if [ ! -f "client/dist/index.html" ]; then
        echo "[*] Building frontend client for production..."
        (cd "$PROJECT_ROOT/client" && npm run build)
    fi

    # Launch LiveKit SFU
    echo "[1/3] Starting LiveKit SFU Server on Port 7880..."
    if [ -f "livekit.yaml" ]; then
        $LIVEKIT_CMD --config livekit.yaml --dev &
    else
        $LIVEKIT_CMD --dev &
    fi
    sleep 2

    # Launch SEA Live STT (if enabled)
    if (echo > /dev/tcp/127.0.0.1/8010) 2>/dev/null; then
        echo "[2/3] Port 8010 is already active [SEA Live STT]."
    elif [ -f "$PROJECT_ROOT/server/speech/start_sea_live.sh" ] && grep -E -q '^\s*SEA_LIVE_PILOT_ENABLED\s*=\s*true' "$PROJECT_ROOT/server/.env" 2>/dev/null; then
        if [ -r "${SEA_ASR_ROOT:-/var/tmp/jds3-sea-asr}/sea-worker.env" ]; then
            echo "[2/3] Starting SEA Live STT Worker on Port 8010..."
            bash "$PROJECT_ROOT/server/speech/start_sea_live.sh" &
            sleep 2
        fi
    fi

    # Launch Node Backend (serves API + client static assets)
    if (echo > /dev/tcp/127.0.0.1/3001) 2>/dev/null; then
        if curl -sf -m 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
            echo "[3/3] Port 3001 is already active and healthy [Backend Server]."
        else
            echo "[3/3] Port 3001 is busy but unresponsive. Freeing port..."
            fuser -k 3001/tcp 2>/dev/null || true
            sleep 1
            echo "[3/3] Starting Backend Server on Port 3001..."
            (cd "$PROJECT_ROOT/server" && NODE_ENV=production node index.js) &
        fi
    else
        echo "[3/3] Starting Backend Server on Port 3001..."
        (cd "$PROJECT_ROOT/server" && NODE_ENV=production node index.js) &
    fi

    echo ""
    echo "========================================================"
    echo "  ✅ All production services running!"
    echo "  Web Workspace: http://127.0.0.1:3001"
    echo "  LiveKit SFU:   ws://127.0.0.1:7880"
    echo "  Press Ctrl+C to stop all services."
    echo "========================================================"

else
    echo "========================================================"
    echo "  Mode: DEVELOPMENT (Vite Dev Server + Express API)"
    echo "========================================================"

    # [1/4] LiveKit SFU (dilewati kalau port 7880 sudah dipakai, mis. LiveKit Docker)
    if (echo > /dev/tcp/127.0.0.1/7880) 2>/dev/null; then
        echo "[1/4] Port 7880 sudah dipakai (LiveKit Docker). Dilewati."
    else
        echo "[1/4] Starting LiveKit SFU Server on Port 7880..."
        if [ -f "livekit.yaml" ]; then
            $LIVEKIT_CMD --config livekit.yaml --dev &
        else
            $LIVEKIT_CMD --dev &
        fi
        sleep 2
    fi

    # [2/4] Worker STT (Docker): Whisper & Qwen
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        echo "[2/4] Starting STT workers (Docker)..."
        docker compose -f "$PROJECT_ROOT/docker-compose.workers.yml" up -d
        echo "      Menunggu Whisper siap (maks 6 menit, unduhan model pertama bisa lama)..."
        for i in $(seq 1 120); do
            if curl -sf http://127.0.0.1:8001/health >/dev/null 2>&1; then
                echo "      Whisper siap."
                break
            fi
            sleep 3
        done
    else
        echo "[2/4] ⚠️  Docker tidak berjalan; menjalankan worker lokal jika tersedia..."
        if [ -f "$PROJECT_ROOT/scripts/start-qwen-batch.sh" ] && grep -E -q '^\s*QWEN_BATCH_ENABLED\s*=\s*true' "$PROJECT_ROOT/server/.env" 2>/dev/null; then
            bash "$PROJECT_ROOT/scripts/start-qwen-batch.sh" || true
        fi
        if [ -f "$PROJECT_ROOT/scripts/start-qwen-live.sh" ] && grep -E -q '^\s*QWEN_LIVE_STT_URL\s*=' "$PROJECT_ROOT/server/.env" 2>/dev/null; then
            bash "$PROJECT_ROOT/scripts/start-qwen-live.sh" || true
        fi
    fi

    # [3/5] SEA Live STT Worker (Port 8010)
    if (echo > /dev/tcp/127.0.0.1/8010) 2>/dev/null; then
        echo "[3/5] Port 8010 is already active [SEA Live STT]."
    elif [ -f "$PROJECT_ROOT/server/speech/start_sea_live.sh" ] && grep -E -q '^\s*SEA_LIVE_PILOT_ENABLED\s*=\s*true' "$PROJECT_ROOT/server/.env" 2>/dev/null; then
        if [ -r "${SEA_ASR_ROOT:-/var/tmp/jds3-sea-asr}/sea-worker.env" ]; then
            echo "[3/5] Starting SEA Live STT Worker on Port 8010..."
            bash "$PROJECT_ROOT/server/speech/start_sea_live.sh" &
            for i in $(seq 1 10); do
                if curl -sf http://127.0.0.1:8010/health >/dev/null 2>&1; then
                    echo "      SEA Live STT siap."
                    break
                fi
                sleep 1
            done
        else
            echo "[3/5] ⚠️  File secret SEA (/var/tmp/jds3-sea-asr/sea-worker.env) tidak ditemukan; SEA dilewati."
        fi
    else
        echo "[3/5] SEA Live STT dilewati (SEA_LIVE_PILOT_ENABLED belum diaktifkan di server/.env)."
    fi

    # [4/5] Backend
    if (echo > /dev/tcp/127.0.0.1/3001) 2>/dev/null; then
        if curl -sf -m 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
            echo "[4/5] Port 3001 is already active and healthy [Backend Server]."
        else
            echo "[4/5] Port 3001 is busy but unresponsive. Freeing port..."
            fuser -k 3001/tcp 2>/dev/null || true
            sleep 1
            echo "[4/5] Starting Backend API on Port 3001..."
            (cd "$PROJECT_ROOT/server" && npm run dev) &
            sleep 2
        fi
    else
        echo "[4/5] Starting Backend API on Port 3001..."
        (cd "$PROJECT_ROOT/server" && npm run dev) &
        sleep 2
    fi

    # [5/5] Vite client
    if (echo > /dev/tcp/127.0.0.1/5187) 2>/dev/null; then
        if curl -sf -m 2 -I http://127.0.0.1:5187/ >/dev/null 2>&1; then
            echo "[5/5] Port 5187 is already active [Vite Dev Client]."
        else
            echo "[5/5] Port 5187 is busy but unresponsive. Freeing port..."
            fuser -k 5187/tcp 2>/dev/null || true
            sleep 1
            echo "[5/5] Starting Vite Dev Client on Port 5187..."
            (cd "$PROJECT_ROOT/client" && npm run dev) &
        fi
    else
        echo "[5/5] Starting Vite Dev Client on Port 5187..."
        (cd "$PROJECT_ROOT/client" && npm run dev) &
    fi

    echo ""
    echo "========================================================"
    echo "  ✅ All services launched!"
    echo "  Web Client:  http://127.0.0.1:5187"
    echo "  Backend API: http://127.0.0.1:3001"
    (echo > /dev/tcp/127.0.0.1/8010) 2>/dev/null && echo "  SEA Live:    http://127.0.0.1:8010"
    echo "  Press Ctrl+C to stop Node/Vite (Docker worker tetap jalan)."
    echo "  Stop worker: docker compose -f docker-compose.workers.yml down"
    echo "========================================================"
fi

# Wait for background jobs
wait
