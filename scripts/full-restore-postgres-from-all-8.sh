#!/usr/bin/env bash
# Full restore of all 8 external Postgres DBs from an all-8 backup bundle.
# Ensures DB names exist, then restores from the given backup dir (or suffix like 20260306-040148).
#
# Usage:
#   PGPASSWORD=postgres ./scripts/full-restore-postgres-from-all-8.sh 20260306-040148
#   PGPASSWORD=postgres ./scripts/full-restore-postgres-from-all-8.sh backups/all-8-20260306-040148
#
# Prereqs: Postgres containers on 127.0.0.1:5433–5440 (e.g. docker compose up -d for postgres).
# See docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_ARG="${1:-}"
if [[ -z "$BACKUP_ARG" ]]; then
  echo "Usage: $0 <backup_dir_or_suffix>" >&2
  echo "  e.g. $0 20260306-040148" >&2
  echo "  e.g. $0 backups/all-8-20260306-040148" >&2
  exit 1
fi

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"

echo "=== Full restore from all-8 backup ==="
echo ""

echo "Step 1: Ensure external databases exist (ports 5433–5440)..."
"$SCRIPT_DIR/ensure-external-databases-created.sh" || true
echo ""

echo "Step 2: Restore all 8 DBs from backup..."
BACKUP_DIR="$BACKUP_ARG" "$SCRIPT_DIR/restore-all-8-from-backup.sh"
echo ""

echo "=== Restore complete ==="
echo "Verify: PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md"
