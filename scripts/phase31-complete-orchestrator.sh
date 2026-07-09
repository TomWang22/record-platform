#!/usr/bin/env bash
# Drive Phase 31 from current soak state to CLOSED PASS or BLOCKED.
set -euo pipefail
REPO=/Users/tom/record-platform
OUT=/tmp/phase31-staging-long-soak-matrix
RESULT="$OUT/phase31-final-result.json"
TRIAGE="$OUT/phase31-failure-triage.json"
RETRY_TRIAGE="$OUT/phase31-retryable-triage.json"
LOG="$OUT/phase31-orchestrator.log"
export T20_EVAL_RAG_PAUSE_SEC=0.15
PY="$REPO/services/python-ai-service/.venv/bin/python"

exec > >(tee -a "$LOG") 2>&1

target_per_shard=17280
target_total=51840

shard_total() {
  wc -l "$OUT"/shard-*/phase31-matrix.jsonl 2>/dev/null | tail -1 | awk '{print $1}'
}

shard_count() {
  wc -l <"$OUT/shard-$1/phase31-matrix.jsonl" 2>/dev/null || echo 0
}

ensure_runners() {
  for p in h1 h2 h3; do
    if ! pgrep -fl "phase31-controlled-observability-matrix-runner.mjs --protocol $p" >/dev/null; then
      c=$(shard_count "$p")
      if [ "$c" -lt "$target_per_shard" ]; then
        echo "===== restart shard $p ($c/$target_per_shard) ====="
        tail -120 "$OUT/runner-$p.log" || true
        nohup node "$REPO/scripts/phase31-controlled-observability-matrix-runner.mjs" \
          --protocol "$p" --windows 32 --runs 10 \
          --out "$OUT/shard-$p" --resume >>"$OUT/runner-$p.log" 2>&1 &
      fi
    fi
  done
}

wait_for_matrix() {
  echo "===== waiting for matrix $target_total ====="
  while true; do
    ensure_runners
    total=$(shard_total)
    h1=$(shard_count h1); h2=$(shard_count h2); h3=$(shard_count h3)
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) progress total=$total h1=$h1 h2=$h2 h3=$h3"
    if [ "$h1" -ge "$target_per_shard" ] && [ "$h2" -ge "$target_per_shard" ] && [ "$h3" -ge "$target_per_shard" ]; then
      break
    fi
    sleep 120
  done
}

summarize_json() {
  node "$REPO/scripts/phase31-summarize-controlled-matrix.mjs" --in "$OUT" --json >"$OUT/current-summary.json"
}

gates_clean() {
  node -e '
const j=require(process.argv[1]);
const p=j.per_protocol||{};
const ok =
  j.total===51840 &&
  p["HTTP/1.1"]===17280 && p["HTTP/2"]===17280 && p["HTTP/3"]===17280 &&
  j.fallback===0 && j.wrong_protocol===0 && j.wrong_gate===0 &&
  j.response_pass_rate===1 && j.sentiment_pass_rate===1 &&
  j.red_team_safety_pass_rate===1 && j.leakage_failures===0;
process.exit(ok?0:1);
' "$OUT/current-summary.json"
}

echo "===== Phase 31 orchestrator start $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
wait_for_matrix

echo "===== failure triage ====="
node "$REPO/scripts/phase31-extract-controlled-matrix-failures.mjs" --in "$OUT" --out "$TRIAGE"

retryable=$(node -e 'const t=require(process.argv[1]); console.log(t.counts.retryable_failures||0)' "$TRIAGE")
echo "retryable_failures=$retryable"

if [ "$retryable" -gt 0 ]; then
  node -e '
const fs=require("fs");
const t=require(process.argv[1]);
const filtered={...t, failure_probes:t.retryable_failures, deterministic_failures:t.deterministic_failures};
fs.writeFileSync(process.argv[2], JSON.stringify(filtered,null,2)+"\n");
' "$TRIAGE" "$RETRY_TRIAGE"
  echo "===== retry-only runner ====="
  node "$REPO/scripts/phase31-controlled-observability-matrix-runner.mjs" \
    --protocol all --windows 32 --runs 10 \
    --out "$OUT" \
    --only-failures "$RETRY_TRIAGE" \
    --resume
fi

echo "===== merged summary ====="
summarize_json
cat "$OUT/current-summary.json"

if ! gates_clean; then
  echo "===== BLOCKED after retry merge ====="
  node "$REPO/scripts/phase31-extract-controlled-matrix-failures.mjs" \
    --in "$OUT" --out "$OUT/phase31-failure-triage-final.json"
  node -e '
const fs=require("fs");
const j=require(process.argv[1]);
const t=require(process.argv[2]);
fs.writeFileSync(process.argv[3], JSON.stringify({
  phase31:"BLOCKED",
  head_sha:require("child_process").execSync("git -C /Users/tom/record-platform rev-parse HEAD").toString().trim(),
  summary:j,
  triage_counts:t.counts,
  deterministic_failures:t.deterministic_failures?.length||0,
  retryable_failures:t.retryable_failures?.length||0,
  blocked_at:new Date().toISOString(),
},null,2)+"\n");
' "$OUT/current-summary.json" "$OUT/phase31-failure-triage-final.json" "$RESULT"
  exit 2
fi

echo "===== 31E pipeline drills ====="
"$PY" "$REPO/scripts/phase31-pipeline-durability-drill.py"
"$PY" "$REPO/scripts/phase31-failure-injection-drill.py"

echo "===== 31F KPI report ====="
node "$REPO/scripts/phase31-generate-kpi-report-readonly.mjs" /tmp/phase31-kpi-report

echo "===== 31G latency regression ====="
node "$REPO/scripts/phase31-latency-regression-analysis.mjs" \
  --in "$OUT" \
  --out "$OUT/phase31-latency-regression.json"

echo "===== 31H rollback ====="
"$PY" "$REPO/scripts/phase31-disable-switch-rollback-drill.py"

echo "===== 31I/J closeout verify ====="
make -C "$REPO" ai-platform-verify-phase31-closeout

node -e '
const fs=require("fs");
const j=require(process.argv[1]);
fs.writeFileSync(process.argv[2], JSON.stringify({
  phase31:"CLOSED PASS",
  head_sha:require("child_process").execSync("git -C /Users/tom/record-platform rev-parse HEAD").toString().trim(),
  summary:j,
  completed_at:new Date().toISOString(),
},null,2)+"\n");
' "$OUT/current-summary.json" "$RESULT"

echo "===== Phase 31 CLOSED PASS ====="
exit 0
