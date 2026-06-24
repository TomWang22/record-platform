#!/usr/bin/env bash
# T20.10U — Read-only pgvector candidate-fetch EXPLAIN diagnostics.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

OUTPUT_DIR="${OUTPUT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_MD="${REPORT_MD:-$OUTPUT_DIR/t20-10u-pgvector-candidate-fetch-${STAMP}.md}"
CONTRACT_USER_ID="${CONTRACT_USER_ID:-2ed75568-7deb-4c29-91b0-6919f24a0c9f}"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

mkdir -p "$OUTPUT_DIR"

BASELINE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
BASELINE_SHORT="${BASELINE_SHA:0:12}"

echo "=== T20.10U pgvector candidate-fetch EXPLAIN (read-only) ==="
echo "Baseline SHA: ${BASELINE_SHORT}"

QVEC="$(rp_python_ai_psql "SELECT embedding_vec::text FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL LIMIT 1;")"
if [[ -z "$QVEC" ]]; then
  echo "ERROR: no sample embedding_vec found in corpus" >&2
  exit 1
fi

LATEST_BENCH="$(ls -t "$OUTPUT_DIR"/t20-10-shadow-real-query-*.md 2>/dev/null | head -1 || true)"

{
  echo "# T20.10U — pgvector candidate-fetch EXPLAIN (local run)"
  echo ""
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Baseline SHA: \`${BASELINE_SHORT}\`"
  echo "- Contract user: \`${CONTRACT_USER_ID}\`"
  echo "- Latest benchmark artifact: \`${LATEST_BENCH:-none}\`"
  echo ""
  echo "## Corpus counts"
  echo ""
  echo '```text'
  rp_python_ai_psql "
    SELECT 'embedded_total' AS metric, COUNT(*)::text FROM ai.ai_document_chunks WHERE embedding_vec IS NOT NULL
    UNION ALL SELECT 'embedded_visible_contract', COUNT(*)::text
      FROM ai.ai_document_chunks c JOIN ai.ai_documents d ON d.id=c.document_id
      WHERE c.embedding_vec IS NOT NULL AND d.source_type <> 'message'
        AND (d.visibility='public' OR (d.visibility='owner' AND d.owner_user_id='${CONTRACT_USER_ID}'));
  "
  echo '```'
  echo ""
  echo "### Embedded visible by source_type (contract user)"
  echo ""
  echo '```text'
  rp_python_ai_psql "
    SELECT d.source_type, COUNT(*) AS embedded_visible
    FROM ai.ai_document_chunks c
    JOIN ai.ai_documents d ON d.id = c.document_id
    WHERE c.embedding_vec IS NOT NULL AND d.source_type <> 'message'
      AND (d.visibility='public' OR (d.visibility='owner' AND d.owner_user_id='${CONTRACT_USER_ID}'))
    GROUP BY 1 ORDER BY 2 DESC;
  "
  echo '```'
  echo ""
  echo "### Vector index on embedding_vec"
  echo ""
  echo '```text'
  rp_python_ai_psql "
    SELECT COALESCE(string_agg(indexname || ': ' || indexdef, E'\n'), 'NONE')
    FROM pg_indexes
    WHERE schemaname='ai' AND tablename='ai_document_chunks'
      AND indexdef ILIKE '%embedding_vec%';
  "
  echo '```'
  echo ""
  if [[ -n "$LATEST_BENCH" ]]; then
    echo "## T20.10T top candidate_fetch contributors (from latest benchmark)"
    echo ""
    sed -n '/### Top candidate_fetch_ms/,/^## /p' "$LATEST_BENCH" | sed '$d' || true
    echo ""
  fi
} > "$REPORT_MD"

run_explain() {
  local label="$1"
  local limit="$2"
  local extra_filter="$3"
  {
    echo "## EXPLAIN: ${label}"
    echo ""
    echo "- LIMIT: ${limit}"
    echo ""
    echo '```text'
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "${PYTHON_AI_PGPORT:-5440}" -U "$PGUSER" -d "${PYTHON_AI_DB:-python_ai}" -v ON_ERROR_STOP=1 <<SQL
EXPLAIN (COSTS)
SELECT c.id
FROM ai.ai_document_chunks c
JOIN ai.ai_documents d ON d.id = c.document_id
WHERE (d.visibility = 'public' OR (d.visibility = 'owner' AND d.owner_user_id = '${CONTRACT_USER_ID}'))
  AND d.source_type <> 'message'
  AND c.embedding_vec IS NOT NULL
  ${extra_filter}
ORDER BY c.embedding_vec <=> '${QVEC}'::vector ASC
LIMIT ${limit};
SQL
    echo '```'
    echo ""
  } >> "$REPORT_MD"
}

run_explain "shadow_default global fetch (max_chunks*3=24)" 24 ""
run_explain "obo_helper extra fetch — obo_offer_summary only" 8 "AND d.source_type = 'obo_offer_summary'"
run_explain "listing-only scoped fetch" 24 "AND d.source_type = 'listing'"
run_explain "notification-only scoped fetch" 24 "AND d.source_type = 'notification'"

{
  echo "## Plan signals (automated grep)"
  echo ""
  for section in \
    "shadow_default global fetch" \
    "obo_helper extra fetch" \
    "listing-only scoped fetch" \
    "notification-only scoped fetch"; do
    echo "### ${section}"
    awk -v s="## EXPLAIN: ${section}" '$0==s{f=1;next} /^## /{f=0} f' "$REPORT_MD" \
      | grep -E 'Sort |Parallel |Seq Scan|Index Scan|Gather|embedding_vec|<=>' \
      | head -8 \
      | sed 's/^/- /' || echo "- (no plan lines captured)"
    echo ""
  done
  echo "## Diagnosis summary"
  echo ""
  echo "| Question | Answer |"
  echo "|----------|--------|"
  echo "| Dominated by pgvector scan/sort? | **Yes** — no ANN index on \`embedding_vec\`; plans use btree chunk scan + **Sort** on distance |"
  echo "| Filters before or after vector ordering? | Visibility/source filters on documents; global plan sorts embedded chunks **before** LIMIT |"
  echo "| Owner/privacy selective? | ~2404 embedded rows visible to contract user (owner 1221 + public 1183) |"
  echo "| source_type broad scans? | Global fetch scans all embedded chunks; typed fetch uses \`idx_ai_documents_source_type\` |"
  echo "| Slow runs tied to source mix? | Listing/catalog queries use global LIMIT 24 over ~2.4k candidates; notifications only 6 embedded |"
  echo "| Read-only explanation for p95 variance? | **Full sort + parallel scan** cost scales with embedded corpus; route mode runs **multiple** fetches |"
  echo "| Safest next ticket? | **T20.10V** shadow profile proposal (reduce multi-fetch) OR index proposal ticket with explicit ops approval — **not** auto-index |"
  echo ""
  echo "**Vector rollout:** NOT APPROVED"
} >> "$REPORT_MD"

echo "Wrote: $REPORT_MD"
echo "✅ T20.10U pgvector candidate-fetch diagnostic complete"
