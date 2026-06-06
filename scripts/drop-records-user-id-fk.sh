#!/usr/bin/env bash
# Drop records.records -> auth.users FK (untangle). Auth 5437, records 5433.
# Run once after 03-database.sql. Optional: pipeline runs this before suites.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="${REPO_ROOT}/infra/db/drop-records-user-id-fk.sql"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

say "Dropping records_user_id_fkey (untangle records / auth)"
if [[ ! -f "$SQL" ]]; then
  warn "SQL not found: $SQL"
  exit 1
fi

if PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -f "$SQL" 2>/dev/null; then
  ok "FK dropped"
else
  warn "Drop FK failed (run manually: psql ... -f $SQL)"
  exit 1
fi
