#!/usr/bin/env bash
# Create database "shopping" on port 5436 and run shopping migrations there.
# Use this so the shopping service can use 5436/shopping (intended) instead of 5436/records.
# See infra/docs/EIGHT-DATABASES-ARCHITECTURE.md.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PORT=5436
DB=shopping

# Create DB shopping on 5436 if it doesn't exist (run against postgres)
if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'" 2>/dev/null | grep -q 1; then
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE $DB;"
  echo "Created database $DB on port $PORT."
else
  echo "Database $DB on port $PORT already exists."
fi

# Run migrations in order on 5436/shopping
for f in infra/db/06-shopping-schema.sql infra/db/07-shopping-orders-migration.sql infra/db/08-shopping-notes-migration.sql; do
  if [[ -f "$f" ]]; then
    echo "Applying $f to $PORT/$DB..."
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PORT" -U postgres -d "$DB" -f "$f" || true
  fi
done

# Sequence and generate_order_number (09) — use ensure script so setval is correct
if [[ -f scripts/ensure-shopping-order-number-sequence.sh ]]; then
  echo "Running ensure-shopping-order-number-sequence.sh (applies 09 and syncs sequence)..."
  bash scripts/ensure-shopping-order-number-sequence.sh || true
fi

echo "Bootstrap done. Use POSTGRES_URL_SHOPPING=...:$PORT/$DB so the app uses 5436/shopping."
