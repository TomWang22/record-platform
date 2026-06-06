#!/usr/bin/env bash
# List PIDs matching pipeline/test/k6 patterns. No kill.
# Use: ./scripts/list-idle-pipeline-processes.sh [outfile]
# Default: prints to stdout. If outfile given, also appends there.
set -euo pipefail
OUT="${1:-}"
log() { [[ -n "$OUT" ]] && echo "$*" >> "$OUT"; echo "$*"; }

log "=== Pipeline-related processes $(date +%Y-%m-%dT%H:%M:%S) ==="
for pat in run-full-pipeline run-preflight-scale run-all-test-suites test-microservices-http2 enhanced-adversarial rotation-suite test-packet-capture "k6 run" k6-chaos; do
  for p in $(pgrep -f "$pat" 2>/dev/null || true); do
    [[ -z "$p" ]] && continue
    log "  $(ps -p "$p" -o pid=,ppid=,etime=,args= 2>/dev/null || echo "? $p")"
  done
done
log "=== end ==="
