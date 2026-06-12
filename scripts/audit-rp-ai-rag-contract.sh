#!/usr/bin/env bash
# T15.2D — RAG corpus contract audit (schema, privacy, forbidden leaks).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/ai-platform}"
MD_REPORT="$REPORT_DIR/rag-ingestion-contract.md"
JSON_REPORT="$REPORT_DIR/rag-ingestion-contract.json"
mkdir -p "$REPORT_DIR"

FAIL=0
CHECKS=()

pass() { CHECKS+=("{\"id\":\"$1\",\"status\":\"pass\"}"); echo "✅ $1"; }
fail() { CHECKS+=("{\"id\":\"$1\",\"status\":\"fail\",\"detail\":$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"); echo "❌ $1: $2"; FAIL=1; }

PSQL=(psql -h "$PGHOST" -p 5440 -U "$PGUSER" -d python_ai -v ON_ERROR_STOP=1 -At)

table_exists() {
  "${PSQL[@]}" -c "SELECT 1 FROM information_schema.tables WHERE table_schema='ai' AND table_name='$1'" 2>/dev/null | grep -q 1
}

echo "=== RP AI RAG contract audit (T15.2D) ==="

# 1–2 schema
if table_exists ai_documents; then pass "ai_documents_exists"; else fail "ai_documents_exists" "missing"; fi
if table_exists ai_document_chunks; then pass "ai_document_chunks_exists"; else fail "ai_document_chunks_exists" "missing"; fi

REQUIRED_TYPES=(record listing listing_revision obo_offer_summary auction_bid_summary notification)
MISSING_TYPES=()
for st in "${REQUIRED_TYPES[@]}"; do
  cnt=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ai.ai_documents WHERE source_type='$st'" 2>/dev/null || echo 0)
  if [[ "${cnt:-0}" -eq 0 ]]; then MISSING_TYPES+=("$st"); fi
done
if [[ ${#MISSING_TYPES[@]} -eq 0 ]]; then
  pass "required_source_types_present"
else
  if [[ "${AI_RAG_E2E_SEED:-0}" == "1" ]]; then
    fail "required_source_types_present" "missing after E2E seed: ${MISSING_TYPES[*]}"
  else
    fail "required_source_types_present" "missing: ${MISSING_TYPES[*]} (set AI_RAG_E2E_SEED=1 and reindex if no live data)"
  fi
fi

# 4–5 owner/private visibility — no public doc with another user's private fields
CROSS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_documents d
  WHERE d.visibility = 'owner' AND d.owner_user_id IS NULL
" 2>/dev/null || echo 0)
if [[ "${CROSS:-0}" -eq 0 ]]; then pass "owner_visibility_has_owner_id"; else fail "owner_visibility_has_owner_id" "count=$CROSS"; fi

# 6 proxy max forbidden in chunks
PROXY_HITS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_document_chunks
  WHERE content ~* 'max_bid_cents|proxy_bids|proxy max'
" 2>/dev/null || echo 0)
if [[ "${PROXY_HITS:-0}" -eq 0 ]]; then pass "no_proxy_max_in_chunks"; else fail "no_proxy_max_in_chunks" "hits=$PROXY_HITS"; fi

# 7 messages only with opt-in metadata
MSG_NO_OPTIN=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_documents
  WHERE source_type = 'message' AND COALESCE(metadata->>'opt_in','false') <> 'true'
" 2>/dev/null || echo 0)
if [[ "${MSG_NO_OPTIN:-0}" -eq 0 ]]; then pass "messages_require_opt_in"; else fail "messages_require_opt_in" "count=$MSG_NO_OPTIN"; fi

# 8 no mock/demo/fallback rows
MOCK_HITS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_documents
  WHERE source_type ~* 'mock|demo|fallback|fake|sample'
     OR metadata::text ~* '\"mock\"|\"demo\"|\"fallback\"'
" 2>/dev/null || echo 0)
if [[ "${MOCK_HITS:-0}" -eq 0 ]]; then pass "no_mock_source_rows"; else fail "no_mock_source_rows" "count=$MOCK_HITS"; fi

# 9 forbidden domain terms in chunks
FORBIDDEN_RE='(OCH|off[- ]campus|housing|landlord|tenant|booking\.events)'
DOMAIN_HITS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_document_chunks WHERE content ~* '$FORBIDDEN_RE'
" 2>/dev/null || echo 0)
if [[ "${DOMAIN_HITS:-0}" -eq 0 ]]; then pass "no_forbidden_domain_terms"; else fail "no_forbidden_domain_terms" "hits=$DOMAIN_HITS"; fi

# 10 checksum uniqueness + chunk consistency
DUP_CHECKSUM=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM (
    SELECT checksum FROM ai.ai_documents GROUP BY checksum HAVING COUNT(*) > 1
  ) x
" 2>/dev/null || echo 0)
ORPHAN_CHUNKS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_document_chunks c
  LEFT JOIN ai.ai_documents d ON d.id = c.document_id WHERE d.id IS NULL
" 2>/dev/null || echo 0)
EMPTY_DOCS=$("${PSQL[@]}" -c "
  SELECT COUNT(*) FROM ai.ai_documents d
  WHERE NOT EXISTS (SELECT 1 FROM ai.ai_document_chunks c WHERE c.document_id = d.id)
" 2>/dev/null || echo 0)
if [[ "${DUP_CHECKSUM:-0}" -eq 0 ]]; then pass "checksum_unique_per_document"; else fail "checksum_unique_per_document" "dups=$DUP_CHECKSUM"; fi
if [[ "${ORPHAN_CHUNKS:-0}" -eq 0 ]]; then pass "chunk_document_fk_consistent"; else fail "chunk_document_fk_consistent" "orphans=$ORPHAN_CHUNKS"; fi
if [[ "${EMPTY_DOCS:-0}" -eq 0 ]]; then pass "every_document_has_chunks"; else fail "every_document_has_chunks" "empty=$EMPTY_DOCS"; fi

DOC_COUNT=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ai.ai_documents" 2>/dev/null || echo 0)
CHUNK_COUNT=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ai.ai_document_chunks" 2>/dev/null || echo 0)
SOURCE_COUNTS_JSON=$("${PSQL[@]}" -c "
  SELECT COALESCE(json_object_agg(source_type, cnt)::text, '{}')
  FROM (SELECT source_type, COUNT(*)::int AS cnt FROM ai.ai_documents GROUP BY source_type) s
" 2>/dev/null || echo '{}')

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS_JSON="[$(IFS=,; echo "${CHECKS[*]}")]"

cat > "$JSON_REPORT" <<EOF
{
  "finished_at": "$FINISHED_AT",
  "document_count": ${DOC_COUNT:-0},
  "chunk_count": ${CHUNK_COUNT:-0},
  "source_counts": $SOURCE_COUNTS_JSON,
  "checks": $CHECKS_JSON,
  "exit_code": $FAIL
}
EOF

{
  echo "# RAG ingestion contract (T15.2D audit)"
  echo ""
  echo "Generated: $FINISHED_AT"
  echo ""
  echo "## Corpus counts"
  echo "- documents: ${DOC_COUNT:-0}"
  echo "- chunks: ${CHUNK_COUNT:-0}"
  echo ""
  echo "## Source counts"
  echo '```json'
  echo "$SOURCE_COUNTS_JSON"
  echo '```'
  echo ""
  echo "## Checks"
  for c in "${CHECKS[@]}"; do echo "- $c"; done
  echo ""
  echo "Exit: $FAIL"
} > "$MD_REPORT"

echo "Reports: $MD_REPORT , $JSON_REPORT"
exit "$FAIL"
