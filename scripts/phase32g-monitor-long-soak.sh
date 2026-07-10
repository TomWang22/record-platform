#!/usr/bin/env bash
set -uo pipefail
REPO=/Users/tom/record-platform
OUT="${PHASE32G_MATRIX_ROOT:-/tmp/phase32g-timing-attributed-repaired-long-soak}"
LOG="$OUT/phase32g-monitor.log"
SUMMARY_JSON="$OUT/current-summary.json"
RESTART_LEDGER="$OUT/phase32g-restart-ledger.json"
TARGET_TOTAL=51840
TARGET_PER_PROTOCOL=17280
export PHASE32G_MATRIX_ROOT="$OUT"
export T20_EVAL_RAG_PAUSE_SEC=0.15

exec >>"$LOG" 2>&1

init_restart_ledger() {
  if [ ! -f "$RESTART_LEDGER" ]; then
    echo '{"restarts":[]}' >"$RESTART_LEDGER"
  fi
}

record_restart() {
  local proto="$1"
  local reason="$2"
  node -e "
const fs=require('node:fs');
const p=process.argv[1];
const proto=process.argv[2];
const reason=process.argv[3];
let ledger={restarts:[]};
try { ledger=JSON.parse(fs.readFileSync(p,'utf8')); } catch {}
ledger.restarts.push({at:new Date().toISOString(),protocol:proto,reason});
fs.writeFileSync(p, JSON.stringify(ledger,null,2)+'\n');
" "$RESTART_LEDGER" "$proto" "$reason"
}

init_restart_ledger

while true; do
  echo "===== $(date -u +"%Y-%m-%dT%H:%M:%SZ") phase32g summary ====="

  if ! node "$REPO/scripts/phase32g-summarize-long-soak.mjs" --in "$OUT" --json >"$SUMMARY_JSON" 2>/dev/null; then
    echo "warn: phase32g summarize failed; keeping prior summary if present"
  fi

  echo "===== runner processes ====="
  pgrep -fl "phase31-controlled-observability-matrix-runner" || true

  for p in h1 h2 h3; do
    if ! pgrep -fl "phase31-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      count="$(wc -l <"$OUT/shard-$p/phase31-matrix.jsonl" 2>/dev/null || echo 0)"
      if [ "$count" -ge "$TARGET_PER_PROTOCOL" ]; then
        echo "===== $p shard complete ($count/$TARGET_PER_PROTOCOL); skip restart ====="
        continue
      fi
      echo "===== $p runner stopped; inspecting log before restart ====="
      tail -200 "$OUT/runner-$p.log" || true
      echo "===== restarting $p with --resume ====="
      record_restart "$p" "runner_exit_before_target"
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

  node -e '
const fs = require("node:fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const gates = j.gates || {};
const lat = j.latency_by_protocol || {};
const fmt = (bucket, key) => {
  const b = bucket?.[key];
  if (!b) return "n/a";
  return `p50=${b.p50} p95=${b.p95} p99=${b.p99} max=${b.max}`;
};
console.log([
  `total=${gates.http200 || 0}/${51840}`,
  `status=${j.status}`,
  `h1=${lat["HTTP/1.1"]?.count || 0}`,
  `h2=${lat["HTTP/2"]?.count || 0}`,
  `h3=${lat["HTTP/3"]?.count || 0}`,
  `wrong_gate=${gates.wrong_gate_count || 0}`,
  `wrong_protocol=${gates.wrong_protocol_count || 0}`,
  `fallback=${gates.fallback_count || 0}`,
  `leakage=${gates.leakage_failures || 0}`,
  `response=${gates.response_pass_rate ?? 0}`,
  `sentiment=${gates.sentiment_pass_rate ?? 0}`,
  `red_team=${gates.red_team_safety_pass_rate ?? 0}`,
].join(" "));
for (const proto of ["HTTP/1.1", "HTTP/2", "HTTP/3"]) {
  const bucket = lat[proto];
  if (!bucket) continue;
  console.log(`wall ${proto}: ${fmt(bucket, "wall")}`);
  console.log(`curl ${proto}: ${fmt(bucket, "curl")}`);
  console.log(`server ${proto}: ${fmt(bucket, "server_rag")}`);
}
const m = j.maxima || {};
console.log([
  `max_event_loop=${m.event_loop_delay_ms}`,
  `max_coord_wait=${m.coordinator_wait_ms}`,
  `max_window_reset=${m.window_reset_ms}`,
  `max_unattributed=${m.unattributed_ms}`,
].join(" "));
' "$SUMMARY_JSON" 2>/dev/null || echo "monitor tick: summary parse failed"

  leakage="$(node -e 'const j=require(process.argv[1]); console.log(j.gates?.leakage_failures||0)' "$SUMMARY_JSON" 2>/dev/null || echo 0)"
  wrong_gate="$(node -e 'const j=require(process.argv[1]); console.log(j.gates?.wrong_gate_count||0)' "$SUMMARY_JSON" 2>/dev/null || echo 0)"
  total="$(node -e 'const j=require(process.argv[1]); console.log((j.gates?.http200)||0)' "$SUMMARY_JSON" 2>/dev/null || echo 0)"
  status="$(node -e 'const j=require(process.argv[1]); console.log(j.status||"IN_PROGRESS")' "$SUMMARY_JSON" 2>/dev/null || echo IN_PROGRESS)"

  if [ "$leakage" != "0" ] && [ "$total" -gt 0 ]; then
    echo "Phase 32G BLOCKED: leakage > 0"
    exit 3
  fi
  if [ "$wrong_gate" != "0" ] && [ "$total" -gt 0 ]; then
    echo "Phase 32G BLOCKED: wrong_gate > 0"
    exit 4
  fi

  if [ "$total" = "51840" ] && [ "$status" = "PASS" ]; then
    echo "Phase 32G matrix PASS"
    cp "$SUMMARY_JSON" "$OUT/phase32g-monitor-final.json"
    exit 0
  fi

  if [ "$total" = "51840" ] && [ "$status" != "PASS" ]; then
    echo "Phase 32G matrix complete but BLOCKED; run triage"
    node "$REPO/scripts/phase31-extract-controlled-matrix-failures.mjs" \
      --in "$OUT" \
      --out "$OUT/phase32g-failure-triage-final.json" || true
    exit 2
  fi

  sleep 300
done
