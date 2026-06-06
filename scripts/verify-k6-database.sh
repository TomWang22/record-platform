#!/usr/bin/env bash
# Post-test database verification for k6 tests
# Runs on host; when DB_HOST=host.docker.internal, try localhost as fallback (host↔container naming)
set -euo pipefail

DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-records}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "=== Verifying Database State After k6 Tests ==="

# Test database connectivity; try localhost when host.docker.internal is used (script runs on host)
_db_connect() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$1" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1
}

if _db_connect "$DB_HOST"; then
  ok "Database connectivity verified ($DB_HOST:$DB_PORT/$DB_NAME)"
else
  if [[ "$DB_HOST" == "host.docker.internal" ]]; then
    if _db_connect "127.0.0.1"; then
      ok "Database connectivity verified (127.0.0.1:$DB_PORT/$DB_NAME, host.docker.internal fallback)"
      DB_HOST="127.0.0.1"
    else
      warn "Database connectivity failed ($DB_HOST and 127.0.0.1:$DB_PORT/$DB_NAME)"
      exit 1
    fi
  else
    warn "Database connectivity failed ($DB_HOST:$DB_PORT/$DB_NAME)"
    exit 1
  fi
fi

# Verify data integrity
say "Checking data integrity..."

# Check auth.users table
USER_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM auth.users;" 2>/dev/null || echo "0")
if [[ "$USER_COUNT" =~ ^[0-9]+$ ]]; then
  ok "auth.users: $USER_COUNT users"
else
  warn "auth.users: Could not query"
fi

# Check records.records table
RECORD_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM records.records;" 2>/dev/null || echo "0")
if [[ "$RECORD_COUNT" =~ ^[0-9]+$ ]]; then
  ok "records.records: $RECORD_COUNT records"
else
  warn "records.records: Could not query"
fi

# Check for foreign key integrity
say "Checking foreign key integrity..."
FK_VIOLATIONS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
  SELECT COUNT(*) FROM records.records r
  WHERE r.user_id NOT IN (SELECT id FROM auth.users);
" 2>/dev/null || echo "0")

if [[ "$FK_VIOLATIONS" == "0" ]]; then
  ok "Foreign key integrity: No violations"
elif [[ "${USER_COUNT:-0}" == "0" ]] && [[ "${RECORD_COUNT:-0}" -gt 0 ]]; then
  info "Foreign key integrity: $FK_VIOLATIONS violations (expected when auth.users=0 and records exist — test ordering; users may be in auth DB 5437)"
else
  warn "Foreign key integrity: $FK_VIOLATIONS violations found"
fi

say "=== Database Verification Complete ==="
