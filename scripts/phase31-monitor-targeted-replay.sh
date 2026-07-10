#!/usr/bin/env bash
set -uo pipefail
REPO=/Users/tom/record-platform
OUT="${1:-/tmp/phase31-preview-lifecycle-repair-replay}"
LOG="$OUT/phase31m-monitor.log"
SUMMARY_JSON="$OUT/current-summary.json"
TARGET=3672
PER_SHARD=1224
export T20_EVAL_RAG_PAUSE_SEC=0.15

shard_rows() {
  local f="$1"
  if [ -f "$f" ]; then
    wc -l <"$f" | tr -d ' '
  else
    echo 0
  fi
}

runner_crashed_before_write() {
  local log="$1"
  local rows="$2"
  [ "$rows" -eq 0 ] && [ -f "$log" ] && grep -qE 'SyntaxError|coordinator wait timeout|manifest not found|manifest count|Error:' "$log"
}

exec >>"$LOG" 2>&1

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase31m summary ====="
  node "$REPO/scripts/phase31-summarize-targeted-replay.mjs" --in "$OUT" --json >"$SUMMARY_JSON" 2>/dev/null || true

  echo "===== runner processes ====="
  pgrep -fl "phase31-targeted-preview-lifecycle-replay" || true

  for p in h1 h2 h3; do
    jsonl="$OUT/shard-$p/phase31m-matrix.jsonl"
    rlog="$OUT/runner-$p.log"
    count="$(shard_rows "$jsonl")"
    if ! pgrep -fl "phase31-targeted-preview-lifecycle-replay.mjs --protocol $p" >/dev/null; then
      if [ "$count" -ge "$PER_SHARD" ]; then
        echo "===== $p shard complete ($count/$PER_SHARD); skip restart ====="
        continue
      fi
      if runner_crashed_before_write "$rlog" "$count"; then
        echo "===== $p runner BLOCKED: exited before writing rows ====="
        tail -80 "$rlog" || true
        echo "Phase 31M targeted replay BLOCKED: runner crash before first row ($p)"
        exit 4
      fi
      echo "===== $p runner stopped; inspecting log before restart ====="
      tail -120 "$rlog" || true
      echo "===== restarting $p with --resume ====="
      nohup node "$REPO/scripts/phase31-targeted-preview-lifecycle-replay.mjs" \
        --protocol "$p" \
        --manifest "$OUT/phase31m-targeted-manifest.jsonl" \
        --out "$OUT/shard-$p" \
        --resume >>"$rlog" 2>&1 &
      echo "restarted $p pid=$!"
    fi
  done

  h1="$(shard_rows "$OUT/shard-h1/phase31m-matrix.jsonl")"
  h2="$(shard_rows "$OUT/shard-h2/phase31m-matrix.jsonl")"
  h3="$(shard_rows "$OUT/shard-h3/phase31m-matrix.jsonl")"
  total=$((h1 + h2 + h3))
  echo "shard rows: h1=$h1 h2=$h2 h3=$h3 total=$total/$TARGET"

  if [ ! -s "$SUMMARY_JSON" ]; then
    echo "monitor tick: no summary JSON yet (rows=$total)"
    sleep 120
    continue
  fi

  read -r json_total status wrong_gate leakage <<<"$(node -e '
const fs = require("node:fs");
const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
console.log([j.total || 0, j.status || "IN_PROGRESS", j.wrong_gate || 0, j.leakage_failures || 0].join(" "));
' "$SUMMARY_JSON" 2>/dev/null || echo "0 IN_PROGRESS 0 0")"

  echo "monitor tick: total=$json_total status=$status wrong_gate=$wrong_gate leakage=$leakage"

  if [ "$total" -ge "$TARGET" ] && [ "$status" = "PASS" ]; then
    echo "Phase 31M targeted replay PASS"
    cp "$SUMMARY_JSON" "$OUT/phase31m-monitor-final.json"
    exit 0
  fi

  if [ "$total" -ge "$TARGET" ] && [ "$status" != "PASS" ]; then
    echo "Phase 31M targeted replay BLOCKED"
    node "$REPO/scripts/phase31-extract-controlled-matrix-failures.mjs" \
      --in "$OUT" \
      --out "$OUT/phase31m-failure-triage.json" || true
    exit 2
  fi

  sleep 120
done
