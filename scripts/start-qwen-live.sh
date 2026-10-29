#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${QWEN_LIVE_ENV_FILE:-$ROOT/server/speech/.env.qwen-live}"
test -f "$CONFIG" || { echo "Missing Qwen live runtime configuration: $CONFIG" >&2; exit 1; }
set -a
# The deployment creates this owner-only file; never source a browser-supplied path.
source "$CONFIG"
set +a
: "${QWEN_PYTHON:?}" "${NEMOTRON_PYTHON:?}" "${QWEN_MODEL_PATH:?}" "${NEMOTRON_MODEL_PATH:?}" "${QWEN_LIVE_STT_SECRET:?}" "${QWEN_DIAR_STREAM_SECRET:?}"
test -x "$QWEN_PYTHON" && test -x "$NEMOTRON_PYTHON"
mkdir -p "$ROOT/logs/qwen-live-build"
cd "$ROOT/server/speech"
start_worker() {
  local name="$1" python="$2" module="$3" port="$4"
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/health" >/dev/null; then
    echo "$name already answers on $port; keeping existing process"
    return
  fi
  if ss -ltn "sport = :$port" | tail -n +2 | grep -q .; then
    echo "Port $port is occupied; inspect it before starting $name" >&2; return 1
  fi
  nohup "$python" -m uvicorn "$module:app" --host 127.0.0.1 --port "$port" --ws-max-size 64000 --ws-max-queue 16 >"$ROOT/logs/qwen-live-build/$name.log" 2>&1 < /dev/null &
  echo "$!" >"$ROOT/logs/qwen-live-build/$name.pid"
  echo "$name launched on loopback $port (PID $!)"
}
start_worker nemotron "$NEMOTRON_PYTHON" nemotron_live_app 8009
start_worker qwen "$QWEN_PYTHON" qwen_live_app 8008
echo "Loading models; verify both /health endpoints before enabling the UI model."
