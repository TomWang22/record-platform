#!/usr/bin/env bash
set -Eeuo pipefail

# Fix records database size by restoring from backup
# This removes the ~7.3M duplicate records added during restore

BACKUP_FILE="./backups/record-platform-postgres-1-all-20260101-223214.sql"
CONTAINER="record-platform-postgres-1"

echo "=== Fix Records Database Size ==="
echo ""
echo "Current state: 9,752,408 records (should be ~2.4M)"
echo "Problem: Duplicate records added during restore"
echo ""
echo "This script will:"
echo "  1. Drop the current 'records' database"
echo "  2. Restore it fresh from the Jan 1 backup"
echo "  3. Verify the record count is correct (~2.4M)"
echo ""

# Check backup file exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check container is running
if ! colima ssh -- sudo nerdctl ps --format "{{.Names}}" 2>/dev/null | grep -q "^${CONTAINER}$"; then
    echo "❌ Container $CONTAINER is not running"
    exit 1
fi

echo "⚠️  WARNING: This will DROP the current 'records' database!"
echo "   Make sure you have a backup if needed."
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "=== Step 1: Dropping current 'records' database ==="
colima ssh -- sudo nerdctl exec "$CONTAINER" psql -U postgres -d postgres -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = 'records' AND pid <> pg_backend_pid();
" 2>&1 || true

colima ssh -- sudo nerdctl exec "$CONTAINER" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS records;" 2>&1
echo "✅ Dropped 'records' database"

echo ""
echo "=== Step 2: Restoring 'records' database from backup ==="
echo "This may take several minutes..."

# Restore from backup (pg_dumpall format)
# We'll restore to postgres database first, then the records database will be created
if cat "$BACKUP_FILE" | colima ssh -- sudo nerdctl exec -i "$CONTAINER" psql -U postgres -d postgres 2>&1 | tee /tmp/restore-records-fix.log; then
    echo "✅ Restore completed"
else
    echo "⚠️  Restore had warnings (check /tmp/restore-records-fix.log)"
fi

echo ""
echo "=== Step 3: Verifying record count ==="
RECORD_COUNT=$(colima ssh -- sudo nerdctl exec "$CONTAINER" psql -U postgres -d records -tAc "SELECT COUNT(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")

if [[ -n "$RECORD_COUNT" ]] && [[ "$RECORD_COUNT" != "0" ]]; then
    echo "✅ Records database restored: $RECORD_COUNT records"
    
    if [[ "$RECORD_COUNT" -lt 5000000 ]]; then
        echo "✅ Record count looks reasonable (under 5M)"
    else
        echo "⚠️  Record count is still high ($RECORD_COUNT), may need further investigation"
    fi
    
    # Check database size
    DB_SIZE=$(colima ssh -- sudo nerdctl exec "$CONTAINER" psql -U postgres -d postgres -tAc "SELECT pg_size_pretty(pg_database_size('records'));" 2>/dev/null)
    echo "   Database size: $DB_SIZE"
else
    echo "❌ Records database is empty or query failed"
    exit 1
fi

echo ""
echo "✅ Records database fixed!"
