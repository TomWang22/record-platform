#!/usr/bin/env bash
# T20.7R — Verify tranche lock blocks rerun without FORCE (no new embeddings).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

REPORT_MD="${REPORT_MD:-$REPO_ROOT/bench_logs/ai-platform/t20-7r-backfill-rerun-guard-smoke.md}"
TRANCHE_ID="${EMBEDDING_BACKFILL_TRANCHE_ID:-t20-tranche-2}"
EXPECTED_BLOCKED_EXIT="${EXPECTED_BLOCKED_EXIT:-2}"
FORCE_USED="${EMBEDDING_BACKFILL_FORCE:-0}"

mkdir -p "$(dirname "$REPORT_MD")"

echo "=== T20.7R backfill rerun guard smoke ==="
echo "tranche_id=$TRANCHE_ID expected_blocked_exit=$EXPECTED_BLOCKED_EXIT force=$FORCE_USED"

if [[ "$FORCE_USED" == "1" ]]; then
  echo "❌ EMBEDDING_BACKFILL_FORCE=1 is not allowed in this smoke" >&2
  exit 1
fi

if ! rp_python_ai_psql_connect_check; then
  echo "❌ python_ai DB unreachable" >&2
  exit 1
fi

PRE_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
echo "pre_embedded_count=$PRE_EMBEDDED"

LOCK_PATH="$REPO_ROOT/bench_logs/ai-platform/${TRANCHE_ID}-actual-run.json"
if [[ ! -f "$LOCK_PATH" ]]; then
  echo "❌ expected tranche lock missing: $LOCK_PATH" >&2
  exit 1
fi
echo "lock_path=$LOCK_PATH"

set +e
EMBEDDING_BACKFILL_TRANCHE_ID="$TRANCHE_ID" \
EMBEDDING_BACKFILL_TOTAL_LIMIT=500 \
EMBEDDING_BACKFILL_MAX_NEW=500 \
EMBEDDING_BACKFILL_PER_TYPE_LIMITS="obo_offer_summary=150,listing=200,listing_revision=100,notification=50,record=0,auction_bid_summary=0" \
EMBEDDING_BACKFILL_BATCH_SIZE=10 \
EMBEDDING_BACKFILL_FORCE=0 \
bash "$SCRIPT_DIR/rp-ai-embedding-backfill-controlled.sh" >"$REPO_ROOT/bench_logs/ai-platform/t20-7r-rerun-attempt.log" 2>&1
BLOCKED_EXIT=$?
set -e

echo "blocked_rerun_exit=$BLOCKED_EXIT"
if [[ "$BLOCKED_EXIT" -eq 0 ]]; then
  echo "❌ rerun was not blocked (expected nonzero exit)" >&2
  exit 1
fi
if [[ "$BLOCKED_EXIT" -ne "$EXPECTED_BLOCKED_EXIT" ]]; then
  echo "⚠️ rerun blocked with exit $BLOCKED_EXIT (expected $EXPECTED_BLOCKED_EXIT) — still nonzero, continuing"
fi

POST_EMBEDDED="$(rp_python_ai_psql "SELECT count(*) FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL;")"
echo "post_embedded_count=$POST_EMBEDDED"

if [[ "$POST_EMBEDDED" != "$PRE_EMBEDDED" ]]; then
  echo "❌ embedded count changed ($PRE_EMBEDDED → $POST_EMBEDDED)" >&2
  exit 1
fi

CHECK_LOCK_EXIT=0
bash "$SCRIPT_DIR/rp-ai-embedding-backfill-controlled.sh" --check-lock "$TRANCHE_ID" >/dev/null 2>&1 || CHECK_LOCK_EXIT=$?
if [[ "$CHECK_LOCK_EXIT" -eq 0 ]]; then
  echo "❌ --check-lock should exit nonzero when lock present" >&2
  exit 1
fi
echo "check_lock_exit=$CHECK_LOCK_EXIT"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$REPORT_MD" <<EOF
# T20.7R — Backfill rerun guard smoke

**Generated:** $NOW  
**RESULT: PASS**

| Check | Value |
|-------|-------|
| tranche_id | \`$TRANCHE_ID\` |
| lock_path | \`$LOCK_PATH\` |
| pre_embedded_count | $PRE_EMBEDDED |
| post_embedded_count | $POST_EMBEDDED |
| blocked_rerun_exit | $BLOCKED_EXIT |
| expected_blocked_exit | $EXPECTED_BLOCKED_EXIT |
| check_lock_exit | $CHECK_LOCK_EXIT |
| EMBEDDING_BACKFILL_FORCE | **no** |
| new_embeddings_added | 0 |

## Notes

- Direct execution (no pipe) preserves backfill exit code; piping to \`tail\` masks it unless \`set -o pipefail\`.
- Lock block uses exit code **2** (\`EXIT_LOCK_BLOCKED\`).
EOF

echo "✅ T20.7R rerun guard smoke PASS → $REPORT_MD"
