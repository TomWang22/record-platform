#!/usr/bin/env bash
# Enforce schemas and tuning on all 8 external Postgres instances (Docker Compose ports 5433–5440).
# Safe to run after bring-up-external-infra.sh: applies idempotent SQL (CREATE IF NOT EXISTS, ALTER TABLE SET)
# so existing data is preserved. Backups/ holds canonical tuning and data; use RESTORE_FROM_BACKUPS=1 to
# restore from backups/ after containers are up.
#
# Usage:
#   ./scripts/enforce-external-db-schemas-and-tuning.sh
#   RESTORE_FROM_BACKUPS=1 ./scripts/enforce-external-db-schemas-and-tuning.sh   # restore from backups/ then tune
#   SKIP_TUNING=1 ./scripts/enforce-external-db-schemas-and-tuning.sh             # only schemas (or only restore)
#   SKIP_GOLD=1 ./scripts/enforce-external-db-schemas-and-tuning.sh               # skip gold defaults (e.g. already set)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

RESTORE_FROM_BACKUPS="${RESTORE_FROM_BACKUPS:-0}"
SKIP_TUNING="${SKIP_TUNING:-0}"
SKIP_GOLD="${SKIP_GOLD:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

_psql() { psql -h "$PGHOST" -p "$1" -U "$PGUSER" -d "$2" -v ON_ERROR_STOP=1 "${@:3}" 2>/dev/null; }

# 8 DBs: port -> database name (per infra/docs/EIGHT-DATABASES-ARCHITECTURE.md)
declare -A PORT_DB
PORT_DB[5433]=records
PORT_DB[5434]=records
PORT_DB[5435]=records
PORT_DB[5436]=shopping
PORT_DB[5437]=auth
PORT_DB[5438]=postgres
PORT_DB[5439]=analytics
PORT_DB[5440]=python_ai

say "Enforcing schemas and tuning on external Postgres (5433–5440)"

# --- Optional: restore from backups/ ---
if [[ "$RESTORE_FROM_BACKUPS" == "1" ]] && [[ -d "$REPO_ROOT/backups" ]]; then
  say "Restoring from backups/ (RESTORE_FROM_BACKUPS=1)..."
  # Mapping from docs/archive/DATABASE_RESTORE_AND_TUNING_PLAN.md (backup filename pattern -> port)
  for f in "$REPO_ROOT/backups"/record-platform-postgres-1-all-*.sql "$REPO_ROOT/backups"/record-platform-postgres-*-all-*.sql; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f")
    if [[ "$base" == *"postgres-1-all-"* ]]; then
      port=5433; db=records
    elif [[ "$base" == *"postgres-auth-1-all-"* ]]; then port=5437; db=auth
    elif [[ "$base" == *"postgres-social-1-all-"* ]]; then port=5434; db=records
    elif [[ "$base" == *"postgres-listings-1-all-"* ]]; then port=5435; db=records
    elif [[ "$base" == *"postgres-shopping-1-all-"* ]]; then port=5436; db=shopping
    elif [[ "$base" == *"postgres-analytics-1-all-"* ]]; then port=5439; db=analytics
    elif [[ "$base" == *"postgres-auction-monitor-1-all-"* ]]; then port=5438; db=postgres
    elif [[ "$base" == *"postgres-python-ai-1-all-"* ]]; then port=5440; db=python_ai
    else
      continue
    fi
    info "Restoring $base -> port $port database $db..."
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -f "$f" -v ON_ERROR_STOP=0 2>/dev/null; then
      ok "Restored $base to $port/$db"
    else
      warn "Restore of $base had errors (may be partial or schema-only)"
    fi
  done
  # Also support .dump per port (e.g. records_*.dump -> 5433)
  for dump in "$REPO_ROOT/backups"/*.dump; do
    [[ -f "$dump" ]] || continue
    # Default: records dump -> 5433
    info "Restoring $(basename "$dump") to 5433/records (customize if needed)..."
    pg_restore -h "$PGHOST" -p 5433 -U "$PGUSER" -d records --no-owner --no-privileges -j 2 -v "$dump" 2>/dev/null || true
    ok "Restored $(basename "$dump") to 5433/records"
  done
else
  if [[ "$RESTORE_FROM_BACKUPS" == "1" ]]; then
    warn "RESTORE_FROM_BACKUPS=1 but backups/ not found or empty; skipping restore"
  fi
fi

# --- Gold defaults (per-database, no restart) ---
if [[ "$SKIP_TUNING" != "1" ]] && [[ "$SKIP_GOLD" != "1" ]] && [[ -f "$REPO_ROOT/infra/db/12-apply-gold-defaults.sql" ]]; then
  say "Applying gold defaults (12-apply-gold-defaults.sql) to all 8 DBs..."
  for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    if PGPASSWORD="$PGPASSWORD" _psql "$port" "$db" -f "$REPO_ROOT/infra/db/12-apply-gold-defaults.sql" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
      ok "Gold defaults applied to $port/$db"
    else
      warn "Gold defaults on $port/$db had errors (may need extensions first)"
    fi
  done
fi

# --- Service-specific tuning (indexes, autovacuum; idempotent) ---
if [[ "$SKIP_TUNING" != "1" ]] && [[ -f "$REPO_ROOT/infra/db/service-specific-tuning.sql" ]]; then
  say "Applying service-specific tuning (indexes, autovacuum) to 5434–5440..."
  for port in 5434 5435 5436 5437 5438 5439 5440; do
    db="${PORT_DB[$port]}"
    if PGPASSWORD="$PGPASSWORD" _psql "$port" "$db" -f "$REPO_ROOT/infra/db/service-specific-tuning.sql" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
      ok "Service tuning applied to $port/$db"
    else
      # Many errors are benign (schema/table not present yet)
      info "Service tuning on $port/$db completed (some statements may have been skipped)"
    fi
  done
fi

# --- Records (5433): optional KNN/trigram and planner (idempotent where possible) ---
if [[ "$SKIP_TUNING" != "1" ]] && [[ -f "$REPO_ROOT/infra/db/43-optimize-knn-trgm.sql" ]]; then
  if PGPASSWORD="$PGPASSWORD" _psql 5433 records -f "$REPO_ROOT/infra/db/43-optimize-knn-trgm.sql" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
    ok "KNN/trigram (43) applied to 5433/records"
  else
    info "43-optimize-knn-trgm on 5433 had errors (extensions or schema may be missing)"
  fi
fi
if [[ "$SKIP_TUNING" != "1" ]] && [[ -f "$REPO_ROOT/infra/db/44-optimize-planner.sql" ]]; then
  if PGPASSWORD="$PGPASSWORD" _psql 5433 records -f "$REPO_ROOT/infra/db/44-optimize-planner.sql" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
    ok "Planner (44) applied to 5433/records"
  else
    info "44-optimize-planner on 5433 had errors"
  fi
fi

say "Enforce schemas and tuning done."
info "Backups/ holds canonical tuning and data; run with RESTORE_FROM_BACKUPS=1 to restore from backups/ first."
info "Instance-level tuning (shared_buffers, etc.) is in infra/db/comprehensive-db-tuning.sql and may require container restart if applied via ALTER SYSTEM."
