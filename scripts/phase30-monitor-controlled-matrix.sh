#!/usr/bin/env bash
set -uo pipefail
REPO=/Users/tom/record-platform
OUT=/tmp/phase30-controlled-staging-matrix
LOG="$OUT/phase30-monitor.log"
export T20_EVAL_RAG_PAUSE_SEC=0.15

exec >>"$LOG" 2>&1

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase30 summary ====="
  node "$REPO/scripts/phase30-summarize-controlled-matrix.mjs" --in "$OUT" || true

  echo "===== runner processes ====="
  pgrep -fl "phase30-controlled-observability-matrix-runner" || true

  for p in h1 h2 h3; do
    if ! pgrep -fl "phase30-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      count="$(wc -l <"$OUT/shard-$p/phase30-matrix.jsonl" 2>/dev/null || echo 0)"
      if [ "$count" -ge 8640 ]; then
        echo "===== $p shard complete ($count/8640); skip restart ====="
        continue
      fi
      echo "===== $p runner stopped; inspecting log before restart ====="
      tail -200 "$OUT/runner-$p.log" || true
      echo "===== restarting $p with --resume ====="
      nohup node "$REPO/scripts/phase30-controlled-observability-matrix-runner.mjs" \
        --protocol "$p" \
        --windows 16 \
        --runs 10 \
        --out "$OUT/shard-$p" \
        --resume >>"$OUT/runner-$p.log" 2>&1 &
      echo "restarted $p pid=$!"
    fi
  done

  json="$(node "$REPO/scripts/phase30-summarize-controlled-matrix.mjs" --in "$OUT" --json >"$OUT/current-summary.json" 2>/dev/null && cat "$OUT/current-summary.json" || echo '{}')"
  read -r total status wrong_gate leakage response <<EOF
$(node "$REPO/scripts/phase32h-parse-summary-json.mjs" --file "$OUT/current-summary.json" --fields total,status,wrong_gate,leakage_failures,response_pass_rate 2>/dev/null | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log([j.total||0,j.status||"IN_PROGRESS",j.wrong_gate||0,j.leakage_failures||0,j.response_pass_rate||0].join(" "));' || echo "0 IN_PROGRESS 0 0 0")
EOF

  echo "monitor tick: total=$total status=$status wrong_gate=$wrong_gate leakage=$leakage response=$response"

  if [ "$leakage" != "0" ] && [ "$total" -gt 0 ]; then
    echo "Phase 30F BLOCKED: leakage > 0"
    exit 3
  fi

  if [ "$total" = "25920" ] && [ "$status" = "PASS" ]; then
    echo "Phase 30F matrix PASS"
    echo "$json" >"$OUT/phase30-monitor-final.json"
    exit 0
  fi

  if [ "$total" = "25920" ] && [ "$status" != "PASS" ]; then
    echo "Phase 30F matrix complete but BLOCKED; run triage"
    node "$REPO/scripts/phase30-extract-controlled-matrix-failures.mjs" \
      --in "$OUT" \
      --out "$OUT/phase30-failure-triage-final.json" || true
    exit 2
  fi

  sleep 300
done
