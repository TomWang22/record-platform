#!/usr/bin/env bash
set -Eeuo pipefail

# Restore missing databases (auth, social, listings) from Jan 1 backups
# Strategy: Restore full backup, then drop unwanted databases

BACKUP_DATE="20260101-223214"

echo "=== Restore Missing Databases (Auth, Social, Listings) ==="
echo ""

# Database mapping: container -> backup file -> target database
declare -A RESTORE_MAP
RESTORE_MAP["record-platform-postgres-auth-1"]="record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql:auth"
RESTORE_MAP["record-platform-postgres-social-1"]="record-platform-postgres-social-1-all-${BACKUP_DATE}.sql:social"
RESTORE_MAP["record-platform-postgres-listings-1"]="record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql:listings"

for container in "${!RESTORE_MAP[@]}"; do
    IFS=':' read -r backup_file target_db <<< "${RESTORE_MAP[$container]}"
    
    echo "=== Restoring $target_db database to $container ==="
    echo "  Backup: $backup_file"
    echo ""
    
    # Check if container is running
    if ! colima ssh -- sudo nerdctl ps --format "{{.Names}}" 2>/dev/null | grep -q "^${container}$"; then
        echo "  ❌ Container $container is not running"
        continue
    fi
    
    # Check if target database already exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>/dev/null | grep -q 1; then
        echo "  ✅ Database $target_db already exists, skipping restore"
        continue
    fi
    
    # Restore full backup (will create all databases in the backup)
    echo "  Restoring backup (this may take a few minutes)..."
    if cat "backups/$backup_file" | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d postgres 2>&1 | tee /tmp/restore-${target_db}.log | tail -20; then
        echo "  ✅ Backup restored"
    else
        echo "  ⚠️  Restore had warnings (check /tmp/restore-${target_db}.log)"
    fi
    
    # Clean up: Drop databases we don't want (keep only target_db and postgres)
    echo "  Cleaning up unwanted databases..."
    for db in records analytics python_ai shopping auction_monitor; do
        if [ "$db" != "$target_db" ]; then
            colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" 2>&1 | grep -v "DROP DATABASE" || true
        fi
    done
    
    # Verify target database exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>&1 | grep -q 1; then
        size=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT pg_size_pretty(pg_database_size('$target_db'));" 2>&1)
        echo "  ✅ Database $target_db restored ($size)"
    else
        echo "  ❌ Database $target_db not found after restore"
    fi
    
    echo ""
done

echo "=== Restore Complete ==="
echo ""
echo "Verifying all databases..."

for container in "${!RESTORE_MAP[@]}"; do
    IFS=':' read -r backup_file target_db <<< "${RESTORE_MAP[$container]}"
    echo -n "  $container ($target_db): "
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>&1 | grep -q 1; then
        echo "✅"
    else
        echo "❌"
    fi
done

echo ""
echo "✅ All missing databases restored!"
