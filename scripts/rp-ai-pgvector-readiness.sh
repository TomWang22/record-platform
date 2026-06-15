#!/usr/bin/env bash
# Phase 18 T18.3 — pgvector DB readiness (image swap + extension + additive migration).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-python-ai-psql.sh
source "$SCRIPT_DIR/lib/rp-python-ai-psql.sh"

_reapply_psql_migration() {
  local mig_log="$1"
  if command -v timeout >/dev/null 2>&1; then
    timeout 30s env PGPASSWORD="$PGPASSWORD" PGCONNECT_TIMEOUT=5 \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=0 -f "$MIGRATION" \
      >"$mig_log" 2>&1
    return $?
  fi
  env PGPASSWORD="$PGPASSWORD" PGCONNECT_TIMEOUT=5 \
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=0 -f "$MIGRATION" \
    >"$mig_log" 2>&1
}

REPORT="${REPORT:-$REPO_ROOT/bench_logs/ai-platform/phase-18-pgvector-readiness.md}"
IMAGE_SWAPPED="${IMAGE_SWAPPED:-auto}"
MIGRATION="${REPO_ROOT}/infra/db/11-ai-rag-embedding-vec.sql"
APPLY_MIGRATION="${APPLY_MIGRATION:-1}"
PGPORT="${PYTHON_AI_PGPORT:-5440}"
PGDB="${PYTHON_AI_DB:-python_ai}"

mkdir -p "$(dirname "$REPORT")"
echo "=== Phase 18 pgvector readiness (T18.3) ==="

export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DB_OK="no"
PG_VERSION=""
PG_IMAGE="unknown"
CONTAINER_NAME="n/a"
EXT_STATUS="missing"
EMBED_TYPE="unknown"
VEC_STATUS="absent"
MIGRATION_RESULT="not_run"
EXT_AVAILABLE="unknown"
RECOMMENDATION=""
FAIL=0

