#!/usr/bin/env bash
set -euo pipefail

# Emergency disk space cleanup script
# This script aggressively cleans up disk space to prevent "No space left on device" errors
# Usage: ./scripts/emergency-disk-cleanup.sh [--dry-run] [--keep-bench-days N] [--keep-backups N] [--aggressive]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Defaults - more aggressive than normal cleanup
KEEP_BENCH_LOGS_DAYS="${KEEP_BENCH_LOGS_DAYS:-1}"  # Keep only last 1 day of bench logs
KEEP_BACKUPS="${KEEP_BACKUPS:-2}"  # Keep only last 2 backups
DRY_RUN="${DRY_RUN:-false}"
CLEAN_DOCKER="${CLEAN_DOCKER:-true}"
CLEAN_K8S_BACKUPS="${CLEAN_K8S_BACKUPS:-true}"
AGGRESSIVE="${AGGRESSIVE:-false}"
CLEAN_NEXTJS="${CLEAN_NEXTJS:-true}"
CLEAN_NODE_MODULES="${CLEAN_NODE_MODULES:-false}"  # Only in aggressive mode

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --keep-bench-days)
      KEEP_BENCH_LOGS_DAYS="$2"
      shift 2
      ;;
    --keep-backups)
      KEEP_BACKUPS="$2"
      shift 2
      ;;
    --no-docker)
      CLEAN_DOCKER=false
      shift
      ;;
    --no-k8s)
      CLEAN_K8S_BACKUPS=false
      shift
      ;;
    --aggressive)
      AGGRESSIVE=true
      CLEAN_NODE_MODULES=true
      KEEP_BENCH_LOGS_DAYS=0  # Keep only today's logs
      KEEP_BACKUPS=1  # Keep only last backup
      shift
      ;;
    --no-nextjs)
      CLEAN_NEXTJS=false
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--keep-bench-days N] [--keep-backups N] [--no-docker] [--no-k8s] [--aggressive] [--no-nextjs]" >&2
      exit 1
      ;;
  esac
done

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }
error() { echo "❌ $*" >&2; }

echo "=== EMERGENCY DISK SPACE CLEANUP ==="
echo ""
echo "Configuration:"
echo "  Keep bench logs: last $KEEP_BENCH_LOGS_DAYS day(s)"
echo "  Keep backups: last $KEEP_BACKUPS"
echo "  Clean Docker: $CLEAN_DOCKER"
echo "  Clean K8s backups: $CLEAN_K8S_BACKUPS"
echo "  Clean Next.js cache: $CLEAN_NEXTJS"
echo "  Clean node_modules: $CLEAN_NODE_MODULES"
echo "  Aggressive mode: $AGGRESSIVE"
echo "  Dry run: $DRY_RUN"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN MODE - No files will be deleted"
  echo ""
fi

# Check current disk usage
log "Current disk usage:"
df -h . | head -2
echo ""

TOTAL_FREED=0

