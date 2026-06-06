#!/usr/bin/env bash
# Dump all Postgres databases immediately after Docker repair
# Run this IMMEDIATELY if Docker starts successfully

set -euo pipefail

BACKUP_DIR="$HOME/postgres-backups-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "=== Dumping All Postgres Databases ==="
echo ""
echo "Backup directory: $BACKUP_DIR"
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "   Start Docker first, then run this script"
    exit 1
fi

# List of Postgres services and their ports
declare -A POSTGRES_SERVICES=(
    ["postgres"]="5433"
    ["postgres-auth"]="5437"
    ["postgres-social"]="5434"
    ["postgres-listings"]="5435"
    ["postgres-shopping"]="5436"
    ["postgres-auction-monitor"]="5438"
    ["postgres-analytics"]="5439"
    ["postgres-python-ai"]="5440"
)

SUCCESS_COUNT=0
FAIL_COUNT=0

for service in "${!POSTGRES_SERVICES[@]}"; do
    port="${POSTGRES_SERVICES[$service]}"
    backup_file="$BACKUP_DIR/${service}-$(date +%Y%m%d-%H%M%S).sql"
    
    echo "Dumping $service (port $port)..."
    
    # Try to dump using docker-compose exec
    if docker-compose exec -T "$service" pg_dumpall -U postgres > "$backup_file" 2>/dev/null; then
        # Check if backup has content
        if [[ -s "$backup_file" ]]; then
            echo "   ✅ Dumped to: $backup_file ($(du -h "$backup_file" | awk '{print $1}'))"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        else
            echo "   ⚠️  Backup file is empty"
            rm "$backup_file"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    else
        echo "   ❌ Failed to dump $service"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

echo ""
echo "=== Dump Complete ==="
echo "   ✅ Successful: $SUCCESS_COUNT"
echo "   ❌ Failed: $FAIL_COUNT"
echo ""
echo "Backups saved to: $BACKUP_DIR"
echo ""

if [[ $SUCCESS_COUNT -gt 0 ]]; then
    echo "✅ At least some databases were backed up successfully"
    echo ""
    echo "Verify backups:"
    echo "   ls -lh $BACKUP_DIR"
    echo ""
    echo "To restore a database:"
    echo "   psql -h localhost -p <port> -U postgres < $BACKUP_DIR/<service>-*.sql"
else
    echo "⚠️  No databases were successfully backed up"
    echo "   This may indicate Docker containers are not running"
    echo "   Check: docker-compose ps"
fi

