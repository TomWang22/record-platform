#!/usr/bin/env bash
# Load millions of rows into auth.users on port 5437 (for pgbench).
# Respects schema: email CITEXT UNIQUE, realistic-looking emails.
# Usage: TARGET_ROWS=1000000 ./scripts/load-auth-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${AUTH_DB_HOST:-localhost}"
DB_PORT="${AUTH_DB_PORT:-5437}"
DB_USER="${AUTH_DB_USER:-postgres}"
DB_NAME="${AUTH_DB_NAME:-records}"
DB_PASS="${AUTH_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_ROWS="${TARGET_ROWS:-1000000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"

echo "$(ts) === Load auth.users to ~${TARGET_ROWS} rows (port $DB_PORT) ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

# Ensure records DB and auth schema exist
_psql_connect postgres "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'records') THEN
    CREATE DATABASE records;
  END IF;
END \$\$;
" >/dev/null 2>&1 || true

psql -d records -c "CREATE SCHEMA IF NOT EXISTS auth;" 2>/dev/null || true
psql -d records -c "
CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT,
  settings      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON auth.users(created_at DESC);
" 2>/dev/null || true

CURRENT=$(psql -d records -tAc "SELECT count(*) FROM auth.users;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) Current rows: $CURRENT (target $TARGET_ROWS)"

if [[ "$CURRENT" -ge "$TARGET_ROWS" ]]; then
  echo "$(ts) Already at or above target. Done."
  exit 0
fi

NEED=$(( TARGET_ROWS - CURRENT ))
echo "Inserting $NEED rows in batches of $BATCH_SIZE (realistic emails)..."

INSERTED=0
BATCH=0
# Realistic-looking email prefixes/suffixes for variety
while [[ $INSERTED -lt $NEED ]]; do
  THIS_BATCH=$(( BATCH_SIZE < (NEED - INSERTED) ? BATCH_SIZE : (NEED - INSERTED) ))
  BATCH=$(( BATCH + 1 ))
  psql -d records -c "
INSERT INTO auth.users (email)
SELECT 'user-' || replace(gen_random_uuid()::text, '-', '') || '@' ||
  (ARRAY['example.com','mail.local','record.local','test.co','demo.org'])[1 + (g.n % 5)]
FROM generate_series(1, $THIS_BATCH) AS g(n);
" 2>/dev/null || { echo "$(ts) Batch $BATCH failed" >&2; break; }
  ROW_THIS=$(psql -d records -tAc "SELECT count(*) FROM auth.users;" 2>/dev/null | tr -d ' ')
  INSERTED=$(( ROW_THIS - CURRENT ))
  echo "$(ts)   Batch $BATCH: auth.users now $ROW_THIS (inserted this run: $INSERTED)"
  if [[ "$ROW_THIS" -ge "$TARGET_ROWS" ]]; then
    break
  fi
done

FINAL=$(psql -d records -tAc "SELECT count(*) FROM auth.users;" 2>/dev/null | tr -d ' ')
echo "$(ts) Done. auth.users row count: $FINAL"
echo "$(ts)   Run run_auth_pgbench_sweep.sh for benchmarking."
