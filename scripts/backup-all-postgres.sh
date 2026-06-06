#!/usr/bin/env bash
set -euo pipefail

# Backup all Postgres databases from Docker containers
# This script dumps all databases from all Postgres containers

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

# Function to dump all databases from a container using pg_dumpall
dump_all_databases() {
    local container_name=$1
    local backup_file="${BACKUP_DIR}/${container_name}-all-${TIMESTAMP}.sql"
    
    echo "📦 Backing up ${container_name} (pg_dumpall - all databases + roles)..."
    
    # Check if container is running
    if ! docker ps --format "{{.Names}}" | grep -q "^${container_name}$"; then
        echo "   ⚠️  Container is not running, skipping..."
        return 1
    fi
    
    # Use pg_dumpall to dump everything (all databases, roles, etc.)
    if docker exec -t "${container_name}" pg_dumpall -U postgres > "${backup_file}" 2>&1; then
        # Check if the file has actual content
        if [ -s "${backup_file}" ] && ! grep -q "^ERROR\|^FATAL" "${backup_file}" 2>/dev/null; then
            local size=$(du -h "${backup_file}" | awk '{print $1}')
            echo "   ✅ Backup created: ${backup_file} (${size})"
            return 0
        else
            echo "   ⚠️  Backup file appears empty or contains errors"
            # Show first few lines of error if any
            head -5 "${backup_file}" 2>/dev/null | sed 's/^/      /'
            rm -f "${backup_file}"
            return 1
        fi
    else
        echo "   ❌ Failed to create backup"
        return 1
    fi
}

# Function to dump individual databases (for redundancy)
dump_individual_databases() {
    local container_name=$1
    
    # Get all user databases (excluding system databases)
    local databases
    databases=$(docker exec -t "${container_name}" psql -U postgres -t -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres';" 2>/dev/null | tr -d ' ' | grep -v '^$' || echo "")
    
    if [ -z "${databases}" ]; then
        return 0  # No user databases to dump
    fi
    
    for db_name in ${databases}; do
        local backup_file="${BACKUP_DIR}/${container_name}-${db_name}-${TIMESTAMP}.sql"
        echo "   📦 Also dumping individual database: ${db_name}..."
        
        # Use set +e temporarily to allow errors
        set +e
        docker exec -t "${container_name}" pg_dump -U postgres "${db_name}" > "${backup_file}" 2>&1
        local dump_exit=$?
        set -e
        
        if [ ${dump_exit} -eq 0 ] && [ -s "${backup_file}" ] && ! grep -q "^ERROR\|^FATAL" "${backup_file}" 2>/dev/null; then
            local size=$(du -h "${backup_file}" | awk '{print $1}')
            echo "      ✅ ${backup_file} (${size})"
        else
            echo "      ⚠️  Skipping (empty or errors)"
            rm -f "${backup_file}"
        fi
    done
    return 0
}

# Dump all databases from all containers
echo "Starting database backups..."
echo ""

success_count=0
fail_count=0

for container_name in "${POSTGRES_CONTAINERS[@]}"; do
    if dump_all_databases "${container_name}"; then
        ((success_count++))
        # Also create individual database dumps for redundancy (don't fail if this errors)
        dump_individual_databases "${container_name}" || true
    else
        ((fail_count++))
    fi
    echo ""
done

# Summary
echo "=== Backup Summary ==="
echo "✅ Successful: ${success_count}"
echo "❌ Failed: ${fail_count}"
echo ""
echo "Backup location: ${BACKUP_DIR}"
echo ""

# List all backup files
echo "Backup files created:"
ls -lh "${BACKUP_DIR}"/*"${TIMESTAMP}"* 2>/dev/null || echo "   (no files found)"
echo ""

if [ ${fail_count} -eq 0 ]; then
    echo "✅ All backups completed successfully!"
    exit 0
else
    echo "⚠️  Some backups failed. Please review the errors above."
    exit 1
fi

