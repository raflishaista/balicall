#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================"
echo "  BaliCall Linux Setup & Environment Preparation"
echo "========================================================"
echo ""

cd "$PROJECT_ROOT"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js is not installed."
    echo "👉 Please install Node 22 or 24 LTS:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VER=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)

if [ "$NODE_MAJOR" -lt 22 ] || ([ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 18 ]); then
    echo "⚠️ Warning: Node.js version $NODE_VER detected. Node >= 22.18 (recommended: Node 24) is required."
fi
echo "✅ Node.js $(node -v) detected."

# 2. Check / Create server/.env
if [ ! -f "server/.env" ]; then
    echo "[*] Creating server/.env from template..."
    if [ -f "server/.env.example" ]; then
        cp "server/.env.example" "server/.env"
        echo "✅ Created server/.env."
    else
        echo "⚠️ server/.env.example not found."
    fi
else
    echo "✅ server/.env already exists."
fi

# 3. Check LiveKit SFU binary for Linux
mkdir -p "$PROJECT_ROOT/bin"
LIVEKIT_BIN="$PROJECT_ROOT/bin/livekit-server"

if command -v livekit-server >/dev/null 2>&1; then
    echo "✅ LiveKit server found in system PATH ($(which livekit-server))."
elif [ -f "$LIVEKIT_BIN" ] && [ -x "$LIVEKIT_BIN" ]; then
    echo "✅ LiveKit server found at $LIVEKIT_BIN."
else
    echo "[*] LiveKit server binary not found. Downloading for Linux..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64) LK_ARCH="amd64" ;;
        aarch64|arm64) LK_ARCH="arm64" ;;
        *)
            echo "❌ Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    LK_VERSION="1.13.7"
    TAR_NAME="livekit_${LK_VERSION}_linux_${LK_ARCH}.tar.gz"
    DOWNLOAD_URL="https://github.com/livekit/livekit/releases/download/v${LK_VERSION}/${TAR_NAME}"

    echo "[*] Downloading $DOWNLOAD_URL ..."
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$DOWNLOAD_URL" -o "$PROJECT_ROOT/bin/$TAR_NAME"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$DOWNLOAD_URL" -O "$PROJECT_ROOT/bin/$TAR_NAME"
    else
        echo "❌ Neither curl nor wget found. Please install curl or wget."
        exit 1
    fi

    echo "[*] Extracting LiveKit binary..."
    tar -xzf "$PROJECT_ROOT/bin/$TAR_NAME" -C "$PROJECT_ROOT/bin" livekit-server
    rm -f "$PROJECT_ROOT/bin/$TAR_NAME"
    chmod +x "$LIVEKIT_BIN"
    echo "✅ LiveKit server v$LK_VERSION installed to bin/livekit-server."
fi

# 4. Install Node dependencies
echo "[*] Installing backend dependencies..."
(cd "$PROJECT_ROOT/server" && npm install)

echo "[*] Installing frontend dependencies..."
(cd "$PROJECT_ROOT/client" && npm install)

# 5. Build client for production serving
echo "[*] Building frontend for production..."
(cd "$PROJECT_ROOT/client" && npm run build)

echo ""
echo "========================================================"
echo "  Setup Complete! You can now run:"
echo "    ./start.sh          (Starts dev servers)"
echo "    ./start.sh prod     (Starts production deployment)"
echo "========================================================"
