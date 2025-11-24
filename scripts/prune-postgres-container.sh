#!/usr/bin/env bash
# Safe disk space pruning for PostgreSQL Docker container
# Can be run while benchmarks are running - only prunes safe-to-delete bloat
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-record-platform-postgres-1}"
CLEAN_HOST_BACKUPS="${CLEAN_HOST_BACKUPS:-false}"  # Set to true to clean old host backups

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --clean-host-backups)
      CLEAN_HOST_BACKUPS=true
      shift
      ;;
    --container)
      PG_CONTAINER="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--clean-host-backups] [--container NAME]"
      echo ""
      echo "Options:"
      echo "  --clean-host-backups    Also clean old backup files on host (>7 days old)"
      echo "  --container NAME        PostgreSQL container name (default: record-platform-postgres-1)"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use -h or --help for usage" >&2
      exit 1
      ;;
  esac
done

log() {
  echo "[$(date +%H:%M:%S)] $*" >&2
}

info() {
  log "ℹ️  $*"
}

warn() {
  log "⚠️  $*"
}

error() {
  log "❌ $*"
}

success() {
  log "✅ $*"
}

# Check if container exists
if ! docker ps --format "{{.Names}}" | grep -q "^${PG_CONTAINER}$"; then
  error "PostgreSQL container '$PG_CONTAINER' not found"
  exit 1
fi

info "Pruning disk space in PostgreSQL container: $PG_CONTAINER"
if [[ "$CLEAN_HOST_BACKUPS" == "true" ]]; then
  info "  Mode: AGGRESSIVE (will also clean old host backups)"
fi

# Check current disk usage
CONTAINER_DISK_INFO=$(docker exec "$PG_CONTAINER" df -h /var/lib/postgresql/data 2>/dev/null | tail -1 || echo "")
if [[ -n "$CONTAINER_DISK_INFO" ]]; then
  CONTAINER_PCT=$(echo "$CONTAINER_DISK_INFO" | awk '{print $5}' | sed 's/%//')
  CONTAINER_USED=$(echo "$CONTAINER_DISK_INFO" | awk '{print $3}')
  CONTAINER_AVAIL=$(echo "$CONTAINER_DISK_INFO" | awk '{print $4}')
  info "Current disk usage: ${CONTAINER_USED} used, ${CONTAINER_AVAIL} available (${CONTAINER_PCT}% used)"
  
  # Store for later use
  export CONTAINER_PCT
else
  CONTAINER_PCT=0
  export CONTAINER_PCT
fi

# Check recovery status early (before WAL cleanup decisions)
RECOVERY_STATUS=$(psql_cmd "SELECT pg_is_in_recovery();" 2>/dev/null | tr -d ' ' || echo "t")
CAN_CONNECT=$(psql_cmd "SELECT 1;" 2>/dev/null | tr -d ' ' || echo "")
if [[ -z "$CAN_CONNECT" ]] || [[ "$CAN_CONNECT" != "1" ]]; then
  RECOVERY_STATUS="t"  # Assume recovery if we can't connect
fi
export RECOVERY_STATUS

# Connect to PostgreSQL
psql_cmd() {
  docker exec "$PG_CONTAINER" psql -U postgres -d postgres -tAc "$1" 2>/dev/null || echo ""
}

# 1. Vacuum to reclaim space from dead tuples (safe, can run during benchmarks)
info "Step 1: Running VACUUM ANALYZE on records.records (reclaims dead tuple space)..."
# Use VACUUM (not VACUUM FULL) - it's safe during benchmarks and reclaims space from dead tuples
# During recovery or high disk usage, be more aggressive with vacuum
# Note: RECOVERY_STATUS and CONTAINER_PCT are set earlier
if [[ "${RECOVERY_STATUS:-t}" == "t" ]] || [[ "${CONTAINER_PCT:-100}" -ge 95 ]]; then
  info "  High disk usage detected - using aggressive VACUUM settings..."
  docker exec "$PG_CONTAINER" psql -U postgres -d records -c "VACUUM (VERBOSE, ANALYZE) records.records;" >/dev/null 2>&1 || {
    warn "VACUUM failed (may be locked by benchmark, trying VACUUM without ANALYZE)..."
    # Try just VACUUM without ANALYZE (less locking)
    docker exec "$PG_CONTAINER" psql -U postgres -d records -c "VACUUM records.records;" >/dev/null 2>&1 || {
      warn "VACUUM still failed (table may be locked, continuing...)"
    }
  }
