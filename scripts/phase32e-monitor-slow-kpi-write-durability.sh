#!/usr/bin/env bash
# Phase 32E — monitor one mode of slow KPI write durability micro-soak.
set -uo pipefail
REPO=/Users/tom/record-platform
ROOT="${1:-/tmp/phase32e-slow-kpi-write-durability}"
MODE="${2:-baseline}"
OUT="$ROOT/$MODE"
PER_SHARD=432
TOTAL=1296
export T20_EVAL_RAG_PAUSE_SEC=0.15

exec >>"$OUT/phase32e-monitor.log" 2>&1

source_mode_env() {
  case "$MODE" in
    baseline)
      export AI_KPI_TEST_INJECT_WRITE_DELAY_MS=0
      export AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE=0
      export AI_KPI_TEST_INJECT_TIMEOUT_MS=0
      export AI_KPI_TEST_INJECT_DB_UNAVAILABLE=0
      ;;
    slow_write)
      export AI_KPI_TEST_INJECT_WRITE_DELAY_MS=500
      export AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE=0
      export AI_KPI_TEST_INJECT_TIMEOUT_MS=0
      export AI_KPI_TEST_INJECT_DB_UNAVAILABLE=0
      ;;
    failing_write)
      export AI_KPI_TEST_INJECT_WRITE_DELAY_MS=0
      export AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE=1
      export AI_KPI_TEST_INJECT_TIMEOUT_MS=0
      export AI_KPI_TEST_INJECT_DB_UNAVAILABLE=0
      ;;
  esac
}

source_mode_env

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase32e mode=$MODE ====="
  total=0
  for p in h1 h2 h3; do
    c=$(wc -l <"$OUT/shard-$p/phase31-matrix.jsonl" 2>/dev/null || echo 0)
    total=$((total + c))
    echo "shard-$p=$c/$PER_SHARD"
  done
  echo "total=$total/$TOTAL"

  for p in h1 h2 h3; do
    if ! pgrep -fl "phase31-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      count="$(wc -l <"$OUT/shard-$p/phase31-matrix.jsonl" 2>/dev/null || echo 0)"
      if [ "$count" -ge "$PER_SHARD" ]; then
        continue
      fi
      echo "===== restarting $p for mode=$MODE ====="
      nohup env \
        AI_KPI_TEST_INJECT_WRITE_DELAY_MS="${AI_KPI_TEST_INJECT_WRITE_DELAY_MS}" \
        AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE="${AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE}" \
        AI_KPI_TEST_INJECT_TIMEOUT_MS="${AI_KPI_TEST_INJECT_TIMEOUT_MS}" \
        AI_KPI_TEST_INJECT_DB_UNAVAILABLE="${AI_KPI_TEST_INJECT_DB_UNAVAILABLE}" \
        node "$REPO/scripts/phase31-controlled-observability-matrix-runner.mjs" \
        --protocol "$p" \
        --windows 4 \
        --runs 2 \
        --out "$OUT/shard-$p" \
        --resume >>"$OUT/runner-$p.log" 2>&1 &
    fi
  done

  if [ "$total" -ge "$TOTAL" ]; then
    echo "Phase 32E mode $MODE complete"
    exit 0
  fi
  sleep 120
done
