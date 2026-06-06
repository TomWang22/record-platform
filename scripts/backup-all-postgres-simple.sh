#!/usr/bin/env bash
set -euo pipefail

# Simple backup script - just pg_dumpall for all Postgres containers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "=== Postgres Database Backup Script ==="
echo ""
echo "Backup directory: ${BACKUP_DIR}"
echo "Timestamp: ${TIMESTAMP}"
echo ""

# Create backups directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# List of Postgres containers
POSTGRES_CONTAINERS=(
    "record-platform-postgres-1"
    "record-platform-postgres-auth-1"
    "record-platform-postgres-social-1"
    "record-platform-postgres-listings-1"
    "record-platform-postgres-shopping-1"
    "record-platform-postgres-auction-monitor-1"
    "record-platform-postgres-analytics-1"
    "record-platform-postgres-python-ai-1"
)

echo "Starting database backups..."
echo ""

success_count=0
fail_count=0
total=${#POSTGRES_CONTAINERS[@]}
current=0

for container_name in "${POSTGRES_CONTAINERS[@]}"; do
    ((current++))
    echo "[${current}/${total}] 📦 Backing up ${container_name}..."
    
    # Check if container is running
    if ! docker ps --format "{{.Names}}" | grep -q "^${container_name}$"; then
        echo "   ⚠️  Container is not running, skipping..."
        ((fail_count++))
        echo ""
        continue
    fi
    
    backup_file="${BACKUP_DIR}/${container_name}-all-${TIMESTAMP}.sql"
    
    # Use pg_dumpall to dump everything
    if docker exec -t "${container_name}" pg_dumpall -U postgres > "${backup_file}" 2>&1; then
        # Check if the file has actual content
        if [ -s "${backup_file}" ] && ! grep -q "^ERROR\|^FATAL" "${backup_file}" 2>/dev/null; then
            size=$(du -h "${backup_file}" | awk '{print $1}')
            echo "   ✅ Backup created: ${backup_file} (${size})"
            ((success_count++))
        else
            echo "   ⚠️  Backup file appears empty or contains errors"
            head -5 "${backup_file}" 2>/dev/null | sed 's/^/      /'
            rm -f "${backup_file}"
            ((fail_count++))
        fi
    else
        echo "   ❌ Failed to create backup"
        ((fail_count++))
    fi
    echo ""
done

# Summary
echo "=== Backup Summary ==="
echo "✅ Successful: ${success_count}/${total}"
echo "❌ Failed: ${fail_count}/${total}"
echo ""
echo "Backup location: ${BACKUP_DIR}"
echo ""

# List all backup files
echo "Backup files created:"
ls -lh "${BACKUP_DIR}"/*"${TIMESTAMP}"* 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}' || echo "   (no files found)"
echo ""

if [ ${fail_count} -eq 0 ]; then
    echo "✅ All backups completed successfully!"
    exit 0
else
    echo "⚠️  Some backups failed. Please review the errors above."
    exit 1
fi