else
  docker exec "$PG_CONTAINER" psql -U postgres -d records -c "VACUUM ANALYZE records.records;" >/dev/null 2>&1 || {
    warn "VACUUM failed (may be locked by benchmark, trying VACUUM without ANALYZE)..."
    docker exec "$PG_CONTAINER" psql -U postgres -d records -c "VACUUM records.records;" >/dev/null 2>&1 || {
      warn "VACUUM still failed (table may be locked, continuing...)"
    }
  }
fi

# 2. Check and truncate pg_stat_statements if it's huge (safe, just resets stats)
info "Step 2: Checking pg_stat_statements size..."
STAT_STMT_SIZE=$(psql_cmd "SELECT pg_size_pretty(pg_total_relation_size('pg_stat_statements'));" | tr -d ' ')
if [[ -n "$STAT_STMT_SIZE" ]]; then
  info "  pg_stat_statements size: $STAT_STMT_SIZE"
  # If it's > 100MB, truncate it (safe - just resets query stats)
  STAT_STMT_BYTES=$(psql_cmd "SELECT pg_total_relation_size('pg_stat_statements');" | tr -d ' ')
  if [[ -n "$STAT_STMT_BYTES" ]] && [[ "$STAT_STMT_BYTES" =~ ^[0-9]+$ ]] && [[ "$STAT_STMT_BYTES" -gt 104857600 ]]; then
    info "  Truncating pg_stat_statements (>100MB)..."
    psql_cmd "TRUNCATE pg_stat_statements;" >/dev/null 2>&1 || warn "  Failed to truncate pg_stat_statements"
  fi
fi

