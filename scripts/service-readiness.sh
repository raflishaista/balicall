#!/usr/bin/env bash

balicall_start_lock() {
    if ! command -v flock >/dev/null 2>&1; then
        echo "Startup requires flock." >&2
        return 1
    fi
    exec 9>"${XDG_RUNTIME_DIR:-/tmp}/balicall-start-${UID}.lock"
    flock -w 30 9 || { echo "Another BaliCall startup is running." >&2; return 1; }
}

balicall_port_in_use() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        [[ -n "$(ss -H -ltn "sport = :$port")" ]]
    else
        ( : > "/dev/tcp/127.0.0.1/$port" ) 2>/dev/null
    fi
}

balicall_health() {
    local port="$1" kind="$2" endpoint=/health
    if [[ "$kind" == api ]]; then
        local response status body
        response="$(curl -sS --max-time 3 -w '\n%{http_code}' "http://127.0.0.1:$port/api/ready" 2>/dev/null)" || return 1
        status="${response##*$'\n'}"
        if [[ "$status" == 200 ]]; then
            body="${response%$'\n'*}"
            node -e 'try { const d = JSON.parse(process.argv[1]); process.exitCode = d.status === "ready" && d.service === "balicall-api" ? 0 : 1; } catch { process.exitCode = 1; }' "$body"
            return $?
        fi
        # Older authenticated deployments can reject unknown API paths before routing.
        [[ "$status" == 404 || "$status" == 401 ]] || return 1
        endpoint=/api/health
    fi
    curl -fsS --max-time 3 "http://127.0.0.1:$port$endpoint" 2>/dev/null |
        node -e '
          let input = "";
          process.stdin.on("data", chunk => input += chunk);
          process.stdin.on("end", () => {
            try {
              const health = JSON.parse(input);
              const kind = process.argv[1];
              const model = String(health.model ?? health.backend ?? "").toLowerCase();
              const ready = health.ready === true || health.status === "ok";
              const matches = kind === "api"
                ? health.status === "ok" && typeof health.livekitStatus === "string"
                : kind === "nemotron"
                  ? health.ready === true && (model.includes("nemotron") || health.diarization === true)
                  : kind === "whisper"
                    ? (Array.isArray(health.recordingModels) && health.recordingModels.length > 0)
                      || (ready && /whisper|^small$/.test(model))
                    : ready && model.includes(kind);
              process.exitCode = matches ? 0 : 1;
            } catch { process.exitCode = 1; }
          });
        ' "$kind"
}

balicall_wait_ready() {
    local port="$1" kind="$2" attempts="${3:-20}" pid="${4:-}"
    local i
    for ((i=0; i<attempts; i++)); do
        if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then break; fi
        if balicall_health "$port" "$kind"; then return 0; fi
        sleep 1
    done
    echo "Port $port is not serving healthy BaliCall $kind. Existing listeners are preserved." >&2
    return 1
}

balicall_batch_lock() {
    exec 8>"${XDG_RUNTIME_DIR:-/tmp}/balicall-batch-start-${UID}.lock"
    flock -w 30 8 || { echo "Another BaliCall batch startup is running." >&2; return 1; }
}
balicall_compose_workers() {
    local project_root="$1"
    shift
    local worker port
    local pending=()
    balicall_batch_lock || return 1
    for worker in "$@"; do
        case "$worker" in
            whisper) port=8001 ;;
            qwen) port=8006 ;;
            nemotron) port=8007 ;;
            *) return 1 ;;
        esac
        if balicall_port_in_use "$port"; then
            balicall_wait_ready "$port" "$worker" 8 || return 1
        else
            pending+=("$worker")
        fi
    done
    if (( ${#pending[@]} )); then
        docker compose --project-directory "$project_root" -p balicall -f "$project_root/docker-compose.workers.yml" up -d --no-recreate --no-deps "${pending[@]}" || return 1
        for worker in "${pending[@]}"; do
            case "$worker" in
                whisper) port=8001 ;;
                qwen) port=8006 ;;
                nemotron) port=8007 ;;
            esac
            balicall_wait_ready "$port" "$worker" 120 || return 1
        done
    fi
    flock -u 8
}
