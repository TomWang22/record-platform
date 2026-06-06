#!/usr/bin/env bash
# Inspect external Postgres DBs (RP 5433–5443), write schema report to MD, and compare actual vs expected (infra/db).
# Usage: ./scripts/inspect-external-db-schemas.sh [report-dir]
#   report-dir defaults to reports/; report: report-dir/schema-report-<timestamp>.md
# Env: PGHOST (default 127.0.0.1), PGPASSWORD (default postgres). INSPECT_DBS overrides default 8-DB layout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

REPORT_BASE="${1:-reports}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$REPORT_BASE/schema-report-$TIMESTAMP.md"
mkdir -p "$REPORT_BASE"

# Default: RP runtime DB layout (ports 5433–5443). Format: port:dbname:label
if [[ -z "${INSPECT_DBS:-}" ]]; then
  INSPECT_DBS="5433:records:records
5434:messaging:messaging
5435:listings:listings
5436:shopping:shopping
5437:auth:auth
5438:postgres:auction_monitor_core
5439:analytics:analytics
5440:python_ai:python_ai
5441:notification:notification
5442:trust:trust
5443:media:media"
fi
if [[ -f "${INSPECT_DBS:-}" ]]; then
  DB_LIST="$(cat "$INSPECT_DBS")"
else
  DB_LIST="$INSPECT_DBS"
fi

# Expected tables per DB (schema.table) — keys match compose port (5433–5443).
expect_5433="records.records records.outbox_events"
expect_5434="messaging.conversations messaging.messages messaging.outbox_events"
expect_5435="listings.listings listings.outbox_events listings.processed_events"
expect_5436="shopping.shopping_cart shopping.watchlist shopping.outbox_events"
expect_5437="auth.users auth.sessions auth.mfa_settings auth.oauth_providers auth.passkeys auth.passkey_challenges auth.verification_codes auth.user_addresses auth.outbox_events"
expect_5438=""
expect_5439="analytics.events analytics.processed_events analytics.daily_metrics analytics.outbox_events"
expect_5440=""
expect_5441="notification.user_preferences notification.outbox_events"
expect_5442="trust.outbox_events trust.processed_events trust.reputation trust.user_spam_score"
expect_5443="media.media_files media.outbox_events"

echo "=== Inspect external DB schemas (RP 5433–5443) ==="
echo "Report: $REPORT_FILE"
echo ""

{
  echo "# External DB schema report — $TIMESTAMP"
  echo ""
  echo "Generated: $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
  echo ""
  echo "Host: \`$PGHOST\` (user: $PGUSER)."
  echo ""
  echo "Inspected DB targets:"
  echo ""
  echo "| Port | DB | Label |"
  echo "|------|----|-------|"
  while IFS= read -r _line; do
    [[ -z "$_line" ]] && continue
    _port="${_line%%:*}"
    _rest="${_line#*:}"
    _db="${_rest%%:*}"
    _label="${_rest#*:}"
    _label="${_label:-$_db}"
    echo "| \`$_port\` | \`$_db\` | \`$_label\` |"
  done <<< "$DB_LIST"
  echo ""
  echo "---"
  echo ""
} > "$REPORT_FILE"

all_match=0
any_connect_fail=0
any_schema_mismatch=0

_psql_list_tables() {
  local port="$1" dbname="$2"
  # Merge stderr into stdout so callers capture FATAL / connection errors (password masked in report).
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A -P pager=off -v ON_ERROR_STOP=1 -c "
    SELECT n.nspname || '.' || c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname;
  " 2>&1
}

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"

  echo "## Port $port — $label (\`$dbname\`)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  # Actual: list schema.table for user tables (retry: postgres-auth sometimes still recovering right after docker up)
  actual_tables=""
  actual_output=""
  psql_err=""
  list_ok=0
  for attempt in 1 2 3 4 5; do
    out=""
    if out=$(_psql_list_tables "$port" "$dbname"); then
      actual_output="$out"
      list_ok=1
      break
    fi
    psql_err="$out"
    [[ "$attempt" -lt 5 ]] && sleep 2
  done

  if [[ "$list_ok" -ne 1 ]]; then
    echo "*(connection or query failed after 5 attempts)*" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo '```text' >> "$REPORT_FILE"
    echo "$psql_err" | sed 's/password=[^ ]*/password=***/g' >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "**Hints:** Is \`docker compose up -d postgres-auth\` healthy? Try \`pg_isready -h $PGHOST -p $port\` and \`psql -h $PGHOST -p $port -U $PGUSER -d $dbname -c 'SELECT 1'\`." >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "  Inspected $port $dbname — FAILED (connect/query)"
    any_connect_fail=1
    all_match=1
    continue
  fi

  actual_tables=$(echo "$actual_output" | tr '\n' ' ')
  echo "### Actual tables (from DB)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -P pager=off -c "
    SELECT n.nspname AS schema, c.relname AS table_name, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname;
  " 2>/dev/null >> "$REPORT_FILE" || true
  echo "" >> "$REPORT_FILE"

  # Expected (from infra/db and auth dump)
  expected_var="expect_${port}"
  expected_tables="${!expected_var:-}"
  echo "### Expected tables (from infra/db and auth dump)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "| schema.table |" >> "$REPORT_FILE"
  echo "|--------------|" >> "$REPORT_FILE"
  for t in $expected_tables; do echo "| \`$t\` |" >> "$REPORT_FILE"; done
  echo "" >> "$REPORT_FILE"

  # Comparison
  echo "### Integrity check" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  missing=""
  for t in $expected_tables; do
    if echo " $actual_tables " | grep -qF " $t "; then
      : # present
    else
      missing="$missing $t"
    fi
  done
  if [[ -z "$missing" ]]; then
    echo "✅ **Match** — All expected tables present." >> "$REPORT_FILE"
    echo "  Inspected $port $dbname ($label) — OK"
  else
    echo "❌ **Mismatch** — Missing: \`${missing# }\`" >> "$REPORT_FILE"
    echo "  Inspected $port $dbname ($label) — MISMATCH"
    any_schema_mismatch=1
    all_match=1
  fi

  echo "" >> "$REPORT_FILE"
done <<< "$DB_LIST"

# Summary
{
  echo "---"
  echo ""
  echo "## Data integrity summary"
  echo ""
  if [[ $all_match -eq 0 ]]; then
    echo "✅ All DBs match expected schema (from infra/db and auth dump). Safe to run tests."
  else
    if [[ $any_connect_fail -ne 0 ]]; then
      echo "❌ One or more DBs could not be reached or returned an error on inspection (see sections above for \`psql\` output). This is usually Postgres still starting, wrong port, or auth DB down — not necessarily missing tables."
    fi
    if [[ $any_schema_mismatch -ne 0 ]]; then
      echo "❌ One or more DBs are missing expected tables. Fix bootstrap/migrations/restore before running tests."
    fi
    if [[ $any_connect_fail -eq 0 && $any_schema_mismatch -eq 0 ]]; then
      echo "❌ Inspection failed (see sections above)."
    fi
  fi
  echo ""
} >> "$REPORT_FILE"

echo ""
echo "Report: $REPORT_FILE"
exit $all_match
