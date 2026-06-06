#!/usr/bin/env bash
# Bundle all schema SQL for each DB into one file per DB (backup-like: apply one file to get full schema).
# Output: infra/db/bundles/<port>-<dbname>.sql
# Usage: ./scripts/bundle-db-schemas.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/infra/db/bundles"
mkdir -p "$BUNDLE_DIR"
cd "$REPO_ROOT"

# Bundle = list of infra/db/*.sql files in apply order (same as apply-external-db-schemas.sh)
bundle() {
  local out="$1"
  shift
  local files=("$@")
  echo "-- Bundled schema for $(basename "$out" .sql). Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ"). Do not edit; run scripts/bundle-db-schemas.sh to regenerate." > "$out"
  echo "" >> "$out"
  for f in "${files[@]}"; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
      echo "-- === $f ===" >> "$out"
      cat "$REPO_ROOT/$f" >> "$out"
      echo "" >> "$out"
    fi
  done
  echo "  ✅ $out"
}

echo "=== Bundling schema SQL (one file per DB) ==="

bundle "$BUNDLE_DIR/5433-records.sql" \
  infra/db/03-database.sql \
  infra/db/drop-records-user-id-fk.sql \
  infra/db/46-records-prisma-columns.sql \
  infra/db/10-content-hash-migrations.sql \
  infra/db/45-drop-unused-indexes-records.sql

bundle "$BUNDLE_DIR/5434-social.sql" \
  infra/db/04-social-schema.sql \
  infra/db/04-social-schema-upload-type-migration.sql \
  infra/db/04-social-schema-archive-recall-kickban.sql \
  infra/db/04-social-schema-roles-migration.sql \
  infra/db/04-social-schema-messages-standalone.sql \
  infra/db/18-social-messages-roles-leave.sql \
  infra/db/10-content-hash-migrations.sql

bundle "$BUNDLE_DIR/5435-listings.sql" \
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
  infra/db/20-listings-flag-notify-seller.sql

bundle "$BUNDLE_DIR/5436-shopping.sql" \
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
  infra/db/10-content-hash-migrations.sql

bundle "$BUNDLE_DIR/5437-auth.sql" \
  infra/db/07-auth-schema.sql \
  infra/db/07-auth-schema-extended.sql \
  infra/db/07-auth-passkeys.sql \
  infra/db/07-auth-user-addresses.sql

bundle "$BUNDLE_DIR/5438-postgres.sql" \
  infra/db/07-auction-monitor-schema.sql \
  infra/db/07-auction-monitor-schema-extended.sql

bundle "$BUNDLE_DIR/5439-analytics.sql" \
  infra/db/08-analytics-schema.sql

bundle "$BUNDLE_DIR/5440-python_ai.sql" \
  infra/db/09-python-ai-schema.sql

echo "Done. Apply with: psql -h HOST -p PORT -U postgres -d DBNAME -f infra/db/bundles/<port>-<dbname>.sql"
echo "See docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md and docs/SCHEMA_TABLE_BREAKDOWN.md"
