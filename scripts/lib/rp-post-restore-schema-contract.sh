#!/usr/bin/env bash
# Idempotent RP schema contract applied after hybrid restore (ports 5433–5443).
# Source from restore-rp-hybrid-backup.sh and audit-rp-db-schema-contract.sh.
#
# Rows (TSV): service_key port database required_table sql_relpath[,sql_relpath...]
rp_post_restore_schema_contract_tsv() {
  cat <<'TSV'
listings	5435	listings	listings.listing_revisions	infra/db/17-listing-revisions.sql
notification	5441	notification	notification.notifications	infra/db/01-notification-schema.sql
trust	5442	trust	trust.marketplace_feedback	infra/db/15-trust-marketplace-feedback.sql
messaging	5434	messaging	messages.messages	infra/db/03-messages-dm-schema.sql
TSV
}

rp_post_restore_apply_schema_sql() {
  local svc="$1" port="$2" db="$3"
  local repo="${4:-}"
  [[ -n "$repo" ]] || return 0
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  local row key p d table sql_list sql_rel sql_path
  while IFS=$'\t' read -r key p d table sql_list; do
    [[ "$key" == "$svc" ]] || continue
    [[ -n "$port" && "$p" != "$port" ]] && continue
    [[ -n "$db" && "$d" != "$db" ]] && continue
    IFS=',' read -ra sql_files <<<"$sql_list"
    for sql_rel in "${sql_files[@]}"; do
      sql_rel="${sql_rel#"${sql_rel%%[![:space:]]*}"}"
      sql_rel="${sql_rel%"${sql_rel##*[![:space:]]}"}"
      [[ -n "$sql_rel" ]] || continue
      sql_path="$repo/$sql_rel"
      if [[ ! -f "$sql_path" ]]; then
        echo "⚠️  schema SQL missing for $svc: $sql_path" >&2
        return 1
      fi
      echo "Applying ${table} bootstrap schema ← $sql_rel"
      psql -h "${PGHOST:-127.0.0.1}" -p "$p" -U "${PGUSER:-postgres}" -d "$d" -v ON_ERROR_STOP=1 -f "$sql_path"
    done
    return 0
  done < <(rp_post_restore_schema_contract_tsv)
  return 0
}

rp_post_restore_assert_schema_tables() {
  local pghost="${PGHOST:-127.0.0.1}"
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  local fail=0 key p db table sql_list schema tbl
  while IFS=$'\t' read -r key p db table sql_list; do
    schema="${table%%.*}"
    tbl="${table#*.}"
    if psql -h "$pghost" -p "$p" -U "${PGUSER:-postgres}" -d "$db" -tA -v ON_ERROR_STOP=1 -c \
      "SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = '$tbl' LIMIT 1;" 2>/dev/null | grep -q '^1$'; then
      echo "✅ schema present: $table (port $p / $db)"
    else
      echo "❌ schema missing: $table (port $p / $db) — expected after: $sql_list" >&2
      fail=1
    fi
  done < <(rp_post_restore_schema_contract_tsv)
  return "$fail"
}
