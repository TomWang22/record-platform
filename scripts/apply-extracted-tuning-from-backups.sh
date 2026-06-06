#!/usr/bin/env bash
set -euo pipefail

# Apply tuning settings extracted from SQL backup files
# Focus on tuning only (no data), including indexes, ALTER DATABASE settings, etc.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
TUNING_DIR="/tmp/tuning-settings-extracted"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Database port mapping
declare -A DB_MAP
DB_MAP[record-platform-postgres-1-all-20260101-223214.sql]="5433:records"
DB_MAP[record-platform-postgres-analytics-1-all-20260101-223214.sql]="5439:analytics"
DB_MAP[record-platform-postgres-auction-monitor-1-all-20260101-223214.sql]="5438:auction_monitor"
DB_MAP[record-platform-postgres-auth-1-all-20260101-223214.sql]="5437:auth"
DB_MAP[record-platform-postgres-listings-1-all-20260101-223214.sql]="5435:listings"
DB_MAP[record-platform-postgres-python-ai-1-all-20260101-223214.sql]="5440:python_ai"
DB_MAP[record-platform-postgres-shopping-1-all-20260101-223214.sql]="5436:shopping"
DB_MAP[record-platform-postgres-social-1-all-20260101-223214.sql]="5434:social"

say "=== Applying Tuning Settings from Backup Files ==="

# Step 1: Extract tuning settings from backup files (if not already done)
if [[ ! -d "$TUNING_DIR" ]] || [[ -z "$(ls -A "$TUNING_DIR"/*.sql 2>/dev/null)" ]]; then
  say "Extracting tuning settings from backup files..."
  mkdir -p "$TUNING_DIR"
  
  for file in "$BACKUP_DIR"/*.sql; do
    basename=$(basename "$file" .sql)
    output_file="$TUNING_DIR/${basename}-tuning-only.sql"
    
    {
      echo "-- Tuning settings extracted from: $file"
      echo "-- Date: $(date)"
      echo "-- Note: Data INSERT statements excluded"
      echo ""
      
      # Extract ALTER DATABASE (tuning settings)
      grep -E "^ALTER DATABASE" "$file" || true
      
      # Extract CREATE EXTENSION
      grep -E "^CREATE EXTENSION" "$file" | sort -u || true
      
      # Extract CREATE INDEX (all indexes)
      grep -E "^CREATE.*INDEX" "$file" || true
      
      # Extract ALTER TABLE ... SET (autovacuum, etc.)
      grep -E "ALTER TABLE.*SET" "$file" || true
      
      # Extract ANALYZE commands
      grep -E "^ANALYZE" "$file" || true
      
    } > "$output_file"
    
    ok "Extracted tuning from: $(basename "$file")"
  done
fi

# Step 2: Apply ALTER DATABASE settings from backups (these vary per database)
say "Applying ALTER DATABASE settings from backups..."
for backup_file in "${!DB_MAP[@]}"; do
  IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
  tuning_file="$TUNING_DIR/${backup_file%.sql}-tuning-only.sql"
  
  if [[ ! -f "$tuning_file" ]]; then
    warn "Tuning file not found: $tuning_file"
    continue
  fi
  
  say "Applying ALTER DATABASE settings to port $port ($db_name)..."
  
  # Extract and apply ALTER DATABASE statements
  while IFS= read -r line; do
    if [[ "$line" =~ ^ALTER\ DATABASE ]]; then
      # Apply to the specific database
      echo "  → $line"
      PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -c "$line" 2>&1 | grep -v "NOTICE:" || true
    fi
  done < "$tuning_file"
  
  ok "ALTER DATABASE settings applied to port $port"
done

# Step 3: Apply CREATE EXTENSION statements
say "Applying CREATE EXTENSION statements..."
for backup_file in "${!DB_MAP[@]}"; do
  IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
  tuning_file="$TUNING_DIR/${backup_file%.sql}-tuning-only.sql"
  
  if [[ ! -f "$tuning_file" ]]; then
    continue
  fi
  
  say "Applying extensions to port $port ($db_name)..."
  
  # Extract unique CREATE EXTENSION statements
  grep -E "^CREATE EXTENSION" "$tuning_file" | sort -u | while IFS= read -r line; do
    echo "  → $line"
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -c "$line" 2>&1 | grep -vE "(NOTICE|already exists)" || true
  done
  
  ok "Extensions applied to port $port"
done

# Step 4: Apply CREATE INDEX statements (indexes from backups)
say "Applying CREATE INDEX statements from backups..."
for backup_file in "${!DB_MAP[@]}"; do
  IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
  tuning_file="$TUNING_DIR/${backup_file%.sql}-tuning-only.sql"
  
  if [[ ! -f "$tuning_file" ]]; then
    continue
  fi
  
  say "Applying indexes to port $port ($db_name)..."
  
  # Count indexes to apply
  index_count=$(grep -cE "^CREATE.*INDEX" "$tuning_file" || echo "0")
  say "  Found $index_count indexes to apply"
  
  # Apply indexes (skip if already exists)
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records \
    -f "$tuning_file" \
    -c "SELECT COUNT(*) as indexes_applied FROM pg_indexes WHERE schemaname IN ('records', 'analytics', 'listings', 'shopping', 'social', 'auth', 'auction_monitor', 'ai', 'python_ai', 'forum', 'messages');" \
    2>&1 | grep -vE "(NOTICE|already exists|ERROR.*already exists)" || true
  
  ok "Indexes applied to port $port"
done

# Step 5: Apply ALTER TABLE SET statements (autovacuum, etc.)
say "Applying ALTER TABLE SET statements..."
for backup_file in "${!DB_MAP[@]}"; do
  IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
  tuning_file="$TUNING_DIR/${backup_file%.sql}-tuning-only.sql"
  
  if [[ ! -f "$tuning_file" ]]; then
    continue
  fi
  
  # Extract and apply ALTER TABLE SET statements
  grep -E "ALTER TABLE.*SET" "$tuning_file" | while IFS= read -r line; do
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -c "$line" 2>&1 | grep -v "NOTICE:" || true
  done
done

ok "ALTER TABLE SET statements applied"

# Step 6: Run ANALYZE on all tables
say "Running ANALYZE on all tables..."
for backup_file in "${!DB_MAP[@]}"; do
  IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
  tuning_file="$TUNING_DIR/${backup_file%.sql}-tuning-only.sql"
  
  if [[ ! -f "$tuning_file" ]]; then
    continue
  fi
  
  # Extract and run ANALYZE statements
  grep -E "^ANALYZE" "$tuning_file" | while IFS= read -r line; do
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records -c "$line" 2>&1 | grep -v "NOTICE:" || true
  done
done

ok "ANALYZE completed"

say "=== Tuning Application Complete ==="
ok "All tuning settings from backup files have been applied"
ok "Note: Some ALTER SYSTEM settings require PostgreSQL restart (max_worker_processes, shared_buffers)"
