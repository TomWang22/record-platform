#!/usr/bin/env bash
set -Eeuo pipefail

# Quick restore: Restore backup, create DB, copy schema with optimized pg_dump
BACKUP_DATE="20260101-223214"

echo "=== Quick Database Restore ==="
echo ""

declare -A RESTORE_MAP
RESTORE_MAP["record-platform-postgres-auth-1"]="record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql:auth:auth"
RESTORE_MAP["record-platform-postgres-social-1"]="record-platform-postgres-social-1-all-${BACKUP_DATE}.sql:social:social"
RESTORE_MAP["record-platform-postgres-listings-1"]="record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql:listings:listings"

for container in "${!RESTORE_MAP[@]}"; do
    IFS=':' read -r backup_file schema_name target_db <<< "${RESTORE_MAP[$container]}"
    
    echo "=== $container → $target_db database ==="
    
    # Check if already exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>&1 | grep -q 1; then
        echo "  ✅ Already exists, skipping"
        continue
    fi
    
    echo "  1. Restoring backup..."
    cat "backups/$backup_file" 2>/dev/null | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d postgres >/dev/null 2>&1
    
    echo "  2. Creating $target_db database..."
    colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "CREATE DATABASE $target_db;" >/dev/null 2>&1
    
    echo "  3. Copying $schema_name schema (this may take a minute)..."
    # Use optimized pg_dump flags for speed
    colima ssh -- sudo nerdctl exec "$container" bash -c "
        pg_dump -U postgres -d records -n $schema_name --no-owner --no-acl --schema-only 2>/dev/null | \
        sed 's/records\.$schema_name/$schema_name/g' | \
        psql -U postgres -d $target_db >/dev/null 2>&1
        
        pg_dump -U postgres -d records -n $schema_name --no-owner --no-acl --data-only 2>/dev/null | \
        sed 's/records\.$schema_name/$schema_name/g' | \
        psql -U postgres -d $target_db >/dev/null 2>&1
    "
    
    # Verify
    table_count=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d "$target_db" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$schema_name';" 2>&1 | tr -d ' ')
    if [[ -n "$table_count" ]] && [[ "$table_count" != "0" ]]; then
        echo "  ✅ $target_db: $table_count tables"
    else
        echo "  ⚠️  $target_db: No tables found"
    fi
    echo ""
done

echo "✅ Done!"
