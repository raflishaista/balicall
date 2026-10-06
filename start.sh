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
    echo "[1/2] Starting LiveKit SFU Server on Port 7880..."
    if [ -f "livekit.yaml" ]; then
        $LIVEKIT_CMD --config livekit.yaml --dev &
    else
        $LIVEKIT_CMD --dev &
    fi
    sleep 2

    # Launch Node Backend (serves API + client static assets)
    echo "[2/2] Starting Backend Server on Port 3001..."
    (cd "$PROJECT_ROOT/server" && NODE_ENV=production node index.js) &

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

    # Launch LiveKit SFU
    echo "[1/3] Starting LiveKit SFU Server on Port 7880..."
    if [ -f "livekit.yaml" ]; then
        $LIVEKIT_CMD --config livekit.yaml --dev &
    else
        $LIVEKIT_CMD --dev &
    fi
    sleep 2

    # Launch Backend Server
    echo "[2/3] Starting Backend API on Port 3001..."
    (cd "$PROJECT_ROOT/server" && npm run dev) &
    sleep 2

    # Launch Vite Client
    echo "[3/3] Starting Vite Dev Client on Port 5187..."
    (cd "$PROJECT_ROOT/client" && npm run dev) &

    echo ""
    echo "========================================================"
    echo "  ✅ All services launched!"
    echo "  Web Client:  http://127.0.0.1:5187"
    echo "  Backend API: http://127.0.0.1:3001"
    echo "  Press Ctrl+C to stop all services."
    echo "========================================================"
fi

# Wait for background jobs
wait
