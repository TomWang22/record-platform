#!/usr/bin/env bash
# Run listings lifecycle migration (23) on the Postgres instance for port 5435.
# Prefer running inside the listings Postgres container to avoid host GSSAPI/psql issues.
# Otherwise tries database "listings" then "postgres" with PGOPTIONS (if supported).
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="${REPO_ROOT}/infra/db/23-listings-lifecycle-status.sql"

# Prefer docker exec into the listings postgres container (no GSSAPI, correct DB)
LISTINGS_CONTAINER=""
for name in record-platform-postgres-listings-1 postgres-listings; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"; then
    LISTINGS_CONTAINER="$name"
    break
  fi
done

if [[ -n "$LISTINGS_CONTAINER" ]]; then
  echo "Running migration in container $LISTINGS_CONTAINER (database listings)..."
  docker exec -i "$LISTINGS_CONTAINER" psql -U postgres -d listings -f - < "$MIGRATION"
  echo "Done."
  exit 0
fi

# Fallback: run from host (may hit GSSAPI on Mac; use -d listings)
export PGOPTIONS='-c gssencmode=disable' 2>/dev/null || true
export PGPASSWORD="${PGPASSWORD:-postgres}"
HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5435}"
USER="${PGUSER:-postgres}"

for DB in listings postgres; do
  if PGPASSWORD="$PGPASSWORD" psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'listings'" 2>/dev/null | grep -q 1; then
    echo "Running migration on database \"$DB\" (port $PORT)..."
    psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -f "$MIGRATION" 2>/dev/null || \
      env PGOPTIONS= psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -f "$MIGRATION"
    echo "Done."
    exit 0
  fi
done

echo "Error: No database on port $PORT has schema 'listings'. Create the listings DB and run 05-listings-schema.sql first."
echo "Or run migration inside the postgres container: docker exec -i record-platform-postgres-listings-1 psql -U postgres -d listings -f - < infra/db/23-listings-lifecycle-status.sql"
exit 1
