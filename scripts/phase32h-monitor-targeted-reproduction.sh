#!/usr/bin/env bash
# Phase 32H — monitor targeted reproduction matrix.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${PHASE32H_MATRIX_ROOT:-/tmp/phase32h-targeted-reproduction}"
INTERVAL="${PHASE32H_MONITOR_INTERVAL_SEC:-300}"

while true; do
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) phase32h summary ====="
  node "$REPO_ROOT/scripts/phase32h-summarize-targeted-reproduction.mjs" --in "$OUT" --json 2>/dev/null || echo "warn: summarize failed"
  echo "===== runner processes ====="
  ps aux | grep -E 'phase32h-targeted-reproduction-runner|phase32h-extreme-watchdog' | grep "$OUT" | grep -v grep || true
  for p in h1 h2 h3; do
    FILE="$OUT/shard-$p/phase32h-matrix.jsonl"
    if [[ -f "$FILE" ]]; then
      ROWS=$(wc -l < "$FILE" | tr -d ' ')
      echo "shard-$p rows=$ROWS/5760"
    fi
  done
  sleep "$INTERVAL"
done
