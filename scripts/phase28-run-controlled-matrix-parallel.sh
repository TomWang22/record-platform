#!/usr/bin/env bash
# Phase 28D — run H1/H2/H3 matrix shards in parallel (/tmp only).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BASE="${PHASE28_MATRIX_OUT:-/tmp/phase28-controlled-observability-matrix}"
WINDOWS="${PHASE28_WINDOWS:-16}"
RUNS="${PHASE28_RUNS:-10}"
export T20_EVAL_RAG_PAUSE_SEC="${T20_EVAL_RAG_PAUSE_SEC:-0.01}"

mkdir -p "$OUT_BASE"
for proto in h1 h2 h3; do
  shard="$OUT_BASE/shard-$proto"
  mkdir -p "$shard"
  nohup node "$REPO_ROOT/scripts/phase28-controlled-observability-matrix-runner.mjs" \
    --protocol "$proto" \
    --windows "$WINDOWS" \
    --runs "$RUNS" \
    --out "$shard" \
    --resume \
    > "$OUT_BASE/runner-$proto.log" 2>&1 &
  echo "started $proto pid=$!"
done

wait
# merge shards
cat "$OUT_BASE"/shard-h1/phase28-matrix.jsonl \
    "$OUT_BASE"/shard-h2/phase28-matrix.jsonl \
    "$OUT_BASE"/shard-h3/phase28-matrix.jsonl \
    > "$OUT_BASE/phase28-matrix.jsonl"
node "$REPO_ROOT/scripts/phase28-controlled-observability-matrix-runner.mjs" \
  --summary-only --out "$OUT_BASE"
