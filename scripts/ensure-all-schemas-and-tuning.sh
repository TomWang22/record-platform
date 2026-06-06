#!/usr/bin/env bash
# Ensure all 8 Postgres instances (ports 5433–5440) have the correct databases and schemas
# per docs/CURRENT_DB_SCHEMA_REPORT.md and infra/docs/EIGHT-DATABASES-ARCHITECTURE.md.
# Run from repo root. Requires: psql, PGPASSWORD=postgres, Postgres containers up on 5433–5440.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${PGHOST:=localhost}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

run_psql() {
  local port="$1" db="$2" desc="${3:-}"
  shift 3
  local f
  for f in "$@"; do
    [[ -z "$f" ]] && continue
    if [[ -f "$ROOT/infra/db/$f" ]]; then
      [[ -n "$desc" ]] && echo "  → $f ($desc)"
      PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -f "$ROOT/infra/db/$f" -v ON_ERROR_STOP=1 || { warn "Failed: $f on $db@$port"; return 1; }
    else
      warn "Skip (missing): infra/db/$f"
    fi
  done
  return 0
}

create_db() {
  local port="$1" dbname="$2"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -tc "
    SELECT 1 FROM pg_database WHERE datname = '$dbname'
  " | grep -q 1 || \
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -c "CREATE DATABASE $dbname;"
}

say "=== Ensuring all databases and schemas (5433–5440) ==="

# Pre-check: Postgres on 5433 must be reachable (Docker Compose). Retry a few times so we don't fail
# right after bring-up when containers are "health: starting".
_precheck_attempt=1
_precheck_max=6
while [[ $_precheck_attempt -le $_precheck_max ]]; do
  if PGCONNECT_TIMEOUT=5 PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5433 -U "$PGUSER" -d postgres -c "SELECT 1" -t -q 2>/dev/null; then
    break
  fi
  if [[ $_precheck_attempt -eq $_precheck_max ]]; then
    warn "Cannot reach Postgres at ${PGHOST}:5433 after ${_precheck_max} attempts. Start Docker Compose first:"
    echo "  docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai"
    warn "If using Colima for k8s, start it first: colima start"
    exit 1
  fi
  warn "Postgres not ready (attempt $_precheck_attempt/$_precheck_max); waiting 5s..."
  sleep 5
  _precheck_attempt=$((_precheck_attempt + 1))
done

# --- 5433 records ---
say "Port 5433 — records"
# 03-database.sql uses SET ROLE record_owner; we run as postgres so skip first line to avoid permission denied
create_db 5433 records
( tail -n +2 "$ROOT/infra/db/03-database.sql" | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p 5433 -U "$PGUSER" -d records -v ON_ERROR_STOP=1 ) || { warn "Failed: 03-database.sql on records@5433"; exit 1; }
[[ -f "$ROOT/infra/db/11-catalog-data-lake-model.sql" ]] && run_psql 5433 records "catalog" 11-catalog-data-lake-model.sql || true
run_psql 5433 records "prisma" 46-records-prisma-columns.sql
ok "5433/records"

# --- 5434 social ---
say "Port 5434 — social"
create_db 5434 social
run_psql 5434 social "forum/messages" 04-social-schema.sql
[[ -f "$ROOT/infra/db/04-social-schema-messages-standalone.sql" ]] && run_psql 5434 social "messages" 04-social-schema-messages-standalone.sql || true
[[ -f "$ROOT/infra/db/04-social-schema-archive-recall-kickban.sql" ]] && run_psql 5434 social "archive/delete/recall/kickban" 04-social-schema-archive-recall-kickban.sql || true
[[ -f "$ROOT/infra/db/04-social-schema-roles-migration.sql" ]] && run_psql 5434 social "roles" 04-social-schema-roles-migration.sql || true
[[ -f "$ROOT/infra/db/18-social-messages-roles-leave.sql" ]] && run_psql 5434 social "leave" 18-social-messages-roles-leave.sql || true
ok "5434/social"

