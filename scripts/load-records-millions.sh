#!/usr/bin/env bash
# Load millions of rows into records.records on port 5433 (for pgbench).
# Ensures benchmark user exists, then bulk-inserts. Run after DB is up; then run
# check-records-db.sh or run_pgbench_sweep.sh (which adds search_norm/search_tsv).
# Usage: TARGET_ROWS=2500000 ./scripts/load-records-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${RECORDS_DB_HOST:-localhost}"
DB_PORT="${RECORDS_DB_PORT:-5433}"
DB_USER="${RECORDS_DB_USER:-postgres}"
DB_NAME="${RECORDS_DB_NAME:-records}"
DB_PASS="${RECORDS_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
TARGET_ROWS="${TARGET_ROWS:-2500000}"
BATCH_SIZE="${BATCH_SIZE:-100000}"

echo "$(ts) === Load records.records to ~${TARGET_ROWS} rows (port $DB_PORT) ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

# Ensure records DB exists
_psql_connect postgres "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'records') THEN
    CREATE DATABASE records;
  END IF;
END \$\$;
" >/dev/null 2>&1 || true

# Ensure benchmark user exists in auth.users
psql -d records -c "
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE,
  password_hash TEXT,
  settings      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO auth.users (id, email) VALUES ('$BENCH_USER_UUID'::uuid, 'bench@record.local')
ON CONFLICT (id) DO NOTHING;
" 2>/dev/null || true

# Ensure records.records exists (created by migrations; do not replace)
if ! psql -d records -tAc "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
  echo "$(ts) records.records table missing. Run DB migrations (e.g. infra/db/03-database.sql) first." >&2
  exit 1
fi

CURRENT=$(psql -d records -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) Current rows: $CURRENT (target $TARGET_ROWS)"

if [[ "$CURRENT" -ge "$TARGET_ROWS" ]]; then
  echo "$(ts) Already at or above target. Done."
  exit 0
fi

NEED=$(( TARGET_ROWS - CURRENT ))
echo "$(ts) Inserting $NEED rows in batches of $BATCH_SIZE..."

INSERTED=0
BATCH=0
while [[ $INSERTED -lt $NEED ]]; do
  THIS_BATCH=$(( BATCH_SIZE < (NEED - INSERTED) ? BATCH_SIZE : (NEED - INSERTED) ))
  BATCH=$(( BATCH + 1 ))
  psql -d records -c "
INSERT INTO records.records (user_id, artist, name, format, catalog_number)
SELECT
  '$BENCH_USER_UUID'::uuid,
  CASE WHEN g.n % 50 = 0 THEN '鄧麗君' ELSE 'Artist ' || (g.n % 10000)::text END,
  CASE WHEN g.n % 50 = 0 THEN 'album 263 cn-041 polygram ' || g.n ELSE 'Name ' || g.n END,
  'LP',
  CASE WHEN g.n % 50 = 0 THEN 'cn-041-' || (g.n % 1000) ELSE 'CAT-' || (g.n % 100000) END
FROM generate_series(1, $THIS_BATCH) AS g(n);
" 2>/dev/null || { echo "$(ts) Batch $BATCH failed" >&2; break; }
  INSERTED=$(( INSERTED + THIS_BATCH ))
  echo "$(ts)   Batch $BATCH: +$THIS_BATCH (total inserted this run: $INSERTED)"
done

FINAL=$(psql -d records -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ')
echo "$(ts) Done. records.records row count: $FINAL"
echo "$(ts)   Run ./scripts/check-records-db.sh to verify. Then run run_pgbench_sweep.sh (it will add search_norm/search_tsv and indexes)."