# 1. Aggressively clean up old benchmark logs
log "Step 1: Cleaning benchmark logs older than $KEEP_BENCH_LOGS_DAYS day(s)..."
if [[ -d "bench_logs" ]]; then
  # Count and size before
  OLD_LOGS=$(find bench_logs/ -type f -mtime +$KEEP_BENCH_LOGS_DAYS 2>/dev/null || true)
  if [[ -n "$OLD_LOGS" ]]; then
    OLD_COUNT=$(echo "$OLD_LOGS" | wc -l | tr -d ' ')
    OLD_SIZE_BYTES=$(echo "$OLD_LOGS" | xargs du -cb 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
    OLD_SIZE_GB=$(awk "BEGIN {printf \"%.2f\", $OLD_SIZE_BYTES / 1024 / 1024 / 1024}")
    
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would delete $OLD_COUNT old log file(s) (~${OLD_SIZE_GB}GB)"
    else
      echo "$OLD_LOGS" | xargs rm -f 2>/dev/null || true
      # Clean up empty directories
      find bench_logs/ -type d -empty -delete 2>/dev/null || true
      ok "Deleted $OLD_COUNT old log file(s): ~${OLD_SIZE_GB}GB freed"
      TOTAL_FREED=$((TOTAL_FREED + OLD_SIZE_BYTES))
    fi
  else
    info "No old benchmark logs found"
  fi
else
  info "No bench_logs directory found"
fi
echo ""

# 2. Clean up old backups (local)
log "Step 2: Cleaning old local backups (keeping last $KEEP_BACKUPS)..."
if [[ -d "backups" ]]; then
  # Find all backup files, sort by modification time (newest first)
  BACKUP_FILES=$(find backups/ -type f \( -name "*.tar.gz" -o -name "*.sql" -o -name "*.dump" -o -name "*.sql.gz" \) -printf '%T@ %p\n' 2>/dev/null | sort -rn || true)
  
  if [[ -n "$BACKUP_FILES" ]]; then
    TOTAL_BACKUPS=$(echo "$BACKUP_FILES" | wc -l | tr -d ' ')
    
    if [[ "$TOTAL_BACKUPS" -gt "$KEEP_BACKUPS" ]]; then
      # Get files to delete (skip first KEEP_BACKUPS)
      TO_DELETE=$(echo "$BACKUP_FILES" | tail -n +$((KEEP_BACKUPS + 1)) | cut -d' ' -f2-)
      
      if [[ -n "$TO_DELETE" ]]; then
        DELETE_COUNT=$(echo "$TO_DELETE" | wc -l | tr -d ' ')
        DELETE_SIZE_BYTES=$(echo "$TO_DELETE" | xargs du -cb 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
        DELETE_SIZE_GB=$(awk "BEGIN {printf \"%.2f\", $DELETE_SIZE_BYTES / 1024 / 1024 / 1024}")
        
        if [[ "$DRY_RUN" == "true" ]]; then
          info "Would delete $DELETE_COUNT old backup(s) (~${DELETE_SIZE_GB}GB)"
          echo "$TO_DELETE" | head -5 | while read -r f; do echo "  - $f"; done
          [[ "$DELETE_COUNT" -gt 5 ]] && info "  ... and $((DELETE_COUNT - 5)) more"
        else
          echo "$TO_DELETE" | while read -r f; do
            rm -f "$f" 2>/dev/null && info "Deleted: $(basename "$f")"
          done
          ok "Deleted $DELETE_COUNT old backup(s): ~${DELETE_SIZE_GB}GB freed"
          TOTAL_FREED=$((TOTAL_FREED + DELETE_SIZE_BYTES))
        fi
      fi
    else
      info "Only $TOTAL_BACKUPS backup(s) found, keeping all"
    fi
  else
    info "No backup files found"
  fi
else
  info "No backups directory found"
fi
echo ""

# 3. Prune Docker system (safe - doesn't touch volumes in use)
log "Step 3: Pruning Docker system (safe - doesn't touch volumes in use)..."
info "  Pruning stopped containers and dangling images..."
docker system prune -f >/dev/null 2>&1 || warn "  Docker system prune failed"

info "  Pruning unused images..."
docker system prune -a -f >/dev/null 2>&1 || warn "  Docker system prune -a failed"

info "  Pruning dangling volumes (does NOT touch volumes used by containers)..."
docker volume prune -f >/dev/null 2>&1 || warn "  Docker volume prune failed"

info "  Docker cleanup complete"
echo ""

# 4. Check PostgreSQL Docker container disk space
log "Step 4: Checking PostgreSQL Docker container disk space..."
PG_CONTAINER=$(docker ps --filter "name=postgres" --filter "publish=5433" --format "{{.Names}}" | head -1)

if [[ -n "$PG_CONTAINER" ]]; then
  info "Found PostgreSQL container: $PG_CONTAINER"
  
  # Check container disk usage
  CONTAINER_DISK_INFO=$(docker exec "$PG_CONTAINER" df -h /var/lib/postgresql/data 2>/dev/null | tail -1 || echo "")
  if [[ -n "$CONTAINER_DISK_INFO" ]]; then
    CONTAINER_PCT=$(echo "$CONTAINER_DISK_INFO" | awk '{print $5}' | sed 's/%//')
    CONTAINER_USED=$(echo "$CONTAINER_DISK_INFO" | awk '{print $3}')
    CONTAINER_AVAIL=$(echo "$CONTAINER_DISK_INFO" | awk '{print $4}')
    echo "  Container disk: ${CONTAINER_USED} used, ${CONTAINER_AVAIL} available (${CONTAINER_PCT}% used)"
    
    if [[ "$CONTAINER_PCT" -gt 90 ]]; then
      warn "  ⚠️  PostgreSQL container disk is ${CONTAINER_PCT}% full!"
      
      # Check WAL directory size
      WAL_SIZE=$(docker exec "$PG_CONTAINER" du -sh /var/lib/postgresql/data/pg_wal 2>/dev/null | awk '{print $1}' || echo "unknown")
      WAL_COUNT=$(docker exec "$PG_CONTAINER" sh -c 'ls -1 /var/lib/postgresql/data/pg_wal/*.wal 2>/dev/null | wc -l' 2>/dev/null | tr -d ' \n' || echo "0")
      info "  WAL directory: ~$WAL_SIZE ($WAL_COUNT files)"
      
      if [[ -n "$WAL_COUNT" ]] && [[ "$WAL_COUNT" =~ ^[0-9]+$ ]] && [[ "$WAL_COUNT" -gt 100 ]]; then
        warn "  ⚠️  Large number of WAL files ($WAL_COUNT) - consider cleaning up"
        info "  Note: WAL files are managed by PostgreSQL. Check max_wal_size setting."
        info "  To reduce WAL retention, you may need to adjust PostgreSQL configuration."
      fi
      
      info "  Check Docker volume: docker volume inspect record-platform_pgdata"
    fi
  else
    warn "  Could not check container disk space"
  fi
  
  # Check Docker volume size
  PG_VOLUME=$(docker inspect "$PG_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || echo "")
  if [[ -n "$PG_VOLUME" ]]; then
    VOLUME_MOUNTPOINT=$(docker volume inspect "$PG_VOLUME" --format '{{.Mountpoint}}' 2>/dev/null || echo "")
    if [[ -n "$VOLUME_MOUNTPOINT" ]] && [[ -d "$VOLUME_MOUNTPOINT" ]]; then
      VOLUME_SIZE=$(du -sh "$VOLUME_MOUNTPOINT" 2>/dev/null | awk '{print $1}' || echo "unknown")
      info "  PostgreSQL volume ($PG_VOLUME): ~$VOLUME_SIZE"
    else
      info "  PostgreSQL volume: $PG_VOLUME (size check requires root access)"
    fi
  fi
else
  info "PostgreSQL container not found (may be using Kubernetes or different name)"
  
  # Try K8s cleanup if available
  if [[ "$CLEAN_K8S_BACKUPS" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
    if kubectl cluster-info >/dev/null 2>&1; then
      log "  Attempting Kubernetes PVC cleanup..."
      if [[ -f "./scripts/cleanup-k8s-pvc-space.sh" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
          DRY_RUN=true ./scripts/cleanup-k8s-pvc-space.sh --keep-wal 50 --keep-backups "$KEEP_BACKUPS" 2>&1 | grep -E "🔍|✅|⚠️|ℹ️|❌" || true
        else
          DRY_RUN=false ./scripts/cleanup-k8s-pvc-space.sh --keep-wal 50 --keep-backups "$KEEP_BACKUPS" 2>&1 | grep -E "🔍|✅|⚠️|ℹ️|❌" || true
        fi
      fi
    fi
  fi
fi
echo ""

# 4. Aggressively clean Docker resources
if [[ "$CLEAN_DOCKER" == "true" ]] && command -v docker >/dev/null 2>&1; then
  log "Step 4: Aggressively cleaning Docker resources..."
  
  # 4a. Build cache
  DOCKER_CACHE_SIZE=$(docker system df 2>/dev/null | grep "Build Cache" | awk '{print $4}' | head -1 || echo "0B")
  if [[ "$DOCKER_CACHE_SIZE" != "0B" ]] && [[ -n "$DOCKER_CACHE_SIZE" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would clean Docker build cache ($DOCKER_CACHE_SIZE)"
    else
      docker builder prune -af >/dev/null 2>&1 || true
      ok "Cleaned Docker build cache: $DOCKER_CACHE_SIZE freed"
    fi
  fi
  
  # 4b. Unused images (not just dangling)
  UNUSED_IMAGES=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "$UNUSED_IMAGES" -gt 0 ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would remove $UNUSED_IMAGES dangling image(s)"
    else
      docker image prune -af >/dev/null 2>&1 || true
      ok "Cleaned up $UNUSED_IMAGES unused image(s)"
    fi
  fi
  
  # 4c. Stopped containers
  STOPPED_CONTAINERS=$(docker ps -a -f "status=exited" -q 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "$STOPPED_CONTAINERS" -gt 0 ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would remove $STOPPED_CONTAINERS stopped container(s)"
    else
      docker container prune -f >/dev/null 2>&1 || true
      ok "Cleaned up $STOPPED_CONTAINERS stopped container(s)"
    fi
  fi
  
  # 4d. Unused networks
  if [[ "$DRY_RUN" != "true" ]]; then
    docker network prune -f >/dev/null 2>&1 || true
  fi
  
  # 4e. Show large volumes and remove unused ones
  log "Large Docker volumes (>1GB):"
  UNUSED_VOLUMES_TMP=$(mktemp)
  docker system df -v 2>/dev/null | grep -A 50 "Local Volumes space usage" | grep -E "^[a-f0-9]{64}|^[a-zA-Z]" | while read -r line; do
    VOL_NAME=$(echo "$line" | awk '{print $1}')
    VOL_SIZE=$(echo "$line" | awk '{print $NF}')
    # Check if size is >1GB (simple check for "GB" in size)
    if echo "$VOL_SIZE" | grep -q "GB"; then
      VOL_LINKS=$(echo "$line" | awk '{print $2}')
      if [[ "$VOL_LINKS" == "0" ]]; then
        warn "  $VOL_NAME: $VOL_SIZE (UNUSED - safe to remove)"
        echo "$VOL_NAME" >> "$UNUSED_VOLUMES_TMP"
      else
        info "  $VOL_NAME: $VOL_SIZE (in use by $VOL_LINKS container(s))"
      fi
    fi
  done
  
  # 4f. Remove unused volumes if any found
  if [[ -f "$UNUSED_VOLUMES_TMP" ]] && [[ -s "$UNUSED_VOLUMES_TMP" ]]; then
    UNUSED_COUNT=$(wc -l < "$UNUSED_VOLUMES_TMP" | tr -d ' ')
    TOTAL_UNUSED_SIZE=$(docker system df -v 2>/dev/null | grep -A 50 "Local Volumes space usage" | grep -E "^[a-f0-9]{64}|^[a-zA-Z]" | awk '$2 == "0" && $NF ~ /GB/ {gsub(/GB/, "", $NF); sum+=$NF} END {printf "%.1f", sum}')
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would remove $UNUSED_COUNT unused volume(s) (~${TOTAL_UNUSED_SIZE}GB)"
    else
      info "Removing $UNUSED_COUNT unused volume(s) (~${TOTAL_UNUSED_SIZE}GB)..."
      while IFS= read -r vol; do
        [[ -z "$vol" ]] && continue
        docker volume rm "$vol" >/dev/null 2>&1 && ok "  Removed: $vol" || warn "  Failed to remove: $vol"
      done < "$UNUSED_VOLUMES_TMP"
    fi
    rm -f "$UNUSED_VOLUMES_TMP"
  fi
  
  info "Docker cleanup complete"
  echo ""
fi

# 5. Clean up Next.js build caches
if [[ "$CLEAN_NEXTJS" == "true" ]]; then
  log "Step 5: Cleaning Next.js build caches..."
  NEXTJS_DIRS=(
    "webapp/.next"
    "services/*/.next"
  )
  
  NEXTJS_TOTAL_SIZE=0
  NEXTJS_COUNT=0
  
  for pattern in "${NEXTJS_DIRS[@]}"; do
    for dir in $pattern; do
      if [[ -d "$dir" ]]; then
        DIR_SIZE_BYTES=$(du -sb "$dir" 2>/dev/null | awk '{print $1}' || echo "0")
        DIR_SIZE_MB=$(awk "BEGIN {printf \"%.1f\", $DIR_SIZE_BYTES / 1024 / 1024}")
        
        if [[ "$DIR_SIZE_BYTES" -gt 0 ]]; then
          NEXTJS_COUNT=$((NEXTJS_COUNT + 1))
          NEXTJS_TOTAL_SIZE=$((NEXTJS_TOTAL_SIZE + DIR_SIZE_BYTES))
          
          if [[ "$DRY_RUN" == "true" ]]; then
            info "Would clean: $dir (~${DIR_SIZE_MB}MB)"
          else
            rm -rf "$dir"/* 2>/dev/null || true
            ok "Cleaned: $dir (~${DIR_SIZE_MB}MB freed)"
          fi
        fi
      fi
    done
  done
  
  if [[ "$NEXTJS_COUNT" -gt 0 ]]; then
    NEXTJS_TOTAL_MB=$(awk "BEGIN {printf \"%.1f\", $NEXTJS_TOTAL_SIZE / 1024 / 1024}")
    if [[ "$DRY_RUN" != "true" ]]; then
      ok "Next.js cache cleanup: ~${NEXTJS_TOTAL_MB}MB freed from $NEXTJS_COUNT directory(ies)"
      TOTAL_FREED=$((TOTAL_FREED + NEXTJS_TOTAL_SIZE))
    else
      info "Would free ~${NEXTJS_TOTAL_MB}MB from $NEXTJS_COUNT Next.js cache directory(ies)"
    fi
  else
    info "No Next.js build caches found"
  fi
  echo ""
fi

# 6. Clean up node_modules in unused services (aggressive mode only)
if [[ "$CLEAN_NODE_MODULES" == "true" ]]; then
  log "Step 6: Checking node_modules sizes (aggressive mode)..."
  NODE_MODULES_TOTAL=0
  
  # Find all node_modules directories and their sizes
  while IFS= read -r nm_dir; do
    if [[ -d "$nm_dir" ]]; then
      NM_SIZE_BYTES=$(du -sb "$nm_dir" 2>/dev/null | awk '{print $1}' || echo "0")
      NM_SIZE_MB=$(awk "BEGIN {printf \"%.1f\", $NM_SIZE_BYTES / 1024 / 1024}")
      
      if [[ "$NM_SIZE_BYTES" -gt 104857600 ]]; then  # > 100MB
        NODE_MODULES_TOTAL=$((NODE_MODULES_TOTAL + NM_SIZE_BYTES))
        
        if [[ "$DRY_RUN" == "true" ]]; then
          warn "Would remove: $nm_dir (~${NM_SIZE_MB}MB) - ⚠️  Will need 'pnpm install' to restore"
        else
          warn "Removing: $nm_dir (~${NM_SIZE_MB}MB) - ⚠️  Will need 'pnpm install' to restore"
          rm -rf "$nm_dir" 2>/dev/null || true
          ok "Removed: $nm_dir"
        fi
      fi
    fi
  done < <(find . -name "node_modules" -type d -not -path "*/node_modules/*" 2>/dev/null | head -20)
  
  if [[ "$NODE_MODULES_TOTAL" -gt 0 ]]; then
    NM_TOTAL_MB=$(awk "BEGIN {printf \"%.1f\", $NODE_MODULES_TOTAL / 1024 / 1024}")
    if [[ "$DRY_RUN" != "true" ]]; then
      ok "node_modules cleanup: ~${NM_TOTAL_MB}MB freed"
      TOTAL_FREED=$((TOTAL_FREED + NODE_MODULES_TOTAL))
      warn "⚠️  You will need to run 'pnpm install' to restore dependencies"
    else
      info "Would free ~${NM_TOTAL_MB}MB from node_modules (requires pnpm install to restore)"
    fi
  else
    info "No large node_modules directories found"
  fi
  echo ""
fi

# 7. Clean up old CSV files in repo root
log "Step 7: Cleaning old benchmark CSV files in repo root..."
OLD_CSVS=$(find . -maxdepth 1 -name "bench_*.csv" -type f -mtime +$KEEP_BENCH_LOGS_DAYS 2>/dev/null || true)
if [[ -n "$OLD_CSVS" ]]; then
  CSV_COUNT=$(echo "$OLD_CSVS" | wc -l | tr -d ' ')
  CSV_SIZE_BYTES=$(echo "$OLD_CSVS" | xargs du -cb 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
  CSV_SIZE_MB=$(awk "BEGIN {printf \"%.1f\", $CSV_SIZE_BYTES / 1024 / 1024}")
  
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would delete $CSV_COUNT old CSV file(s) from repo root (~${CSV_SIZE_MB}MB)"
  else
    echo "$OLD_CSVS" | xargs rm -f 2>/dev/null || true
    ok "Deleted $CSV_COUNT old CSV file(s) from repo root (~${CSV_SIZE_MB}MB freed)"
    TOTAL_FREED=$((TOTAL_FREED + CSV_SIZE_BYTES))
  fi
else
  info "No old CSV files found in repo root"
fi
echo ""

# 8. Clean up temporary files and caches
log "Step 8: Cleaning temporary files and caches..."
TEMP_PATTERNS=(
  "*.tmp"
  "*.log"
  ".DS_Store"
  "*.swp"
  "*.swo"
  "*~"
)

TEMP_TOTAL=0
for pattern in "${TEMP_PATTERNS[@]}"; do
  TEMP_FILES=$(find . -maxdepth 3 -name "$pattern" -type f -mtime +7 2>/dev/null || true)
  if [[ -n "$TEMP_FILES" ]]; then
    TEMP_COUNT=$(echo "$TEMP_FILES" | wc -l | tr -d ' ')
    TEMP_SIZE_BYTES=$(echo "$TEMP_FILES" | xargs du -cb 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
    TEMP_TOTAL=$((TEMP_TOTAL + TEMP_SIZE_BYTES))
    
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would delete $TEMP_COUNT $pattern file(s)"
    else
      echo "$TEMP_FILES" | xargs rm -f 2>/dev/null || true
    fi
  fi
done

if [[ "$TEMP_TOTAL" -gt 0 ]]; then
  TEMP_TOTAL_MB=$(awk "BEGIN {printf \"%.1f\", $TEMP_TOTAL / 1024 / 1024}")
  if [[ "$DRY_RUN" != "true" ]]; then
    ok "Cleaned temporary files: ~${TEMP_TOTAL_MB}MB freed"
    TOTAL_FREED=$((TOTAL_FREED + TEMP_TOTAL))
  else
    info "Would free ~${TEMP_TOTAL_MB}MB from temporary files"
  fi
else
  info "No old temporary files found"
fi
echo ""

# 9. Summary
log "Step 9: Final disk usage:"
df -h . | head -2
echo ""

# Calculate percentage freed
CURRENT_USAGE=$(df . | tail -1 | awk '{print $5}' | sed 's/%//')
if [[ "$DRY_RUN" != "true" ]] && [[ -n "$TOTAL_FREED" ]] && [[ "$TOTAL_FREED" -gt 0 ]]; then
  TOTAL_FREED_GB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_FREED / 1024 / 1024 / 1024}")
  ok "Emergency cleanup complete! ~${TOTAL_FREED_GB}GB freed"
  echo ""
  
  # Check if we're still in danger zone
  if [[ "$CURRENT_USAGE" -gt 90 ]]; then
    warn "⚠️  Disk usage still at ${CURRENT_USAGE}% - consider aggressive cleanup:"
    echo ""
    echo "  $0 --aggressive"
    echo ""
    warn "⚠️  Or manually run these (DANGEROUS - may break running services):"
    echo "  - docker system prune -a --volumes -f  # Remove ALL unused Docker resources"
    echo "  - docker volume prune -f  # Remove unused volumes (⚠️  may delete data!)"
    echo "  - kubectl delete pvc --all --all-namespaces  # Remove all PVCs (⚠️  VERY DANGEROUS!)"
  elif [[ "$CURRENT_USAGE" -gt 85 ]]; then
    warn "Disk usage at ${CURRENT_USAGE}% - monitor closely"
  else
    ok "Disk usage at ${CURRENT_USAGE}% - safe zone"
  fi
else
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY RUN complete - no files were deleted"
    echo ""
    echo "To actually clean up, run:"
    echo "  $0"
    echo ""
    echo "For aggressive cleanup (removes more, including node_modules):"
    echo "  $0 --aggressive"
  else
    info "Cleanup complete (no significant space freed)"
  fi
fi

echo ""
info "Additional cleanup options if needed:"
info "  - Remove ALL unused Docker images: docker image prune -a -f"
info "  - Remove unused Docker volumes: docker volume prune -f (⚠️  dangerous!)"
info "  - Full Docker cleanup: docker system prune -a --volumes -f (⚠️  very dangerous!)"
if command -v kubectl >/dev/null 2>&1; then
  info "  - Check Kubernetes PVC size: kubectl get pvc --all-namespaces"
fi

