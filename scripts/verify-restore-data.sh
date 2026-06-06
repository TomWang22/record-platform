#!/usr/bin/env bash
# Post-restore sanity for RP external Postgres (5433–5443). No booking DB (5443 is media).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-restore-outbox-contract.sh
source "$SCRIPT_DIR/lib/rp-restore-outbox-contract.sh"

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

psql_q() {
  psql -h "$PGHOST" -p "$1" -U postgres -d "$2" -tA -v ON_ERROR_STOP=1 -c "$3" 2>/dev/null
}

echo "verify-restore-data: row-count probes…"
auth_users="$(psql_q 5437 auth "SELECT count(*) FROM auth.users" || echo "")"
records_rows="$(psql_q 5433 records "SELECT count(*) FROM records.records" || echo "")"
listings_rows="$(psql_q 5435 listings "SELECT count(*) FROM listings.listings" || echo "")"
shopping_watchlist="$(psql_q 5436 shopping "SELECT count(*) FROM shopping.watchlist" || echo "")"

[[ -n "$auth_users" ]] || fail "auth DB (5437) unreachable"
echo "  auth.users rows: ${auth_users:-?}"
[[ -n "$records_rows" ]] && echo "  records.records rows: $records_rows"
[[ -n "$listings_rows" ]] && echo "  listings.listings rows: $listings_rows"
[[ -n "$shopping_watchlist" ]] && echo "  shopping.watchlist rows: $shopping_watchlist"

echo ""
echo "verify-restore-data: transactional outbox tables (11 services)…"
rp_restore_assert_outbox_tables || fail "one or more outbox_events tables missing after restore (see infra/db/*-outbox.sql)"

ok "restore data check passed (RP 5433–5443, outbox contract)"