# --- 5435 listings ---
say "Port 5435 — listings"
create_db 5435 listings
run_psql 5435 listings "base" 05-listings-schema.sql
for f in 05-listings-timeline-duration.sql 05-listings-schema-extended.sql 05-listings-ratings-timezone.sql 06-listings-display-preferences.sql 08-listings-price-media.sql 08-listings-catalog-id-migration.sql 09-listings-reports.sql 16-listings-seller-shipping-promotions.sql 19-listings-seller-availability.sql 20-listings-flag-notify-seller.sql 21-listings-returns.sql 23-listings-lifecycle-status.sql; do
  [[ -f "$ROOT/infra/db/$f" ]] && run_psql 5435 listings "" "$f" || true
done
ok "5435/listings"

# --- 5436 shopping ---
say "Port 5436 — shopping"
create_db 5436 shopping
run_psql 5436 shopping "base" 06-shopping-schema.sql
run_psql 5436 shopping "orders" 07-shopping-orders-migration.sql
run_psql 5436 shopping "notes" 08-shopping-notes-migration.sql
run_psql 5436 shopping "order number" 09-shopping-order-number-sequence.sql
[[ -f "$ROOT/infra/db/13-feedback-review-schema.sql" ]] && run_psql 5436 shopping "feedback" 13-feedback-review-schema.sql || true
for f in 07-shopping-watchlist-record-snapshot.sql 07b-shopping-purchase-history-resellable.sql 08-shopping-cart-tax-shipping.sql 14-shopping-cart-cost-calculation.sql 15-shopping-notifications.sql 17-shopping-price-alerts-saved-searches.sql 21-shopping-shipments-tracking.sql 22-shopping-returns.sql; do
  [[ -f "$ROOT/infra/db/$f" ]] && run_psql 5436 shopping "" "$f" || true
done
ok "5436/shopping"

# --- 5437 auth ---
say "Port 5437 — auth"
create_db 5437 auth
run_psql 5437 auth "base" 07-auth-schema.sql
run_psql 5437 auth "extended" 07-auth-schema-extended.sql
[[ -f "$ROOT/infra/db/07-auth-user-addresses.sql" ]] && run_psql 5437 auth "addresses" 07-auth-user-addresses.sql || true
[[ -f "$ROOT/infra/db/07-auth-passkeys.sql" ]] && run_psql 5437 auth "passkeys" 07-auth-passkeys.sql || true
ok "5437/auth"

# --- 5438 auction-monitor (uses default DB postgres) ---
say "Port 5438 — auction-monitor (postgres)"
run_psql 5438 postgres "auction_monitor schema" 07-auction-monitor-schema.sql
[[ -f "$ROOT/infra/db/07-auction-monitor-schema-extended.sql" ]] && run_psql 5438 postgres "" 07-auction-monitor-schema-extended.sql || true
ok "5438/postgres (auction_monitor)"

# --- 5439 analytics ---
say "Port 5439 — analytics"
create_db 5439 analytics
run_psql 5439 analytics "schema" 08-analytics-schema.sql
ok "5439/analytics"

# --- 5440 python_ai ---
say "Port 5440 — python_ai"
create_db 5440 python_ai
run_psql 5440 python_ai "schema" 09-python-ai-schema.sql
[[ -f "$ROOT/infra/db/python-ai-schema.sql" ]] && run_psql 5440 python_ai "inference_log/predictions/events" python-ai-schema.sql || true
ok "5440/python_ai"

say "=== Optional: service-specific tuning ==="
if [[ -f "$ROOT/infra/db/tuning-social.sql" ]]; then
  run_psql 5434 social "tuning (social only)" tuning-social.sql || true
  ok "Tuning applied where supported"
fi
# service-specific-tuning.sql references messages/auth/analytics/auction_monitor/ai; only social has messages.
# Run tuning-social.sql on 5434 only; full service-specific-tuning.sql left for manual/per-service use.

say "Done. Refresh report: ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md"
