#!/usr/bin/env bash
# Restore all 8 Postgres instances from pg_dumpall SQL files.
# Naming matters: dump filename maps to Docker Compose container and host port.
# See docs/BACKUPS_AND_TUNING.md and README.md (Multi-Database Architecture).
#
# Usage: ./scripts/restore-all-databases-from-dumps.sh [BACKUP_DIR] [TIMESTAMP]
#   BACKUP_DIR  default: ./backups
#   TIMESTAMP   optional: e.g. 20260101-223214 to pick *-all-20260101-223214.sql files
#               If omitted, the script uses the latest timestamp present for each dump pattern.

set -Eeuo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP="${2:-}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"

# Dump filename prefix (before -<timestamp>.sql) → host port (must match docker-compose and README)
# Order: 5433..5440 for predictable output
DUMP_PATTERNS=(
  "record-platform-postgres-1-all:5433"
  "record-platform-postgres-social-1-all:5434"
  "record-platform-postgres-listings-1-all:5435"
  "record-platform-postgres-shopping-1-all:5436"
  "record-platform-postgres-auth-1-all:5437"
  "record-platform-postgres-auction-monitor-1-all:5438"
  "record-platform-postgres-analytics-1-all:5439"
  "record-platform-postgres-python-ai-1-all:5440"
)

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Error: Backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

echo "=== Restore all 8 databases from SQL dumps ==="
echo "Backup dir: $BACKUP_DIR"
echo "Timestamp filter: ${TIMESTAMP:-<latest per pattern>}"
echo ""

restored=0
failed=()

for entry in "${DUMP_PATTERNS[@]}"; do
  pattern="${entry%%:*}"
  port="${entry##*:}"
  if [[ -n "$TIMESTAMP" ]]; then
    f="$BACKUP_DIR/${pattern}-${TIMESTAMP}.sql"
  else
    f=$(find "$BACKUP_DIR" -maxdepth 1 -name "${pattern}-*.sql" -type f 2>/dev/null | sort -r | head -1)
  fi
  if [[ -z "$f" ]] || [[ ! -f "$f" ]]; then
    echo "⏭ Skip port $port: no dump for pattern ${pattern}-*.sql"
    continue
  fi
  echo "📦 Restoring port $port from $(basename "$f") ..."
  log="/tmp/restore-port-${port}.log"
  set +e
  PGPASSWORD="$PGPASSWORD" psql -h localhost -p "$port" -U "$PGUSER" -d postgres -f "$f" > "$log" 2>&1
  ret=$?
  set -e
  if [[ $ret -eq 0 ]]; then
    echo "   ✅ port $port done"
    ((restored++)) || true
  else
    echo "   ⚠️  port $port psql exit $ret (see $log)"
    failed+=("$port:$f")
  fi
done

echo ""
echo "Restored: $restored instances"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Check logs: /tmp/restore-port-<port>.log"
  for entry in "${failed[@]}"; do echo "  $entry"; done
  exit 1
fi
exit 0
