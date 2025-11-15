#!/usr/bin/env bash
set -Eeuo pipefail

# Analyze disk usage and show what can be safely pruned
# Usage: ./scripts/analyze-disk-usage.sh

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Disk Usage Analysis ==="
echo "Pod: $PGPOD"
echo ""

# Current disk usage
echo "=== Current Disk Usage ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- df -h /var/lib/postgresql/data | head -2
echo ""

# WAL analysis
echo "=== WAL Analysis ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
SELECT 
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')) as total_wal_generated,
  pg_current_wal_lsn() as current_wal_lsn,
  pg_walfile_name(pg_current_wal_lsn()) as current_wal_file;
SQL

echo ""
echo "=== WAL File Details ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c '
WAL_DIR="/var/lib/postgresql/data/pg_wal"
WAL_COUNT=$(ls -1 "$WAL_DIR"/*.wal 2>/dev/null | wc -l)
echo "Total WAL files: $WAL_COUNT"
echo ""
echo "WAL directory size:"
du -sh "$WAL_DIR" 2>/dev/null || echo "Cannot read WAL directory"
echo ""
echo "Current WAL file:"
ls -1t "$WAL_DIR"/*.wal 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo "No WAL files found"
'

echo ""
echo "=== Replication Slots (prevent WAL cleanup) ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
SELECT 
  slot_name, 
  slot_type, 
  active,
  pg_size_pretty(COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)) as retained_wal
FROM pg_replication_slots;
SQL

echo ""
echo "=== Archive Status ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
SELECT 
  archived_count,
  last_archived_wal,
  last_archived_time,
  failed_count,
  last_failed_wal,
  last_failed_time
FROM pg_stat_archiver;
SQL

echo ""
echo "=== Large Tables (top 10) ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SELECT 
  schemaname||'.'||tablename as table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size,
  n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'records'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
SQL

echo ""
echo "=== Legacy Tables (can be dropped if migration complete) ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SELECT 
  schemaname||'.'||tablename as table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'records' AND tablename LIKE '%legacy%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
SQL

echo ""
echo "=== WAL Archive Directory (if exists) ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c '
if [ -d "/wal-archive" ]; then
  echo "WAL archive directory exists:"
  du -sh /wal-archive 2>/dev/null || echo "Cannot read"
  echo ""
  echo "WAL archive file count:"
  find /wal-archive -name "*.wal" -o -name "*.gz" 2>/dev/null | wc -l
  echo ""
  echo "Oldest archived WAL (if any):"
  find /wal-archive -name "*.wal" -o -name "*.gz" 2>/dev/null | sort | head -1 || echo "No archived WAL files"
else
  echo "WAL archive directory does not exist"
fi
'

echo ""
echo "=== Recommendations ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off <<'SQL'
DO $$
DECLARE
  wal_size_mb INTEGER;
  legacy_exists BOOLEAN;
  slot_count INTEGER;
BEGIN
  -- Check WAL size
  SELECT (pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') / 1024 / 1024)::INTEGER INTO wal_size_mb;
  
  -- Check for legacy table
  SELECT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname='records' AND tablename='records_legacy'
  ) INTO legacy_exists;
  
  -- Check replication slots
  SELECT COUNT(*) INTO slot_count FROM pg_replication_slots;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== SAFE PRUNING RECOMMENDATIONS ===';
  RAISE NOTICE '';
  
  IF wal_size_mb > 1000 THEN
    RAISE NOTICE '⚠️  WAL size is % MB (%.1f GB)', wal_size_mb, wal_size_mb::NUMERIC / 1024;
    RAISE NOTICE '   → Run CHECKPOINT to reduce WAL (already done, but may need more)';
    RAISE NOTICE '   → Consider reducing max_wal_size if WAL keeps growing';
  END IF;
  
  IF slot_count > 0 THEN
    RAISE NOTICE '⚠️  Found % replication slot(s)', slot_count;
    RAISE NOTICE '   → Replication slots prevent WAL cleanup';
    RAISE NOTICE '   → Check if slots are still needed';
  END IF;
  
  IF legacy_exists THEN
    RAISE NOTICE '✅ records_legacy table exists';
    RAISE NOTICE '   → Can be dropped if partition migration is complete';
    RAISE NOTICE '   → Run: DROP TABLE records.records_legacy CASCADE;';
  ELSE
    RAISE NOTICE 'ℹ️  No legacy tables found';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  DO NOT manually delete WAL files from pg_wal directory!';
  RAISE NOTICE '   → PostgreSQL manages WAL files automatically';
  RAISE NOTICE '   → Deleting WAL files can cause data loss';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Safe actions:';
  RAISE NOTICE '   1. Run CHECKPOINT (already done)';
  RAISE NOTICE '   2. Drop records_legacy if migration complete';
  RAISE NOTICE '   3. Clean up old WAL archives from /wal-archive (if safe)';
  RAISE NOTICE '   4. Run VACUUM ANALYZE on large tables';
END $$;
SQL

