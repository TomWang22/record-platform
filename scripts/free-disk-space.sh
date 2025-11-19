#!/usr/bin/env bash
set -Eeuo pipefail

# Free up disk space before restore
# Usage: ./scripts/free-disk-space.sh

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Freeing Disk Space ==="
echo "Pod: $PGPOD"
echo ""

# Check current space
echo "=== Current disk usage ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- df -h /var/lib/postgresql/data | head -2
echo ""

# Force checkpoint to reduce WAL
echo "=== Forcing checkpoint to reduce WAL ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
CHECKPOINT;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')) as wal_size;
SQL

# Vacuum to reclaim space (regular VACUUM, not FULL to avoid locking)
echo ""
echo "=== Running VACUUM to reclaim space ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL' || true
SET search_path = records, public;
-- Regular VACUUM (non-blocking) to reclaim space
VACUUM ANALYZE records.records;
VACUUM ANALYZE records.record_media;
VACUUM ANALYZE records.aliases;
SQL

# Check space after cleanup
echo ""
echo "=== Disk usage after cleanup ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- df -h /var/lib/postgresql/data | head -2
echo ""

# Show WAL size
echo "=== WAL directory size ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- du -sh /var/lib/postgresql/data/pg_wal 2>/dev/null || echo "WAL directory not found"

