#!/usr/bin/env bash
# Apply content-hash migrations (10-content-hash-migrations.sql) on DBs that have long text.
# Runs on: records (5433), social (5434), shopping (5436). Each DB only applies schema it has.
# Safe to run multiple times. Called from preflight after Postgres and social migrations are up.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION="$REPO_ROOT/infra/db/10-content-hash-migrations.sql"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ ! -f "$MIGRATION" ]]; then
  warn "Content-hash migration not found: $MIGRATION"
  exit 0
fi

# Records (5433), social (5434), shopping (5436/shopping) - each may use db "records", "shopping", or "postgres"
for port in 5433 5434 5436; do
  name="records"
  [[ "$port" == "5434" ]] && name="social"
  [[ "$port" == "5436" ]] && name="shopping"
  for db in records postgres; do
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
      if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -f "$MIGRATION" 2>/dev/null; then
        ok "Content-hash migration applied on $name (port $port, db $db)"
      else
        warn "Content-hash migration on $name (port $port, db $db) had issues (may be no-op)"
      fi
      break
    fi
  done
done
exit 0
