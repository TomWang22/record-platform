#!/usr/bin/env bash
# Phase 32D — monitor H1/H2/H3 timing attribution micro-soak until PASS/BLOCKED.
set -uo pipefail
REPO=/Users/tom/record-platform
OUT="${1:-${PHASE32D_MATRIX_ROOT:-/tmp/phase32d-timing-attribution-micro-soak}}"
LOG="$OUT/phase32d-monitor.log"
PER_SHARD=1296
TOTAL=3888
export T20_EVAL_RAG_PAUSE_SEC=0.15

exec >>"$LOG" 2>&1

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase32d summary ====="
  node "$REPO/scripts/phase32d-summarize-timing-attribution.mjs" --in "$OUT" || true

  echo "===== runner processes ====="
  pgrep -fl "phase31-controlled-observability-matrix-runner" || true

  for p in h1 h2 h3; do
    if ! pgrep -fl "phase31-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      count="$(wc -l <"$OUT/shard-$p/phase31-matrix.jsonl" 2>/dev/null || echo 0)"
      if [ "$count" -ge "$PER_SHARD" ]; then
        echo "===== $p shard complete ($count/$PER_SHARD); skip restart ====="
        continue
      fi
      echo "===== $p runner stopped; inspecting log before restart ====="
      tail -200 "$OUT/runner-$p.log" || true
      echo "===== restarting $p with --resume ====="
      nohup node "$REPO/scripts/phase31-controlled-observability-matrix-runner.mjs" \
        --protocol "$p" \
        --windows 8 \
        --runs 3 \
        --out "$OUT/shard-$p" \
        --resume >>"$OUT/runner-$p.log" 2>&1 &
      echo "restarted $p pid=$!"
    fi
  done

  read -r total status wrong_gate leakage response rag_pct <<<"$(node -e '
const fs = require("node:fs");
const p = process.argv[1];
let j = {};
try {
  j = JSON.parse(fs.readFileSync(require("node:path").join(p, "phase32d-summary.json"), "utf8"));
} catch {
  console.log("0 IN_PROGRESS 0 0 0 0");
  process.exit(0);
}
const gates = j.gates || {};
const ts = j.timing_stats || {};
const ragPct = ts.total ? (ts.rag_total_ms_populated / ts.total).toFixed(3) : "0";
console.log([
  ts.total || 0,
  j.status || gates.status || "IN_PROGRESS",
  gates.wrong_gate_count || 0,
  gates.leakage_failures || 0,
  gates.response_pass_rate || 0,
  ragPct,
].join(" "));
' "$OUT" 2>/dev/null || echo "0 IN_PROGRESS 0 0 0 0")"

  echo "monitor tick: total=$total status=$status wrong_gate=$wrong_gate leakage=$leakage response=$response rag_pct=$rag_pct"

  if [ "$total" = "$TOTAL" ] && [ "$status" = "PASS" ]; then
    echo "Phase 32D matrix PASS"
    exit 0
  fi

  if [ "$total" = "$TOTAL" ] && [ "$status" = "BLOCKED" ]; then
    echo "Phase 32D BLOCKED"
    exit 2
  fi

  sleep 120
done
