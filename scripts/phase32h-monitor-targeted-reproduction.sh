#!/usr/bin/env bash
# Phase 32H — monitor targeted reproduction matrix.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${PHASE32H_MATRIX_ROOT:-/tmp/phase32h-targeted-reproduction}"
INTERVAL="${PHASE32H_MONITOR_INTERVAL_SEC:-300}"
SUMMARY_JSON="$OUT/current-summary.json"

while true; do
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) phase32h summary ====="
  if node "$REPO_ROOT/scripts/phase32h-summarize-targeted-reproduction.mjs" --in "$OUT" --json >"$SUMMARY_JSON" 2>/dev/null; then
    node "$REPO_ROOT/scripts/phase32h-parse-summary-json.mjs" --file "$SUMMARY_JSON" --human 2>/dev/null || cat "$SUMMARY_JSON"
  else
    echo "warn: summarize failed" >&2
  fi
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
