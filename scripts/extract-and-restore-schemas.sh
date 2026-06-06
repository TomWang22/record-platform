#!/usr/bin/env bash
set -Eeuo pipefail

# Extract schemas from 'records' database in backups and create proper databases
# This fixes the issue where data was stored as schemas instead of separate databases

BACKUP_DATE="20260101-223214"

echo "=== Extract Schemas and Create Proper Databases ==="
echo ""

# Mapping: container -> backup file -> schema to extract -> target database
declare -A EXTRACT_MAP
EXTRACT_MAP["record-platform-postgres-auth-1"]="record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql:auth:auth"
EXTRACT_MAP["record-platform-postgres-social-1"]="record-platform-postgres-social-1-all-${BACKUP_DATE}.sql:social:social"
EXTRACT_MAP["record-platform-postgres-listings-1"]="record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql:listings:listings"

for container in "${!EXTRACT_MAP[@]}"; do
    IFS=':' read -r backup_file schema_name target_db <<< "${EXTRACT_MAP[$container]}"
    
    echo "=== Processing $container ==="
    echo "  Backup: $backup_file"
    echo "  Schema: $schema_name"
    echo "  Target: $target_db database"
    echo ""
    
    # Check if container is running
    if ! colima ssh -- sudo nerdctl ps --format "{{.Names}}" 2>/dev/null | grep -q "^${container}$"; then
        echo "  ❌ Container $container is not running"
        continue
    fi
    
    # Check if target database already exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>/dev/null | grep -q 1; then
        echo "  ✅ Database $target_db already exists"
        continue
    fi
    
    echo "  Step 1: Restoring full backup to get schema data..."
    # Restore the backup (this will create the 'records' database with the schema)
    cat "backups/$backup_file" | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d postgres 2>&1 | grep -E "ERROR|CREATE|ALTER" | tail -5 || true
    
    echo "  Step 2: Checking if schema exists in records database..."
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d records -tAc "SELECT 1 FROM information_schema.schemata WHERE schema_name='$schema_name';" 2>&1 | grep -q 1; then
        echo "  ✅ Schema $schema_name found in records database"
        
        echo "  Step 3: Creating target database $target_db..."
        colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "CREATE DATABASE $target_db WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.utf8';" 2>&1 | grep -v "CREATE DATABASE" || true
        
        echo "  Step 4: Copying schema and data from records.$schema_name to $target_db.$schema_name..."
        # Use pg_dump to extract the schema, then restore it
        colima ssh -- sudo nerdctl exec "$container" pg_dump -U postgres -d records -n "$schema_name" --schema-only | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d "$target_db" 2>&1 | tail -5 || true
        
        colima ssh -- sudo nerdctl exec "$container" pg_dump -U postgres -d records -n "$schema_name" --data-only | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d "$target_db" 2>&1 | tail -5 || true
        
        echo "  Step 5: Verifying..."
        table_count=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d "$target_db" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$schema_name';" 2>&1 | tr -d ' ')
        if [[ -n "$table_count" ]] && [[ "$table_count" != "0" ]]; then
            echo "  ✅ Database $target_db created with $table_count tables in $schema_name schema"
        else
            echo "  ❌ Database $target_db created but no tables found"
        fi
    else
        echo "  ❌ Schema $schema_name not found in records database"
    fi
    
    echo ""
done

echo "=== Extract and Restore Complete ==="
