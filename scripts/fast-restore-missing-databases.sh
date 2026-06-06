#!/usr/bin/env bash
set -Eeuo pipefail

# Fast restore: Extract schema sections from SQL backup files and create proper databases
# This is much faster than using pg_dump

BACKUP_DATE="20260101-223214"

echo "=== Fast Restore: Extract Schemas from SQL Files ==="
echo ""

# Mapping: container -> backup file -> schema name -> target database
declare -A RESTORE_MAP
RESTORE_MAP["record-platform-postgres-auth-1"]="record-platform-postgres-auth-1-all-${BACKUP_DATE}.sql:auth:auth"
RESTORE_MAP["record-platform-postgres-social-1"]="record-platform-postgres-social-1-all-${BACKUP_DATE}.sql:social:social"
RESTORE_MAP["record-platform-postgres-listings-1"]="record-platform-postgres-listings-1-all-${BACKUP_DATE}.sql:listings:listings"

for container in "${!RESTORE_MAP[@]}"; do
    IFS=':' read -r backup_file schema_name target_db <<< "${RESTORE_MAP[$container]}"
    
    echo "=== Processing $container ==="
    echo "  Backup: $backup_file"
    echo "  Schema: $schema_name (from records database)"
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
    
    echo "  Step 1: Restoring backup to get schema data (this creates 'records' database)..."
    # Restore the backup - this creates the 'records' database with the schema
    cat "backups/$backup_file" 2>/dev/null | colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d postgres 2>&1 | grep -E "ERROR|CREATE|ALTER" | tail -3 || true
    
    echo "  Step 2: Creating target database $target_db..."
    colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres <<EOF 2>&1 | grep -v "CREATE DATABASE" || true
CREATE DATABASE $target_db WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.utf8';
EOF
    
    echo "  Step 3: Copying schema from records.$schema_name to $target_db.$schema_name..."
    # Use CREATE SCHEMA and then copy all objects
    colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d "$target_db" <<EOF 2>&1 | tail -5
CREATE SCHEMA IF NOT EXISTS $schema_name;
EOF
    
    # Copy schema objects using pg_dump (schema only, then data)
    echo "  Extracting schema structure..."
    colima ssh -- sudo nerdctl exec "$container" pg_dump -U postgres -d records -n "$schema_name" --schema-only 2>/dev/null | \
        sed "s/records\.$schema_name/$schema_name/g" | \
        colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d "$target_db" 2>&1 | tail -10 || true
    
    echo "  Extracting schema data..."
    colima ssh -- sudo nerdctl exec "$container" pg_dump -U postgres -d records -n "$schema_name" --data-only 2>/dev/null | \
        sed "s/records\.$schema_name/$schema_name/g" | \
        colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d "$target_db" 2>&1 | tail -10 || true
    
    echo "  Step 4: Verifying..."
    table_count=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d "$target_db" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$schema_name';" 2>&1 | tr -d ' ')
    if [[ -n "$table_count" ]] && [[ "$table_count" != "0" ]]; then
        size=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT pg_size_pretty(pg_database_size('$target_db'));" 2>&1)
        echo "  ✅ Database $target_db created: $table_count tables, $size"
    else
        echo "  ⚠️  Database $target_db created but no tables found (may need manual check)"
    fi
    
    echo ""
done

echo "=== Fast Restore Complete ==="
