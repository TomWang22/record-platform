#!/usr/bin/env bash
set -euo pipefail

# Initialize Python AI database schema
# Creates database, schema, and tables for AI service

NS="${NS:-record-platform}"
DB_NAME="${DB_NAME:-python_ai}"
DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5440}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

POSTGRES_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Initializing Python AI Database ==="

# Use postgres database to check/create python_ai database
POSTGRES_ADMIN_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres"

# Check if database exists
say "Checking if database '$DB_NAME' exists..."
DB_EXISTS=$(
  kubectl -n "$NS" run dbcheck-python-ai --image=postgres:16-alpine --restart=Never --rm -i --quiet \
    --env="POSTGRES_URL=$POSTGRES_ADMIN_URL" \
    -- sh -lc "
      psql \"\$POSTGRES_URL\" -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" 2>/dev/null | tr -d '[:space:]'
    " || echo ""
)

if [[ "$DB_EXISTS" != "1" ]]; then
  say "Creating database '$DB_NAME'..."
  kubectl -n "$NS" run dbinit-python-ai --image=postgres:16-alpine --restart=Never --rm -i \
    --env="POSTGRES_URL=$POSTGRES_ADMIN_URL" \
    -- sh -lc "
      psql \"\$POSTGRES_URL\" -v ON_ERROR_STOP=1 -c \"CREATE DATABASE $DB_NAME\"
    "
  ok "Database '$DB_NAME' created"
  # Wait a moment for database to be ready
  sleep 2
else
  ok "Database '$DB_NAME' already exists"
fi

# Apply schema
say "Applying Python AI schema..."
SCHEMA_FILE="infra/db/python-ai-schema.sql"
if [[ ! -f "$SCHEMA_FILE" ]]; then
  fail "Schema file not found: $SCHEMA_FILE"
fi

kubectl -n "$NS" run dbschema-python-ai --image=postgres:16-alpine --restart=Never --rm -i \
  --env="POSTGRES_URL=$POSTGRES_URL" \
  -- sh -lc "
    psql \"\$POSTGRES_URL\" -v ON_ERROR_STOP=1 -f - <<'SQL'
$(cat "$SCHEMA_FILE")
SQL
  "

ok "Python AI schema applied successfully"

RAG_SCHEMA_FILE="infra/db/10-ai-rag-corpus.sql"
if [[ -f "$RAG_SCHEMA_FILE" ]]; then
  say "Applying AI RAG corpus schema (T15.2A)..."
  kubectl -n "$NS" run dbschema-python-ai-rag --image=postgres:16-alpine --restart=Never --rm -i \
    --env="POSTGRES_URL=$POSTGRES_URL" \
    -- sh -lc "
      psql \"\$POSTGRES_URL\" -v ON_ERROR_STOP=1 -f - <<'SQL'
$(cat "$RAG_SCHEMA_FILE")
SQL
    "
  ok "AI RAG corpus schema applied"
fi

say "=== Python AI Database Initialization Complete ==="
say "Database: $DB_NAME"
say "Host: $DB_HOST:$DB_PORT"
say "Schema: ai"
say ""
say "Tables created:"
echo "  - ai.predictions (prediction cache)"
echo "  - ai.inference_log (inference tracking)"
echo "  - ai.analytics_cache (analytics data cache)"
echo "  - ai.events (event log)"
echo "  - ai.model_metrics (model performance)"
echo "  - ai.ai_documents / ai.ai_document_chunks / ai.ai_ingestion_runs / ai.ai_rag_queries (RAG corpus)"

