#!/usr/bin/env bash
# Restore external Postgres from hybrid manifest (port contract v2).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${1:-}"
[[ -n "$BACKUP_DIR" ]] || { echo "Usage: $0 <hybrid-assembled-dir>" >&2; exit 1; }
[[ -d "$BACKUP_DIR" ]] || { echo "Not a directory: $BACKUP_DIR" >&2; exit 1; }
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
MANIFEST="$BACKUP_DIR/manifest.json"
[[ -f "$MANIFEST" ]] || { echo "manifest.json not found under $BACKUP_DIR" >&2; exit 1; }

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# shellcheck source=lib/rp-restore-outbox-contract.sh
source "$SCRIPT_DIR/lib/rp-restore-outbox-contract.sh"

rp_terminate_db_sessions() {
  local port="$1" db="$2"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=0 -q -t -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" 2>/dev/null || true
}

_restore_file() {
  local port="$1" db="$2" dump="$3" admin_db="postgres"
  [[ -f "$dump" ]] || { warn "missing dump: $dump"; return 1; }
  # Cannot DROP DATABASE postgres while connected to postgres — use template1.
  [[ "$db" == "postgres" ]] && admin_db="template1"
  rp_terminate_db_sessions "$port" "$db"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$admin_db" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$admin_db" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
  if [[ "$port" == "5439" ]]; then
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=0 -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || \
      warn "analytics: pgvector extension unavailable — restore may skip listing_search_index"
  fi
  if [[ "$dump" == *.dump ]]; then
    pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" --no-owner --no-privileges "$dump" 2>/dev/null || true
  elif [[ "$dump" == *.sql.gz ]]; then
    gunzip -c "$dump" | psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 2>/dev/null || true
  else
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$dump" 2>/dev/null || true
  fi
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "ANALYZE;" 2>/dev/null || true
  ok "$db on port $port"
}

say "=== Restore RP hybrid backup (port contract v2) ==="
echo "BACKUP_DIR=$BACKUP_DIR"
echo "MANIFEST=$MANIFEST"
echo ""

python3 - "$MANIFEST" <<'PY' || true
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    doc = json.load(f)
for a in doc.get("assignments", []):
    if a.get("active"):
        print(f"restore {a['service']}: {a['target_port']}")
for name, reason in [
    ("booking", "not in RP 11-DB contract"),
    ("social", "port 5434 is messaging at runtime"),
    ("legacy_auth", "auth restored from 5437 only"),
    ("legacy_analytics", "analytics on runtime 5439 only"),
]:
    print(f"restore {name}: skipped — {reason}")
PY

mapfile -t rows < <(python3 - "$MANIFEST" <<'PY'
import json, os, sys
with open(sys.argv[1], encoding="utf-8") as f:
    doc = json.load(f)
order = doc.get("restore_order") or []
seen = set()
for svc in order:
    if svc in seen or svc in doc.get("excluded_services", []):
        continue
    seen.add(svc)
    for a in doc.get("assignments", []):
        if a.get("service") != svc or not a.get("active", True):
            continue
        lp = a.get("materialized_path") or a.get("link_path", "")
        if lp and os.path.lexists(lp):
            lp = os.path.realpath(lp)
        print("\t".join([
            svc, lp, a.get("note", ""), str(a.get("target_port", "")),
            a.get("target_database", ""), a.get("policy_key", ""),
        ]))
        break
PY
)

for row in "${rows[@]}"; do
  IFS=$'\t' read -r svc dump note port db pkey <<<"$row"
  if [[ -z "$port" || -z "$dump" || ! -f "$dump" ]]; then
    warn "restore $svc: skip (port=$port dump=${dump:-missing})"
    continue
  fi
  echo "restore $svc: $port ← $(basename "$dump")"
  _restore_file "$port" "$db" "$dump"
  if [[ "$svc" == "listings" ]]; then
    overlay="$REPO_ROOT/backups/hybrid-rp-och/post-restore/5435-listings-rp-overlay.sql"
    if [[ -f "$overlay" ]]; then
      say "Applying listings RP overlay (post-restore)"
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$overlay" || warn "listings overlay had errors (review schema)"
    fi
  fi
  if ! rp_restore_apply_outbox_sql "$svc" "$port" "$db" "$REPO_ROOT"; then
    warn "post-restore outbox SQL failed for $svc (port $port) — review infra/db/*-outbox.sql"
  fi
  # shellcheck source=scripts/lib/rp-post-restore-schema-contract.sh
  source "$REPO_ROOT/scripts/lib/rp-post-restore-schema-contract.sh"
  if ! rp_post_restore_apply_schema_sql "$svc" "$port" "$db" "$REPO_ROOT"; then
    warn "post-restore schema SQL failed for $svc (port $port) — review scripts/lib/rp-post-restore-schema-contract.sh"
  fi
done

say "RP runtime restore complete"