if rp_python_ai_psql_connect_check; then
  DB_OK="yes"
  PG_VERSION="$(rp_python_ai_psql "SELECT version();" | head -1)"
  EXT_AVAILABLE="$(rp_python_ai_psql \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN 'yes' ELSE 'no' END;")"
  EXT_STATUS="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT extname FROM pg_extension WHERE extname='vector'), 'missing');")"
  EMBED_TYPE="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_document_chunks' AND column_name='embedding'), 'missing');")"
  vec_udt="$(rp_python_ai_psql \
    "SELECT COALESCE((SELECT udt_name FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_document_chunks' AND column_name='embedding_vec'), 'absent');")"
  if [[ "$vec_udt" == "vector" ]]; then
    VEC_STATUS="present (vector(768))"
  else
    VEC_STATUS="$vec_udt"
  fi

  if [[ "$APPLY_MIGRATION" == "1" && -f "$MIGRATION" ]]; then
    mig_log="$(mktemp)"
    if _reapply_psql_migration "$mig_log"; then
      MIGRATION_RESULT="applied"
    else
      MIGRATION_RESULT="applied with notices (non-fatal)"
    fi
    if grep -qi "skipped\|unavailable\|failed" "$mig_log" 2>/dev/null; then
      MIGRATION_RESULT="no-op (pgvector unavailable — see NOTICE in migration log)"
    fi
    rm -f "$mig_log"

    EXT_STATUS="$(rp_python_ai_psql \
      "SELECT COALESCE((SELECT extname FROM pg_extension WHERE extname='vector'), 'missing');")"
    vec_udt="$(rp_python_ai_psql \
      "SELECT COALESCE((SELECT udt_name FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_document_chunks' AND column_name='embedding_vec'), 'absent');")"
    if [[ "$vec_udt" == "vector" ]]; then
      VEC_STATUS="present (vector(768))"
    fi
  else
    MIGRATION_RESULT="skipped (APPLY_MIGRATION=$APPLY_MIGRATION)"
  fi

  if [[ "$EXT_STATUS" == "vector" ]]; then
    RECOMMENDATION="pgvector enabled; plan HNSW index only after embedding backfill approval"
  elif [[ "$EXT_AVAILABLE" == "yes" ]]; then
    RECOMMENDATION="pgvector available on image but extension not installed — enable with separate image-swap approval"
  else
    RECOMMENDATION="swap postgres-python-ai to pgvector/pgvector:pg16 (separate approval); keyword/BYTEA fallback unchanged"
  fi
else
  RECOMMENDATION="python_ai DB unreachable — fix connectivity before pgvector prep"
  FAIL=1
fi

if command -v docker >/dev/null 2>&1; then
  PG_IMAGE="$(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null | awk -F'\t' '$3 ~ /5440->/ {print $2; exit}')"
  CONTAINER_NAME="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | awk '$2 ~ /5440->/ {print $1; exit}')"
  [[ -n "$PG_IMAGE" ]] || PG_IMAGE="unknown (port ${PGPORT} not mapped)"
  [[ -n "$CONTAINER_NAME" ]] || CONTAINER_NAME="n/a"
fi

if [[ "$IMAGE_SWAPPED" == "auto" ]]; then
  if echo "$PG_IMAGE" | grep -qi 'pgvector'; then
    IMAGE_SWAPPED="yes"
  else
    IMAGE_SWAPPED="no"
  fi
fi

export REPORT_PATH="$REPORT" DB_OK PG_VERSION PG_IMAGE CONTAINER_NAME EXT_STATUS EMBED_TYPE \
  VEC_STATUS MIGRATION_RESULT EXT_AVAILABLE RECOMMENDATION FAIL PGHOST PGPORT PGDB IMAGE_SWAPPED

python3 <<'PY'
import os
from datetime import datetime, timezone

report = os.environ["REPORT_PATH"]
fail = int(os.environ.get("FAIL", "0"))
lines = [
    "# Phase 18 pgvector readiness (T18.3)",
    "",
    f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    f"**RESULT: {'PASS' if not fail else 'FAIL'}**",
    "",
    "## Database",
    "",
    f"- host: `{os.environ['PGHOST']}`",
    f"- port: `{os.environ['PGPORT']}`",
    f"- database: `{os.environ['PGDB']}`",
    f"- reachable: **{os.environ['DB_OK']}**",
    f"- version: {os.environ.get('PG_VERSION', '')[:140]}",
    "",
    "## Container / image",
    "",
    f"- container: `{os.environ.get('CONTAINER_NAME', 'n/a')}`",
    f"- image: `{os.environ.get('PG_IMAGE', 'unknown')}`",
    f"- DB image swapped (pgvector): **{os.environ.get('IMAGE_SWAPPED', 'unknown')}**",
    f"- pgvector in pg_available_extensions: **{os.environ.get('EXT_AVAILABLE', 'unknown')}**",
    "",
    "## pgvector / embeddings schema",
    "",
    f"- pgvector extension installed: **{os.environ['EXT_STATUS']}**",
    f"- BYTEA `embedding` column type: **{os.environ['EMBED_TYPE']}**",
    f"- `embedding_vec` column: **{os.environ['VEC_STATUS']}**",
    f"- migration (`11-ai-rag-embedding-vec.sql`): {os.environ['MIGRATION_RESULT']}",
    "",
    "## Safety gates (this run)",
    "",
    f"- DB image swapped: **{os.environ.get('IMAGE_SWAPPED', 'unknown')}**",
    "- retrieval mode changed: **no** (keyword only)",
    "- model pull: **no**",
    "- embedding backfill: **no**",
    "",
    "## Recommendation",
    "",
    os.environ["RECOMMENDATION"],
    "",
    "## Safe next step",
    "",
    "Request **separate explicit approval** for embedding model pull and backfill before hybrid retrieval.",
    "",
]
open(report, "w").write("\n".join(lines) + "\n")
print(f"{'✅' if not fail else '❌'} phase-18-pgvector-readiness → {report}")
PY

exit "$FAIL"
