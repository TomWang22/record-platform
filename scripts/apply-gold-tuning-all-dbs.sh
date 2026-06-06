#!/usr/bin/env bash
# Apply gold performance defaults (12-apply-gold-defaults.sql) to every database on ports 5433–5440.
# Same tuning as port 5433 so all DBs target sub-20ms with index-first planner.
# Usage: ./scripts/apply-gold-tuning-all-dbs.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

GOLD="$REPO_ROOT/infra/db/12-apply-gold-defaults.sql"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"

ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

[[ ! -f "$GOLD" ]] && { warn "Missing $GOLD"; exit 1; }

# port -> list of database names to tune
for spec in "5433:records" "5434:social" "5435:listings" "5436:shopping" "5437:auth" "5438:postgres" "5439:analytics" "5440:python_ai"; do
  port="${spec%%:*}"
  db="${spec#*:}"
  if ! PGCONNECT_TIMEOUT="$PGCONNECT_TIMEOUT" psql -h "$PGHOST" -p "$port" -U postgres -d postgres -tAc "SELECT 1" 2>/dev/null | grep -q 1; then
    warn "Port $port not reachable; skip."
    continue
  fi
  if PGCONNECT_TIMEOUT="$PGCONNECT_TIMEOUT" psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -f "$GOLD" -v ON_ERROR_STOP=0 2>/dev/null; then
    ok "Gold defaults applied on $port/$db"
  else
    warn "Gold apply had issues on $port/$db"
  fi
done
