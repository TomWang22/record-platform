#!/usr/bin/env bash
# Shared transactional-outbox contract for hybrid RP restore (ports 5433–5443).
# Source from verify-restore-data.sh and restore-rp-hybrid-backup.sh only.
#
# Rows (TSV): service_key<TAB>port<TAB>database<TAB>schema.table<TAB>sql_relpath
# Legacy RP snapshots (e.g. all-8-20260312) often omit outbox tables; post-restore SQL is idempotent.
rp_restore_outbox_contract_tsv() {
  cat <<'TSV'
records	5433	records	records.outbox_events	infra/db/01-records-outbox.sql
messaging	5434	messaging	messaging.outbox_events	infra/db/02-messaging-outbox.sql
listings	5435	listings	listings.outbox_events	infra/db/03-listings-outbox.sql
shopping	5436	shopping	shopping.outbox_events	infra/db/01-shopping-outbox.sql
auth	5437	auth	auth.outbox_events	infra/db/01-auth-outbox.sql
postgres_core	5438	postgres	auction_monitor.outbox_events	infra/db/01-auction-monitor-outbox.sql
analytics	5439	analytics	analytics.outbox_events	infra/db/03-analytics-outbox.sql
python_ai	5440	python_ai	ai.outbox_events	infra/db/01-ai-outbox.sql
notification	5441	notification	notification.outbox_events	infra/db/03-notification-outbox.sql
trust	5442	trust	trust.outbox_events	infra/db/03-trust-outbox.sql
media	5443	media	media.outbox_events	infra/db/02-media-outbox.sql
TSV
}

# Apply idempotent outbox DDL for a restored service (manifest service key).
rp_restore_apply_outbox_sql() {
  local svc="$1" port="$2" db="$3"
  local repo="${4:-}"
  [[ -n "$repo" ]] || return 0
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  local row sql_rel sql_path
  while IFS=$'\t' read -r key p d table sql_rel; do
    [[ "$key" == "$svc" ]] || continue
    [[ -n "$port" && "$p" != "$port" ]] && continue
    [[ -n "$db" && "$d" != "$db" ]] && continue
    sql_path="$repo/$sql_rel"
    if [[ ! -f "$sql_path" ]]; then
      echo "⚠️  outbox SQL missing for $svc: $sql_path" >&2
      return 1
    fi
    echo "Applying ${table} schema (post-restore) ← $sql_rel"
    psql -h "${PGHOST:-127.0.0.1}" -p "$p" -U "${PGUSER:-postgres}" -d "$d" -v ON_ERROR_STOP=1 -f "$sql_path"
    return 0
  done < <(rp_restore_outbox_contract_tsv)
  return 0
}

# Assert every contract outbox table exists (SELECT 1 probe).
rp_restore_assert_outbox_tables() {
  local pghost="${PGHOST:-127.0.0.1}"
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  local fail=0
  local key p db table sql_rel schema tbl
  while IFS=$'\t' read -r key p db table sql_rel; do
    schema="${table%%.*}"
    tbl="${table#*.}"
    if psql -h "$pghost" -p "$p" -U "${PGUSER:-postgres}" -d "$db" -tA -v ON_ERROR_STOP=1 -c \
      "SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = '$tbl' LIMIT 1;" 2>/dev/null | grep -q '^1$'; then
      echo "✅ outbox present: $table (port $p / $db)"
    else
      echo "❌ outbox missing: $table (port $p / $db) — run post-restore: $sql_rel" >&2
      fail=1
    fi
  done < <(rp_restore_outbox_contract_tsv)
  return "$fail"
}
