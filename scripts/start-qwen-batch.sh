#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/service-readiness.sh"
balicall_batch_lock
if balicall_port_in_use 8007; then balicall_wait_ready 8007 nemotron 8; fi
if balicall_port_in_use 8006; then balicall_wait_ready 8006 qwen 8; fi
if balicall_port_in_use 8007 && balicall_port_in_use 8006; then
    echo "Reusing healthy Qwen and Nemotron workers."
    exit 0
fi
# The local Python fallback must not take ports reserved by the Compose project.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    for worker in qwen nemotron; do
        container=$(docker ps -aq --filter label=com.docker.compose.project=balicall --filter "label=com.docker.compose.service=$worker")
        if [[ -n "$container" ]]; then
            echo "BaliCall batch workers are managed by Docker Compose. Start the requested service through Compose." >&2
            exit 1
        fi
    done
fi
SERVER_ENV="${SERVER_ENV:-$ROOT/server/.env}"
LOG_DIR="$ROOT/logs/qwen-batch"
mkdir -p "$LOG_DIR"

# Read QWEN_STT_API_KEY from server/.env if available
QWEN_STT_KEY=""
if [ -f "$SERVER_ENV" ]; then
    QWEN_STT_KEY="$(grep -E '^\s*QWEN_STT_API_KEY\s*=' "$SERVER_ENV" | head -n1 | cut -d'=' -f2- | tr -d ' "\r\n' || true)"
fi

# Locate Python venvs
NEMOTRON_PYTHON="/var/tmp/balicall-qwen-live-jds3-20261020/nemotron-venv/bin/python"
QWEN_PYTHON="/var/tmp/balicall-qwen-live-jds3-20261020/qwen-venv/bin/python"
NEMOTRON_MODEL="/var/tmp/balicall-qwen-live-jds3-20261020/nemotron-model"
if [ ! -d "$NEMOTRON_MODEL" ] && [ -d "$ROOT/models/nemotron3-diarization" ]; then
    NEMOTRON_MODEL="$ROOT/models/nemotron3-diarization"
fi
QWEN_MODEL="/var/tmp/balicall-qwen-live-jds3-20261020/qwen-model"

test -x "$NEMOTRON_PYTHON" || { echo "Nemotron Python runtime not found at $NEMOTRON_PYTHON" >&2; exit 1; }
test -x "$QWEN_PYTHON" || { echo "Qwen Python runtime not found at $QWEN_PYTHON" >&2; exit 1; }

cd "$ROOT/server/speech"

# 1. Start Nemotron Batch Worker on Port 8007
if balicall_port_in_use 8007; then
    balicall_wait_ready 8007 nemotron 8
    echo "nemotron-batch already active on port 8007"
else
    echo "Starting Nemotron Batch Worker on Port 8007..."
    (
        export NEMOTRON_MODEL_PATH="$NEMOTRON_MODEL"
        export SPEECH_DEVICE=cpu
        export NEMOTRON_CPU_THREADS="${NEMOTRON_CPU_THREADS:-2}"
        export OMP_NUM_THREADS=2
        export MKL_NUM_THREADS=2
        export OPENBLAS_NUM_THREADS=2
        export CUDA_VISIBLE_DEVICES=
        nohup "$NEMOTRON_PYTHON" -m uvicorn nemotron_app:app \
            --host 127.0.0.1 --port 8007 --limit-concurrency 4 --no-access-log \
            >"$LOG_DIR/nemotron-batch.log" 2>&1 < /dev/null 8>&- &
        echo "$!" > "$LOG_DIR/nemotron-batch.pid"
        echo "Nemotron Batch launched on loopback 8007 (PID $!)"
    )
fi

balicall_wait_ready 8007 nemotron 10

# 2. Start Qwen Batch Worker on Port 8006
if balicall_port_in_use 8006; then
    balicall_wait_ready 8006 qwen 8
    echo "qwen-batch already active on port 8006"
else
    echo "Starting Qwen Batch Worker on Port 8006..."
    (
        export QWEN_MODEL_PATH="$QWEN_MODEL"
        export SPEECH_DEVICE=cpu
        export QWEN_CPU_THREADS="${QWEN_CPU_THREADS:-2}"
        export QWEN_DTYPE=float32
        export OMP_NUM_THREADS=2
        export MKL_NUM_THREADS=2
        export OPENBLAS_NUM_THREADS=2
        export CUDA_VISIBLE_DEVICES=
        export QWEN_LOCAL_FILES_ONLY=true
        export HF_HUB_OFFLINE=1
        export SPEECH_API_KEY="$QWEN_STT_KEY"
        export QWEN_BATCH_NEMOTRON_URL="http://127.0.0.1:8007"
        nohup "$QWEN_PYTHON" -m uvicorn qwen_app:app \
            --host 127.0.0.1 --port 8006 --limit-concurrency 4 --no-access-log \
            >"$LOG_DIR/qwen-batch.log" 2>&1 < /dev/null 8>&- &
        echo "$!" > "$LOG_DIR/qwen-batch.pid"
        echo "Qwen Batch launched on loopback 8006 (PID $!)"
    )
fi

balicall_wait_ready 8006 qwen 15
