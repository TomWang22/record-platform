#!/usr/bin/env bash
# Create database "auth" on port 5437 and run auth migrations there.
# Auth-service uses POSTGRES_URL_AUTH=...:5437/auth (see infra/k8s/base/config/app-config.yaml).
# Run once: ./scripts/bootstrap-auth-db-on-5437.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PORT=5437
DB=auth

if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'" 2>/dev/null | grep -q 1; then
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE $DB;"
  echo "Created database $DB on port $PORT."
else
  echo "Database $DB on port $PORT already exists."
fi

for f in infra/db/07-auth-schema.sql infra/db/07-auth-schema-extended.sql infra/db/07-auth-passkeys.sql; do
  if [[ -f "$f" ]]; then
    echo "Applying $f to $PORT/$DB..."
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -f "$f" 2>/dev/null || true
  fi
done

echo "Bootstrap done. Auth-service should use POSTGRES_URL_AUTH=...:$PORT/$DB"
