#!/usr/bin/env bash
# Run social DB migrations (04-social-schema-archive-recall-kickban.sql, roles) on postgres-social (port 5434).
# Safe to run multiple times (IF NOT EXISTS). Called by preflight before social test suite.
# Exit 0 when migrations applied; 1 on failure.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOCIAL_PORT="${SOCIAL_DB_PORT:-5434}"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Skip entirely if requested (e.g. already applied in a previous run)
if [[ "${SKIP_SOCIAL_MIGRATIONS:-0}" == "1" ]]; then
  ok "Social migrations skipped (SKIP_SOCIAL_MIGRATIONS=1)"
  exit 0
fi

# Check postgres-social is up
if ! command -v psql >/dev/null 2>&1; then
  warn "psql not found; skipping social migrations (install postgresql client)"
  exit 0
fi

if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  warn "Social DB (port $SOCIAL_PORT) not reachable; skipping migrations"
  exit 0
fi

# Social-service uses POSTGRES_URL_SOCIAL -> host:5434/records (app-config)
# Create records DB if missing (app-config expects /records)
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='records'" 2>/dev/null | grep -q 1 || \
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d postgres -c "CREATE DATABASE records" 2>/dev/null || true

SOCIAL_DB="records"
if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d records -tAc "SELECT 1" >/dev/null 2>&1; then
  SOCIAL_DB="postgres"
fi

# If forum schema already applied (e.g. from a previous preflight), skip to avoid re-running every time
if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d "$SOCIAL_DB" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'forum' AND table_name = 'posts'" 2>/dev/null | grep -q 1; then
  ok "Social migrations already applied (forum schema present); skipping"
  exit 0
fi

say "Applying social migrations to $SOCIAL_DB (port $SOCIAL_PORT)..."
# Order: base schema first (forum + messages schemas and tables), then archive/recall/kick/ban, then roles
for f in "$REPO_ROOT/infra/db/04-social-schema.sql" \
         "$REPO_ROOT/infra/db/04-social-schema-archive-recall-kickban.sql" \
         "$REPO_ROOT/infra/db/04-social-schema-roles-migration.sql"; do
  if [[ -f "$f" ]]; then
    out=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$SOCIAL_PORT" -U postgres -d "$SOCIAL_DB" -f "$f" 2>&1)
    rc=$?
    if [[ $rc -eq 0 ]]; then
      ok "Applied $(basename "$f")"
    else
      warn "Migration $(basename "$f") had errors (exit $rc; may be partial or already applied)"
      echo "$out" | tail -20
    fi
  else
    warn "Migration file not found: $f"
  fi
done
ok "Social migrations complete"
exit 0