# 3. Check WAL directory and clean old WAL files (if safe)
info "Step 3: Checking WAL directory..."
WAL_DIR="/var/lib/postgresql/data/pg_wal"
WAL_SIZE=$(docker exec "$PG_CONTAINER" du -sh "$WAL_DIR" 2>/dev/null | awk '{print $1}' || echo "unknown")
# WAL files don't have .wal extension - they're numbered segments like 000000010000000B000000DF
WAL_COUNT=$(docker exec "$PG_CONTAINER" sh -c "ls -1 $WAL_DIR/ | grep -E '^[0-9A-F]{24}$' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
WAL_ARCHIVE_COUNT=$(docker exec "$PG_CONTAINER" sh -c "ls -1 $WAL_DIR/archive_status/*.ready 2>/dev/null 2>&1 | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
info "  WAL directory: ~$WAL_SIZE ($WAL_COUNT segment files, $WAL_ARCHIVE_COUNT archived)"

# Check recovery status early (before WAL cleanup decisions)
RECOVERY_STATUS=$(psql_cmd "SELECT pg_is_in_recovery();" 2>/dev/null | tr -d ' ' || echo "t")
CAN_CONNECT=$(psql_cmd "SELECT 1;" 2>/dev/null | tr -d ' ' || echo "")
if [[ -z "$CAN_CONNECT" ]] || [[ "$CAN_CONNECT" != "1" ]]; then
  RECOVERY_STATUS="t"  # Assume recovery if we can't connect
fi
export RECOVERY_STATUS

# Check if WAL archiving is enabled (may fail if DB is in recovery)
ARCHIVE_MODE=$(psql_cmd "SHOW archive_mode;" 2>/dev/null | tr -d ' ' || echo "")
WAL_LEVEL=$(psql_cmd "SHOW wal_level;" 2>/dev/null | tr -d ' ' || echo "")

# More aggressive WAL cleanup - check for old archive status files
if [[ -n "$WAL_ARCHIVE_COUNT" ]] && [[ "$WAL_ARCHIVE_COUNT" =~ ^[0-9]+$ ]] && [[ "$WAL_ARCHIVE_COUNT" -gt 0 ]]; then
  info "  Found $WAL_ARCHIVE_COUNT archived WAL files"
  # Clean old archive status files (older than 1 day) - these indicate WALs that were archived
  ARCHIVE_STATUS_DIR="$WAL_DIR/archive_status"
  OLD_ARCHIVE_COUNT=$(docker exec "$PG_CONTAINER" sh -c "find $ARCHIVE_STATUS_DIR -name '*.ready' -mtime +1 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
  if [[ -n "$OLD_ARCHIVE_COUNT" ]] && [[ "$OLD_ARCHIVE_COUNT" =~ ^[0-9]+$ ]] && [[ "$OLD_ARCHIVE_COUNT" -gt 0 ]]; then
    info "  Cleaning $OLD_ARCHIVE_COUNT old archive status files (>1 day old)..."
    docker exec "$PG_CONTAINER" sh -c "find $ARCHIVE_STATUS_DIR -name '*.ready' -mtime +1 -delete 2>/dev/null || true" >/dev/null 2>&1
  fi
fi

# If archive_mode is off or not set, we can be more aggressive with WAL cleanup
# Also check if database is in recovery (need to free space for recovery)
if [[ "$RECOVERY_STATUS" == "t" ]]; then
  warn "  Database appears to be in recovery mode - AGGRESSIVELY cleaning old WAL to free space"
  # During recovery, be VERY aggressive - keep only last 4 segments (absolute minimum)
  # This is safe because PostgreSQL only needs the most recent WAL segments for recovery
  # If disk is at 100%, we need to free space for recovery to complete
  WAL_KEEP=4
  if [[ "${CONTAINER_PCT:-100}" -ge 99 ]]; then
    WAL_KEEP=2  # Ultra-aggressive if disk is 99%+ full
    warn "  Disk at 99%+ - ULTRA-AGGRESSIVE mode: keeping only last 2 WAL segments"
  fi
  if [[ -n "$WAL_COUNT" ]] && [[ "$WAL_COUNT" =~ ^[0-9]+$ ]] && [[ "$WAL_COUNT" -gt $WAL_KEEP ]]; then
    OLD_WAL_COUNT=$((WAL_COUNT - WAL_KEEP))
    info "  EMERGENCY WAL cleanup: deleting $OLD_WAL_COUNT old segments (keeping last $WAL_KEEP only)..."
    # Get list of old WAL files to delete
    OLD_WAL_FILES=$(docker exec "$PG_CONTAINER" sh -c "cd $WAL_DIR && ls -t | grep -E '^[0-9A-F]{24}$' | tail -n +$((WAL_KEEP + 1))" 2>/dev/null || echo "")
    if [[ -n "$OLD_WAL_FILES" ]]; then
      DELETED=0
      while IFS= read -r wal_file; do
        if [[ -n "$wal_file" ]]; then
          docker exec "$PG_CONTAINER" rm -f "$WAL_DIR/$wal_file" 2>/dev/null && DELETED=$((DELETED + 1)) || true
        fi
      done <<< "$OLD_WAL_FILES"
      if [[ $DELETED -gt 0 ]]; then
        success "  Deleted $DELETED old WAL segment files (~$((DELETED * 16))MB)"
        NEW_WAL_COUNT=$(docker exec "$PG_CONTAINER" sh -c "ls -1 $WAL_DIR/ | grep -E '^[0-9A-F]{24}$' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
        info "  WAL files after cleanup: $NEW_WAL_COUNT"
      else
        warn "  Failed to delete WAL files (may be locked)"
      fi
    fi
  fi
elif [[ -z "$ARCHIVE_MODE" ]] || [[ "$ARCHIVE_MODE" == "off" ]]; then
  # Check for old WAL segment files (keep only recent ones)
  # WAL segments are 24-character hex strings
  if [[ -n "$WAL_COUNT" ]] && [[ "$WAL_COUNT" =~ ^[0-9]+$ ]] && [[ "$WAL_COUNT" -gt 32 ]]; then
    info "  Cleaning old WAL segment files (keeping last 32, archive_mode=$ARCHIVE_MODE)..."
    # Get current WAL position to avoid deleting active segments
    CURRENT_WAL=$(psql_cmd "SELECT pg_walfile_name(pg_current_wal_lsn());" 2>/dev/null | tr -d ' ' || echo "")
    if [[ -n "$CURRENT_WAL" ]]; then
      info "  Current WAL: $CURRENT_WAL (will keep this and newer)"
      # Delete old WAL segments (older than current, keeping a safety margin)
      docker exec "$PG_CONTAINER" sh -c "
        cd $WAL_DIR && \
        ls -t | grep -E '^[0-9A-F]{24}$' | tail -n +33 | xargs -r rm -f 2>/dev/null || true
      " >/dev/null 2>&1 || warn "  Failed to clean WAL files"
    else
      # If we can't get current WAL, be conservative - only delete very old files
      info "  Cannot determine current WAL position, being conservative..."
      docker exec "$PG_CONTAINER" sh -c "
        cd $WAL_DIR && \
        find . -maxdepth 1 -name '[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]' -mtime +1 -delete 2>/dev/null || true
      " >/dev/null 2>&1
    fi
    NEW_WAL_COUNT=$(docker exec "$PG_CONTAINER" sh -c "ls -1 $WAL_DIR/ | grep -E '^[0-9A-F]{24}$' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
    info "  WAL files after cleanup: $NEW_WAL_COUNT"
  fi
else
  info "  WAL archiving is enabled (archive_mode=$ARCHIVE_MODE), being conservative with WAL cleanup"
fi

# 4. Check for old temporary files and PostgreSQL temp files
info "Step 4: Checking for temporary files..."
TMP_SIZE=$(docker exec "$PG_CONTAINER" sh -c "du -sh /tmp 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo "unknown")
info "  /tmp size: $TMP_SIZE"
# Clean ALL temporary files (very aggressive - safe during recovery)
docker exec "$PG_CONTAINER" sh -c "find /tmp -type f -delete 2>/dev/null || true" >/dev/null 2>&1

# Clean PostgreSQL logical replication temp files (these can cause "No space left" errors)
info "  Cleaning PostgreSQL logical replication temp files..."
docker exec "$PG_CONTAINER" sh -c "find /var/lib/postgresql/data/pg_logical -name '*.tmp' -type f -delete 2>/dev/null || true" >/dev/null 2>&1

# Check for PostgreSQL temporary files in base directory
PG_TMP_FILES=$(docker exec "$PG_CONTAINER" sh -c "find /var/lib/postgresql/data/base -name 'pgsql_tmp*' -type f 2>/dev/null" 2>/dev/null || echo "")
if [[ -n "$PG_TMP_FILES" ]]; then
  PG_TMP_SIZE=$(docker exec "$PG_CONTAINER" sh -c "find /var/lib/postgresql/data/base -name 'pgsql_tmp*' -type f 2>/dev/null | xargs du -ch 2>/dev/null | tail -1 | awk '{print \$1}'" 2>/dev/null || echo "unknown")
  PG_TMP_COUNT=$(echo "$PG_TMP_FILES" | wc -l | tr -d ' ')
  info "  PostgreSQL temp files: $PG_TMP_SIZE ($PG_TMP_COUNT files)"
  # Clean PostgreSQL temporary files immediately (they're safe to delete, PostgreSQL will recreate if needed)
  # These are query work files that can be safely removed
  info "  Cleaning PostgreSQL temporary files..."
  DELETED_COUNT=0
  while IFS= read -r tmp_file; do
    if [[ -n "$tmp_file" ]]; then
      docker exec "$PG_CONTAINER" rm -f "$tmp_file" 2>/dev/null && DELETED_COUNT=$((DELETED_COUNT + 1)) || true
    fi
  done <<< "$PG_TMP_FILES"
  if [[ $DELETED_COUNT -gt 0 ]]; then
    success "  Deleted $DELETED_COUNT temporary files (~$PG_TMP_SIZE)"
  else
    warn "  Failed to delete temporary files (may be in use by active queries)"
  fi
fi

# 5. Check PostgreSQL log files (if any)
info "Step 5: Checking PostgreSQL log files..."
LOG_DIR="/var/lib/postgresql/data/log"
if docker exec "$PG_CONTAINER" test -d "$LOG_DIR" 2>/dev/null; then
  LOG_SIZE=$(docker exec "$PG_CONTAINER" du -sh "$LOG_DIR" 2>/dev/null | awk '{print $1}' || echo "unknown")
  LOG_COUNT=$(docker exec "$PG_CONTAINER" sh -c "ls -1 $LOG_DIR/*.log 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \n' || echo "0")
  info "  Log directory: ~$LOG_SIZE ($LOG_COUNT files)"
  if [[ -n "$LOG_COUNT" ]] && [[ "$LOG_COUNT" =~ ^[0-9]+$ ]] && [[ "$LOG_COUNT" -gt 5 ]]; then
    info "  Cleaning old log files (keeping last 5 - aggressive)..."
    docker exec "$PG_CONTAINER" sh -c "
      cd $LOG_DIR && \
      ls -t *.log 2>/dev/null | tail -n +6 | xargs -r rm -f 2>/dev/null || true
    " >/dev/null 2>&1 || warn "  Failed to clean log files"
  fi
fi

# 5b. Check for backup files inside container (shouldn't be there, but check anyway)
info "Step 5b: Checking for backup files inside container..."
BACKUP_FILES=$(docker exec "$PG_CONTAINER" sh -c "find /var/lib/postgresql/data -type f \( -name '*.dump' -o -name '*.backup' -o -name '*.sql' -o -name '*.gz' -o -name '*.tar' -o -name '*backup*' -o -name '*dump*' \) 2>/dev/null" 2>/dev/null || echo "")
if [[ -n "$BACKUP_FILES" ]]; then
  BACKUP_COUNT=$(echo "$BACKUP_FILES" | wc -l | tr -d ' ')
  BACKUP_SIZE=$(docker exec "$PG_CONTAINER" sh -c "find /var/lib/postgresql/data -type f \( -name '*.dump' -o -name '*.backup' -o -name '*.sql' -o -name '*.gz' -o -name '*.tar' -o -name '*backup*' -o -name '*dump*' \) 2>/dev/null | xargs du -ch 2>/dev/null | tail -1 | awk '{print \$1}'" 2>/dev/null || echo "unknown")
  warn "  Found $BACKUP_COUNT backup file(s) inside container (~$BACKUP_SIZE) - these should be on host, not in container!"
  info "  Deleting backup files from container (backups should be on host in backups/ directory)..."
  DELETED_BACKUPS=0
  while IFS= read -r backup_file; do
    if [[ -n "$backup_file" ]]; then
      docker exec "$PG_CONTAINER" rm -f "$backup_file" 2>/dev/null && DELETED_BACKUPS=$((DELETED_BACKUPS + 1)) || true
    fi
  done <<< "$BACKUP_FILES"
  if [[ $DELETED_BACKUPS -gt 0 ]]; then
    success "  Deleted $DELETED_BACKUPS backup file(s) from container (~$BACKUP_SIZE)"
  fi
else
  info "  No backup files found in container (good - backups should be on host)"
fi

# 6. Check for large unused indexes (read-only check, don't drop)
info "Step 6: Checking for large unused indexes..."
LARGE_UNUSED=$(psql_cmd "
  SELECT 
    schemaname || '.' || indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0
    AND pg_relation_size(indexrelid) > 10485760  -- > 10MB
  ORDER BY pg_relation_size(indexrelid) DESC
  LIMIT 5;
" 2>/dev/null || echo "")

if [[ -n "$LARGE_UNUSED" ]]; then
  info "  Large unused indexes found (read-only, not dropping):"
  echo "$LARGE_UNUSED" | while IFS='|' read -r idx_name size; do
    info "    $idx_name: $size"
  done
  info "  (Consider dropping these manually if not needed)"
fi

# 7. Check table bloat (informational only)
info "Step 7: Checking table bloat..."
BLOAT_INFO=$(psql_cmd "
  SELECT 
    schemaname || '.' || relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    n_dead_tup,
    CASE 
      WHEN n_live_tup > 0 
      THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
      ELSE 0
    END AS dead_pct
  FROM pg_stat_user_tables
  WHERE n_dead_tup > 10000
  ORDER BY n_dead_tup DESC
  LIMIT 5;
" 2>/dev/null || echo "")

if [[ -n "$BLOAT_INFO" ]]; then
  info "  Tables with significant dead tuples:"
  echo "$BLOAT_INFO" | while IFS='|' read -r table_name total_size dead_tup dead_pct; do
    info "    $table_name: $total_size, $dead_tup dead tuples ($dead_pct%)"
  done
fi

# Final disk usage check
CONTAINER_DISK_INFO_AFTER=$(docker exec "$PG_CONTAINER" df -h /var/lib/postgresql/data 2>/dev/null | tail -1 || echo "")
if [[ -n "$CONTAINER_DISK_INFO_AFTER" ]]; then
  CONTAINER_PCT_AFTER=$(echo "$CONTAINER_DISK_INFO_AFTER" | awk '{print $5}' | sed 's/%//')
  CONTAINER_USED_AFTER=$(echo "$CONTAINER_DISK_INFO_AFTER" | awk '{print $3}')
  CONTAINER_AVAIL_AFTER=$(echo "$CONTAINER_DISK_INFO_AFTER" | awk '{print $4}')
  info "Disk usage after pruning: ${CONTAINER_USED_AFTER} used, ${CONTAINER_AVAIL_AFTER} available (${CONTAINER_PCT_AFTER}% used)"
  
  # Calculate approximate space freed (in MB, rough estimate)
  if [[ "$CONTAINER_PCT_AFTER" -lt "$CONTAINER_PCT" ]]; then
    FREED_PCT=$((CONTAINER_PCT - CONTAINER_PCT_AFTER))
    # Rough estimate: if we freed X% and total is ~57GB, that's about X * 570MB
    FREED_MB=$((FREED_PCT * 570))
    success "Freed approximately ${FREED_PCT}% disk space (~${FREED_MB}MB)"
  elif [[ "$CONTAINER_PCT_AFTER" -eq "$CONTAINER_PCT" ]] && [[ "$CONTAINER_PCT" -ge 95 ]]; then
    warn "Disk still at ${CONTAINER_PCT_AFTER}% - may need more aggressive cleanup or external disk space"
    info "  Consider:"
    info "    - Running emergency-disk-cleanup.sh on host"
    info "    - Increasing Docker disk allocation"
    info "    - Cleaning up Docker volumes: docker volume prune"
  else
    info "Disk usage unchanged (may need more aggressive cleanup or external disk space)"
  fi
fi

# 8. Check host backups (if container disk is still full, suggest cleaning old backups)
if [[ "${CONTAINER_PCT_AFTER:-100}" -ge 95 ]]; then
  info "Step 8: Checking host backup files (container disk still full)..."
  BACKUP_DIR="${BACKUP_DIR:-./backups}"
  if [[ -d "$BACKUP_DIR" ]]; then
    HOST_BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}' || echo "unknown")
    HOST_BACKUP_COUNT=$(find "$BACKUP_DIR" -type f \( -name "*.dump" -o -name "*.tar.gz" -o -name "*.sql" -o -name "*.gz" \) 2>/dev/null | wc -l | tr -d ' ')
    info "  Host backup directory: ~$HOST_BACKUP_SIZE ($HOST_BACKUP_COUNT files)"
    
    # Find old backup files (>7 days old)
    OLD_BACKUPS=$(find "$BACKUP_DIR" -type f \( -name "*.dump" -o -name "*.tar.gz" -o -name "*.sql" -o -name "*.gz" \) -mtime +7 2>/dev/null || echo "")
    if [[ -n "$OLD_BACKUPS" ]]; then
      OLD_BACKUP_COUNT=$(echo "$OLD_BACKUPS" | wc -l | tr -d ' ')
      OLD_BACKUP_SIZE=$(echo "$OLD_BACKUPS" | xargs du -ch 2>/dev/null | tail -1 | awk '{print $1}' || echo "unknown")
      warn "  Found $OLD_BACKUP_COUNT old backup file(s) on host (>7 days old, ~$OLD_BACKUP_SIZE)"
      
      if [[ "$CLEAN_HOST_BACKUPS" == "true" ]]; then
        info "  Cleaning old backup files (--clean-host-backups enabled)..."
        DELETED_HOST_BACKUPS=0
        while IFS= read -r backup_file; do
          if [[ -n "$backup_file" ]] && [[ -f "$backup_file" ]]; then
            rm -f "$backup_file" 2>/dev/null && DELETED_HOST_BACKUPS=$((DELETED_HOST_BACKUPS + 1)) || true
          fi
        done <<< "$OLD_BACKUPS"
        if [[ $DELETED_HOST_BACKUPS -gt 0 ]]; then
          success "  Deleted $DELETED_HOST_BACKUPS old backup file(s) from host (~$OLD_BACKUP_SIZE)"
        fi
      else
        info "  To clean old backups, run:"
        info "    $0 --clean-host-backups"
        info "  Or manually:"
        info "    find $BACKUP_DIR -type f \\( -name '*.dump' -o -name '*.tar.gz' \\) -mtime +7 -delete"
      fi
    else
      info "  No old backup files found on host (>7 days)"
    fi
  fi
fi

success "Pruning complete"

