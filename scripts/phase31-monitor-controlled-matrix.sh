#!/usr/bin/env bash
set -uo pipefail
REPO=/Users/tom/record-platform
OUT="${1:-/tmp/phase31-staging-long-soak-matrix}"
LOG="$OUT/phase31-monitor.log"
SUMMARY_JSON="$OUT/current-summary.json"
export T20_EVAL_RAG_PAUSE_SEC=0.15

exec >>"$LOG" 2>&1

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase31 summary ====="

  if ! node "$REPO/scripts/phase31-summarize-controlled-matrix.mjs" --in "$OUT" --json >"$SUMMARY_JSON" 2>/dev/null; then
    echo "warn: summarize --json failed; keeping prior summary if present"
  fi

  echo "===== runner processes ====="
  pgrep -fl "phase31-controlled-observability-matrix-runner" || true

  for p in h1 h2 h3; do
    if ! pgrep -fl "phase31-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      count="$(wc -l <"$OUT/shard-$p/phase31-matrix.jsonl" 2>/dev/null || echo 0)"
      if [ "$count" -ge 17280 ]; then
        echo "===== $p shard complete ($count/17280); skip restart ====="
        continue
      fi
      echo "===== $p runner stopped; inspecting log before restart ====="
      tail -200 "$OUT/runner-$p.log" || true
      echo "===== restarting $p with --resume ====="
      nohup node "$REPO/scripts/phase31-controlled-observability-matrix-runner.mjs" \
        --protocol "$p" \
        --windows 32 \
        --runs 10 \
        --out "$OUT/shard-$p" \
        --resume >>"$OUT/runner-$p.log" 2>&1 &
      echo "restarted $p pid=$!"
    fi
  done

  if [ ! -s "$SUMMARY_JSON" ]; then
    echo "monitor tick: no summary JSON yet"
    sleep 300
    continue
  fi

  read -r total status wrong_gate leakage response <<<"$(node -e '
const fs = require("node:fs");
const p = process.argv[1];
let j = {};
try {
  j = JSON.parse(fs.readFileSync(p, "utf8"));
} catch (err) {
  console.error("monitor JSON parse failed:", err.message);
  process.exit(1);
}
console.log([
  j.total || 0,
  j.status || "IN_PROGRESS",
  j.wrong_gate || 0,
  j.leakage_failures || 0,
  j.response_pass_rate || 0,
].join(" "));
' "$SUMMARY_JSON" 2>/dev/null || echo "0 IN_PROGRESS 0 0 0")"

  echo "monitor tick: total=$total status=$status wrong_gate=$wrong_gate leakage=$leakage response=$response"

  if [ "$leakage" != "0" ] && [ "$total" -gt 0 ]; then
    echo "Phase 31D BLOCKED: leakage > 0"
    exit 3
  fi

  if [ "$total" = "51840" ] && [ "$status" = "PASS" ]; then
    echo "Phase 31D matrix PASS"
    cp "$SUMMARY_JSON" "$OUT/phase31-monitor-final.json"
    exit 0
  fi

  if [ "$total" = "51840" ] && [ "$status" != "PASS" ]; then
    echo "Phase 31D matrix complete but BLOCKED; run triage"
    node "$REPO/scripts/phase31-extract-controlled-matrix-failures.mjs" \
      --in "$OUT" \
      --out "$OUT/phase31-failure-triage-final.json" || true
    exit 2
  fi

  sleep 300
done
