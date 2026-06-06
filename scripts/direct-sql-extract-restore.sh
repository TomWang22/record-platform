#!/usr/bin/env bash
set -Eeuo pipefail

# Direct SQL extraction: Extract schema sections from SQL files and restore to new databases
# Much faster than pg_dump - directly uses the SQL from backup files

BACKUP_DATE="20260101-223214"

echo "=== Direct SQL Extraction Restore ==="
echo "Extracting schema sections directly from SQL backup files"
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
    echo "  Schema: $schema_name"
    echo "  Target: $target_db database"
    echo ""
    
    # Check if container is running
    if ! colima ssh -- sudo nerdctl ps --format "{{.Names}}" 2>/dev/null | grep -q "^${container}$"; then
        echo "  ❌ Container $container is not running"
        continue
    fi
    
    # Check if target database already exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$target_db';" 2>&1 | grep -q 1; then
        echo "  ✅ Database $target_db already exists"
        continue
    fi
    
    echo "  Step 1: Creating target database $target_db..."
    colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "CREATE DATABASE $target_db WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.utf8';" 2>&1 | grep -v "CREATE DATABASE" || true
    
    echo "  Step 2: Extracting and restoring $schema_name schema from SQL file..."
    # Extract the records database section, then extract just the schema we need
    # This is much faster than pg_dump
    awk '
        /You are now connected to database "records"/ { in_records=1; next }
        /CREATE DATABASE|^-- Database:/ { if (in_records) exit }
        in_records && /CREATE SCHEMA '"$schema_name"'|ALTER SCHEMA '"$schema_name"'/ { in_schema=1 }
        in_records && in_schema { print }
        in_records && in_schema && /CREATE SCHEMA [^'"$schema_name"']|ALTER SCHEMA [^'"$schema_name"']/ { if ($3 != "'"$schema_name"'") in_schema=0 }
    ' "backups/$backup_file" | \
        sed "s/records\.$schema_name/$schema_name/g" | \
        colima ssh -- sudo nerdctl exec -i "$container" psql -U postgres -d "$target_db" 2>&1 | tail -10 || true
    
    echo "  Step 3: Verifying..."
    table_count=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d "$target_db" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$schema_name';" 2>&1 | tr -d ' ')
    if [[ -n "$table_count" ]] && [[ "$table_count" != "0" ]]; then
        size=$(colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT pg_size_pretty(pg_database_size('$target_db'));" 2>&1)
        echo "  ✅ Database $target_db: $table_count tables, $size"
    else
        echo "  ⚠️  Database $target_db created but no tables found"
    fi
    
    echo ""
done

echo "=== Direct SQL Extraction Complete ==="
