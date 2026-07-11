#!/usr/bin/env bash
# Phase 32H — read-only application log tail collector (detached; non-blocking).
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
LOG_DIR="$OUT/logs"
mkdir -p "$LOG_DIR"
STATUS="$LOG_DIR/application-capture-status.json"
NS="${PHASE32H_APP_NS:-record-platform}"

collect() {
  {
    echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) application log snapshot ====="
    kubectl -n "$NS" logs deployment/python-ai-service --tail=500 --timestamps=true 2>&1 || echo "PARTIAL: python-ai-service logs unavailable"
    kubectl -n "$NS" get events --sort-by=.lastTimestamp 2>&1 | tail -80 || echo "PARTIAL: events unavailable"
    kubectl -n "$NS" get pods -l app=python-ai-service -o wide 2>&1 || true
  } >>"$LOG_DIR/application-log-tail.txt"
}

(
  collect
  while true; do
    sleep 60
    collect
  done
) >>"$LOG_DIR/application-collector.log" 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

python3 -c "import json;json.dump({'status':'ACTIVE','pid':$PID,'namespace':'$NS'},open('$STATUS','w'),indent=2)"
echo "phase32h application log collector pid=$PID"
