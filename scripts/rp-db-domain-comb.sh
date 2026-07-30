#!/usr/bin/env bash
# Search all 11 RP Postgres DBs for forbidden RP/housing text in user-facing columns.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/domain-comb}"
REPORT="${REPORT:-$REPORT_DIR/rp-rp-db-comb.md}"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

declare -A PORT_DB=(
  [5433]=records
  [5434]=messaging
  [5435]=listings
  [5436]=shopping
  [5437]=auth
  [5438]=postgres
  [5439]=analytics
  [5440]=python_ai
  [5441]=notification
  [5442]=trust
  [5443]=media
)
declare -A PORT_LABEL=(
  [5438]=auction-monitor-core
  [5440]=python-ai
)
PORTS=(5433 5434 5435 5436 5437 5438 5439 5440 5441 5442 5443)

mkdir -p "$REPORT_DIR"

_run_psql() {
  local port="$1" db="$2" sql="$3"
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -At -c "$sql" 2>/dev/null
  else
    docker run --rm -e PGPASSWORD \
      postgres:16-alpine psql -h host.docker.internal -p "$port" -U "$PGUSER" -d "$db" -At -c "$sql" 2>/dev/null
  fi
}

TOKENS=(
  RP 'off-campus' housing landlord tenant booking apartment
  'Send in RP' guest host furnished 'off campus'
)

{
  echo "# RP/RP DB comb"
  echo ""
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Host: \`$PGHOST\`"
  echo ""
} >"$REPORT"

total_hits=0
plan=()

for port in "${PORTS[@]}"; do
  db="${PORT_DB[$port]}"
  label="${PORT_LABEL[$port]:-$db}"
  echo "## $label (port $port, db $db)" >>"$REPORT"
  db_hits=0

  cols="$(_run_psql "$port" "$db" "
    SELECT table_schema||'.'||table_name||'.'||column_name||'|'||data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema','bench')
      AND table_schema||'.'||table_name NOT IN (
        'listings.listing_revisions'
      )
      AND data_type IN ('text','character varying','character','json','jsonb','USER-DEFINED')
    ORDER BY 1;
  " || true)"

  [[ -z "$cols" ]] && echo "_unreachable or no columns_" >>"$REPORT" && echo "" >>"$REPORT" && continue

  while IFS= read -r colspec; do
    [[ -z "$colspec" ]] && continue
    schema_table_col="${colspec%%|*}"
    IFS='.' read -r schema table col <<<"$schema_table_col"
    for tok in "${TOKENS[@]}"; do
      cond="\"$col\"::text ILIKE '%${tok//\'/\'\'}%'"
      [[ "$tok" == "RP" ]] && cond="\"$col\"::text ~* '\\\\mOCH\\\\M'"
      sql="SELECT COUNT(*) FROM \"$schema\".\"$table\" WHERE $cond;"
      cnt="$(_run_psql "$port" "$db" "$sql" 2>/dev/null || echo "")"
      [[ -z "$cnt" || "$cnt" == "0" ]] && continue
      sample="$(_run_psql "$port" "$db" "
        SELECT LEFT(\"$col\"::text, 120) FROM \"$schema\".\"$table\" WHERE $cond LIMIT 1;
      " 2>/dev/null || echo "")"
      echo "- \`$schema.$table.$col\` token=\`$tok\` count=$cnt sample=\`${sample//\`/\\\`}\`" >>"$REPORT"
      db_hits=$((db_hits + 1))
      total_hits=$((total_hits + 1))
      plan+=("$label|$schema.$table|$col|$tok|$cnt")
    done
  done <<<"$cols"

  [[ "$db_hits" -eq 0 ]] && echo "_clean_" >>"$REPORT"
  echo "" >>"$REPORT"
done

{
  echo "## Remediation plan (no auto-delete)"
  echo ""
  if [[ ${#plan[@]} -eq 0 ]]; then
    echo "No rows matched forbidden tokens."
  else
    echo "Run \`scripts/rp-db-domain-cleanup.sh\` for seed/test fixtures, then re-run this comb."
    echo ""
    for row in "${plan[@]}"; do
      echo "- $row"
    done
  fi
  echo ""
  if [[ "$total_hits" -eq 0 ]]; then
    echo "## Summary"
    echo ""
    echo "**PASS** — no forbidden tokens in text columns."
  else
    echo "## Summary"
    echo ""
    echo "**FAIL** — $total_hits column/token hit(s). Cleanup required before PASS."
  fi
} >>"$REPORT"

if [[ "$total_hits" -gt 0 ]]; then
  echo "DB comb found $total_hits hit(s) — $REPORT (run rp-db-domain-cleanup.sh)" >&2
  exit 1
fi
echo "DB comb PASS — $REPORT"
exit 0
