#!/usr/bin/env bash
set -euo pipefail

SEA_ASR_ROOT="${SEA_ASR_ROOT:-/var/tmp/jds3-sea-asr}"
if [[ ! -r "$SEA_ASR_ROOT/sea-worker.env" ]]; then
  echo 'SEA worker secret file is missing or unreadable' >&2
  exit 1
fi
set -a
# This dedicated file contains only SEA_LIVE_STT_SECRET.
. "$SEA_ASR_ROOT/sea-worker.env"
if [[ -r "$SEA_ASR_ROOT/sea-diarization.env" ]]; then
  . "$SEA_ASR_ROOT/sea-diarization.env"
fi
set +a
export HF_HOME="$SEA_ASR_ROOT/hf-cache"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export CUDA_VISIBLE_DEVICES=
export SEA_CPU_THREADS="${SEA_CPU_THREADS:-4}"
export SEA_MODEL_PATH="$HF_HOME/hub/models--PixelML--sea-asr-id/snapshots/90567734a716694f47982b00cfec80b454b7470a"
exec "$SEA_ASR_ROOT/venv/bin/python" -m uvicorn sea_live_app:app \
  --app-dir "$SEA_ASR_ROOT/service" --host 127.0.0.1 --port 8010 \
  --ws-max-size 65536 --ws-max-queue 32 --log-level warning --no-access-log
