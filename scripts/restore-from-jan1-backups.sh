#!/usr/bin/env bash
set -Eeuo pipefail

# Restore all 8 PostgreSQL databases from Jan 1, 2026 backups
# Usage: ./scripts/restore-from-jan1-backups.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
BACKUP_DATE="20260101-223214"

echo "=== Restore All Databases from Jan 1, 2026 Backups ==="
echo ""
echo "Backup directory: ${BACKUP_DIR}"
echo "Backup timestamp: ${BACKUP_DATE}"
echo ""

# Check if backups exist
BACKUP_FILES=(
    "record-platform-postgres-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-social-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-shopping-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-auction-monitor-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-analytics-1-all-${BACKUP_DATE}.sql"
    "record-platform-postgres-python-ai-1-all-${BACKUP_DATE}.sql"
)

echo "Checking backup files..."
MISSING=0
for backup_file in "${BACKUP_FILES[@]}"; do
    if [[ ! -f "${BACKUP_DIR}/${backup_file}" ]]; then
        echo "  ❌ Missing: ${backup_file}"
        MISSING=$((MISSING + 1))
    else
        SIZE=$(du -h "${BACKUP_DIR}/${backup_file}" | cut -f1)
        echo "  ✅ Found: ${backup_file} (${SIZE})"
    fi
done

if [[ $MISSING -gt 0 ]]; then
    echo ""
    echo "❌ Missing $MISSING backup file(s). Cannot proceed." >&2
    exit 1
fi

echo ""
echo "✅ All 8 backup files found"
echo ""

# Database mapping: backup file -> container name -> port -> database name
# Note: Container names use "record-platform-" prefix in nerdctl
declare -A DB_MAP
DB_MAP["record-platform-postgres-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-1:5433:records"
DB_MAP["record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-auth-1:5437:auth"
DB_MAP["record-platform-postgres-social-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-social-1:5434:social"
DB_MAP["record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-listings-1:5435:listings"
DB_MAP["record-platform-postgres-shopping-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-shopping-1:5436:shopping"
DB_MAP["record-platform-postgres-auction-monitor-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-auction-monitor-1:5438:auction-monitor"
DB_MAP["record-platform-postgres-analytics-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-analytics-1:5439:analytics"
DB_MAP["record-platform-postgres-python-ai-1-all-${BACKUP_DATE}.sql"]="record-platform-postgres-python-ai-1:5440:python-ai"

# Check Docker Compose is running (using nerdctl via Colima)
echo "Checking Docker Compose status..."
if ! colima nerdctl compose ps 2>/dev/null | grep -q "postgres"; then
    echo "⚠️  Docker Compose postgres containers not running"
    echo "   Starting Docker Compose..."
    colima nerdctl compose up -d postgres postgres-auth postgres-social postgres-listings \
        postgres-shopping postgres-auction-monitor postgres-analytics postgres-python-ai
    
    echo "   Waiting for databases to be ready..."
    sleep 10
fi

# Function to restore a database
restore_database() {
    local backup_file=$1
    local container_name=$2
    local port=$3
    local db_name=$4
    
    echo ""
    echo "=== Restoring ${db_name} database ==="
    echo "  Backup: ${backup_file}"
    echo "  Container: ${container_name}"
    echo "  Port: ${port}"
    echo "  Database: ${db_name}"
    echo ""
    
    # Check if container is running (using nerdctl via colima ssh)
    if ! colima ssh -- sudo nerdctl ps --format "{{.Names}}" 2>/dev/null | grep -q "^${container_name}$"; then
        echo "  ❌ Container ${container_name} is not running"
        return 1
    fi
    
    # Check if container is healthy (using colima ssh for nerdctl)
    if ! colima ssh -- sudo nerdctl exec "${container_name}" pg_isready -U postgres >/dev/null 2>&1; then
        echo "  ⚠️  Container ${container_name} is not ready, waiting..."
        sleep 5
        if ! colima ssh -- sudo nerdctl exec "${container_name}" pg_isready -U postgres >/dev/null 2>&1; then
            echo "  ❌ Container ${container_name} is not healthy"
            return 1
        fi
    fi
    
    # Restore using psql (pg_dumpall creates SQL dumps, not binary dumps)
    echo "  Restoring database (this may take several minutes for large databases)..."
    
    # For pg_dumpall dumps, we need to restore to postgres database first, then extract specific database
    # pg_dumpall dumps all databases, so we need to filter for the specific database
    # Use colima ssh to pipe the backup file into the container
    if cat "${BACKUP_DIR}/${backup_file}" | colima ssh -- sudo nerdctl exec -i "${container_name}" psql -U postgres -d postgres 2>&1 | tee /tmp/restore-${db_name}.log; then
        echo "  ✅ Restore completed for ${db_name}"
        
        # Verify restore (check if database exists and has data)
        if colima ssh -- sudo nerdctl exec "${container_name}" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}';" | grep -q 1; then
            echo "  ✅ Database ${db_name} exists"
            
            # Try to get row count (may fail if schema doesn't match)
            ROW_COUNT=$(colima ssh -- sudo nerdctl exec "${container_name}" psql -U postgres -d "${db_name}" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');" 2>/dev/null || echo "0")
            echo "  📊 Tables found: ${ROW_COUNT}"
        else
            echo "  ⚠️  Database ${db_name} may not exist (check logs)"
        fi
    else
        echo "  ❌ Restore failed for ${db_name}"
        echo "  Check /tmp/restore-${db_name}.log for details"
        return 1
    fi
}

# Restore each database
FAILED=0
for backup_file in "${BACKUP_FILES[@]}"; do
    IFS=':' read -r container_name port db_name <<< "${DB_MAP[$backup_file]}"
    
    if ! restore_database "${backup_file}" "${container_name}" "${port}" "${db_name}"; then
        FAILED=$((FAILED + 1))
        echo "  ⚠️  Failed to restore ${db_name}, continuing with other databases..."
    fi
done

echo ""
echo "=== Restore Summary ==="
if [[ $FAILED -eq 0 ]]; then
    echo "✅ All 8 databases restored successfully!"
    
    # Verify main records database
    echo ""
    echo "=== Verifying Records Database ==="
    RECORD_COUNT=$(colima ssh -- sudo nerdctl exec record-platform-postgres-1 psql -U postgres -d records -tAc "SELECT COUNT(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
    if [[ -n "$RECORD_COUNT" ]] && [[ "$RECORD_COUNT" != "0" ]]; then
        echo "✅ Records database verified: ${RECORD_COUNT} records"
    else
        echo "⚠️  Records database may be empty or schema mismatch"
    fi
else
    echo "⚠️  $FAILED database(s) failed to restore"
    echo "   Check logs in /tmp/restore-*.log for details"
    exit 1
fi

echo ""
echo "✅ Restore complete! All databases are ready to use."
