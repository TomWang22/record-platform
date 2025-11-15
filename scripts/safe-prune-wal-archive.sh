#!/usr/bin/env bash
set -Eeuo pipefail

# Safely prune old WAL archives
# Usage: ./scripts/safe-prune-wal-archive.sh [days_to_keep]
# Default: keeps WAL archives from last 7 days

NS="${NS:-record-platform}"
DAYS_TO_KEEP="${1:-7}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Safe WAL Archive Pruning ==="
echo "Pod: $PGPOD"
echo "Keeping WAL archives from last $DAYS_TO_KEEP days"
echo ""

# Check current archive status
echo "=== Current Archive Status ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
SELECT 
  archived_count,
  last_archived_wal,
  last_archived_time
FROM pg_stat_archiver;
SQL

echo ""
echo "=== Analyzing WAL Archive Directory ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c '
ARCHIVE_DIR="/wal-archive"
if [ ! -d "$ARCHIVE_DIR" ]; then
  echo "WAL archive directory does not exist: $ARCHIVE_DIR"
  exit 0
fi

echo "Archive directory size:"
du -sh "$ARCHIVE_DIR" 2>/dev/null || echo "Cannot read"

echo ""
echo "Total files:"
find "$ARCHIVE_DIR" -type f 2>/dev/null | wc -l

echo ""
echo "Files older than '$DAYS_TO_KEEP' days:"
find "$ARCHIVE_DIR" -type f -mtime +'"$DAYS_TO_KEEP"' 2>/dev/null | wc -l

echo ""
echo "Space that would be freed (files older than '$DAYS_TO_KEEP' days):"
find "$ARCHIVE_DIR" -type f -mtime +'"$DAYS_TO_KEEP"' -exec du -ch {} + 2>/dev/null | tail -1 || echo "0"
'

echo ""
read -p "Do you want to DELETE WAL archives older than $DAYS_TO_KEEP days? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Aborted. No files deleted."
  exit 0
fi

echo ""
echo "=== Pruning WAL Archives ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c '
ARCHIVE_DIR="/wal-archive"
DAYS='"$DAYS_TO_KEEP"'

if [ ! -d "$ARCHIVE_DIR" ]; then
  echo "WAL archive directory does not exist"
  exit 0
fi

echo "Deleting files older than $DAYS days..."
DELETED_COUNT=$(find "$ARCHIVE_DIR" -type f -mtime +$DAYS -delete -print 2>/dev/null | wc -l)

echo "Deleted $DELETED_COUNT files"

echo ""
echo "Remaining archive size:"
du -sh "$ARCHIVE_DIR" 2>/dev/null || echo "Cannot read"

echo ""
echo "Remaining file count:"
find "$ARCHIVE_DIR" -type f 2>/dev/null | wc -l
'

echo ""
echo "=== Pruning Complete ==="
echo "Check disk space:"
kubectl -n "$NS" exec "$PGPOD" -c db -- df -h /var/lib/postgresql/data | head -2

