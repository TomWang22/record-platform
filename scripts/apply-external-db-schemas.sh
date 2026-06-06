#!/usr/bin/env bash
# Apply schema/migration files to existing external DBs (ports 5433–5440). Does NOT create DBs.
# Use after ensure-external-databases-created.sh. Idempotent (SQL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
# See docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md for the full file list per DB.
#
# Usage:
#   ./scripts/apply-external-db-schemas.sh              # apply all
#   APPLY_RECORDS=0 ./scripts/apply-external-db-schemas.sh   # skip records
#   PGHOST=127.0.0.1 PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"

if ! command -v psql >/dev/null 2>&1; then
  echo "⚠️  psql not found. Install PostgreSQL client (brew install libpq)."
  exit 1
fi

_run() {
  local port="$1"
  local db="$2"
  shift 2
  local files=("$@")
  for f in "${files[@]}"; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
      if psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -f "$REPO_ROOT/$f" 2>/dev/null; then
        echo "  ✅ $f"
      else
        echo "  ❌ $f (failed)"
        return 1
      fi
    else
      echo "  ⚠️  $f (missing, skip)"
    fi
  done
  return 0
}

echo "=== Applying schemas to existing DBs (${PGHOST}:5433–5440) ==="

if [[ "${APPLY_RECORDS:-1}" == "1" ]]; then
  echo "--- 5433 records ---"
  _run 5433 records \
    infra/db/03-database.sql \
    infra/db/drop-records-user-id-fk.sql \
    infra/db/46-records-prisma-columns.sql \
    infra/db/10-content-hash-migrations.sql \
    infra/db/45-drop-unused-indexes-records.sql || true
fi

if [[ "${APPLY_SOCIAL:-1}" == "1" ]]; then
  echo "--- 5434 social ---"
  _run 5434 social \
    infra/db/04-social-schema.sql \
    infra/db/04-social-schema-upload-type-migration.sql \
    infra/db/04-social-schema-archive-recall-kickban.sql \
    infra/db/04-social-schema-roles-migration.sql \
    infra/db/04-social-schema-messages-standalone.sql \
    infra/db/18-social-messages-roles-leave.sql \
    infra/db/10-content-hash-migrations.sql || true
fi

if [[ "${APPLY_LISTINGS:-1}" == "1" ]]; then
  echo "--- 5435 listings ---"
  _run 5435 listings \
    infra/db/05-listings-schema.sql \
    infra/db/05-listings-schema-extended.sql \
    infra/db/05-listings-ratings-timezone.sql \
    infra/db/05-listings-timeline-duration.sql \
    infra/db/06-listings-display-preferences.sql \
    infra/db/08-listings-catalog-id-migration.sql \
    infra/db/08-listings-price-media.sql \
    infra/db/09-listings-reports.sql \
    infra/db/16-listings-seller-shipping-promotions.sql \
    infra/db/19-listings-seller-availability.sql \
    infra/db/20-listings-flag-notify-seller.sql || true
fi

if [[ "${APPLY_SHOPPING:-1}" == "1" ]]; then
  echo "--- 5436 shopping ---"
  _run 5436 shopping \
    infra/db/06-shopping-schema.sql \
    infra/db/07-shopping-orders-migration.sql \
    infra/db/08-shopping-notes-migration.sql \
    infra/db/09-shopping-order-number-sequence.sql \
    infra/db/07-shopping-watchlist-record-snapshot.sql \
    infra/db/07b-shopping-purchase-history-resellable.sql \
    infra/db/08-shopping-cart-tax-shipping.sql \
    infra/db/13-feedback-review-schema.sql \
    infra/db/14-shopping-cart-cost-calculation.sql \
    infra/db/15-shopping-notifications.sql \
    infra/db/17-shopping-price-alerts-saved-searches.sql \
    infra/db/10-content-hash-migrations.sql || true
fi

if [[ "${APPLY_AUTH:-1}" == "1" ]]; then
  echo "--- 5437 auth ---"
  _run 5437 auth \
    infra/db/07-auth-schema.sql \
    infra/db/07-auth-schema-extended.sql \
    infra/db/07-auth-passkeys.sql \
    infra/db/07-auth-user-addresses.sql || true
fi

if [[ "${APPLY_AUCTION:-1}" == "1" ]]; then
  echo "--- 5438 postgres (auction_monitor) ---"
  _run 5438 postgres \
    infra/db/07-auction-monitor-schema.sql \
    infra/db/07-auction-monitor-schema-extended.sql || true
fi

if [[ "${APPLY_ANALYTICS:-1}" == "1" ]]; then
  echo "--- 5439 analytics ---"
  _run 5439 analytics \
    infra/db/08-analytics-schema.sql || true
fi

if [[ "${APPLY_PYTHON_AI:-1}" == "1" ]]; then
  echo "--- 5440 python_ai ---"
  if [[ -f "$REPO_ROOT/infra/db/09-python-ai-schema.sql" ]]; then
    _run 5440 python_ai infra/db/09-python-ai-schema.sql || true
  else
    _run 5440 python_ai infra/db/python-ai-schema.sql || true
  fi
fi

echo "Done. See docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md for optional/cross-DB files."
