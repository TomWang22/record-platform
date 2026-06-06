#!/usr/bin/env bash
# Apply 09-shopping-order-number-sequence.sql on the shopping DB (port 5436).
# Replaces advisory-lock generate_order_number() with sequence-based to avoid checkout timeouts under pgbench.
# Safe to run multiple times. Called from preflight (3b4d) so migration is applied before any pgbench.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION="$REPO_ROOT/infra/db/09-shopping-order-number-sequence.sql"
PGHOST="${PGHOST:-127.0.0.1}"
SHOPPING_PORT="${SHOPPING_DB_PORT:-5436}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ ! -f "$MIGRATION" ]]; then
  warn "Order-number migration not found: $MIGRATION"
  exit 0
fi

for db in records postgres; do
  if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SHOPPING_PORT" -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SHOPPING_PORT" -U postgres -d "$db" -v ON_ERROR_STOP=0 -f "$MIGRATION" 2>/dev/null; then
      ok "Shopping order-number sequence applied (port $SHOPPING_PORT, db $db)"
    else
      warn "Order-number migration on shopping (port $SHOPPING_PORT, db $db) had issues (may be no-op)"
    fi
    exit 0
  fi
done
warn "Cannot connect to shopping DB at $PGHOST:$SHOPPING_PORT, skipping order-number migration"
exit 0
