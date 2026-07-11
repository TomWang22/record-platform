#!/usr/bin/env bash
# Phase 32H — read-only gateway / edge log tail collector.
set -euo pipefail
OUT="${1:-/tmp/phase32h-targeted-reproduction}"
LOG_DIR="$OUT/logs"
mkdir -p "$LOG_DIR"
STATUS="$LOG_DIR/gateway-capture-status.json"
NS_EDGE="${PHASE32H_EDGE_NS:-ingress-nginx}"
NS_APP="${PHASE32H_APP_NS:-record-platform}"

collect() {
  {
    echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) gateway log snapshot ====="
    kubectl -n "$NS_EDGE" logs -l app=caddy-h3 --tail=500 --timestamps=true 2>&1 || echo "PARTIAL: caddy-h3 logs unavailable"
    kubectl -n "$NS_APP" logs deployment/api-gateway --tail=500 --timestamps=true 2>&1 || echo "PARTIAL: api-gateway logs unavailable"
  } >> "$LOG_DIR/gateway-access-tail.txt"
}

collect
(
  while true; do
    sleep 60
    collect
  done
) &
PID=$!

python3 -c "import json;json.dump({'status':'ACTIVE','pid':$PID,'edge_ns':'$NS_EDGE','app_ns':'$NS_APP'},open('$STATUS','w'),indent=2)"
echo "phase32h gateway log collector pid=$PID"
