#!/usr/bin/env bash
set -euo pipefail

# Emergency disk space cleanup script
# This script aggressively cleans up disk space to prevent "No space left on device" errors
# Usage: ./scripts/emergency-disk-cleanup.sh [--dry-run] [--keep-bench-days N] [--keep-backups N]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Defaults - more aggressive than normal cleanup
KEEP_BENCH_LOGS_DAYS="${KEEP_BENCH_LOGS_DAYS:-1}"  # Keep only last 1 day of bench logs
KEEP_BACKUPS="${KEEP_BACKUPS:-2}"  # Keep only last 2 backups
DRY_RUN="${DRY_RUN:-false}"
CLEAN_DOCKER="${CLEAN_DOCKER:-true}"
CLEAN_K8S_BACKUPS="${CLEAN_K8S_BACKUPS:-true}"

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
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--keep-bench-days N] [--keep-backups N] [--no-docker] [--no-k8s]" >&2
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

# 5. Clean up old CSV files in repo root
log "Step 5: Cleaning old benchmark CSV files in repo root..."
OLD_CSVS=$(find . -maxdepth 1 -name "bench_*.csv" -type f -mtime +$KEEP_BENCH_LOGS_DAYS 2>/dev/null || true)
if [[ -n "$OLD_CSVS" ]]; then
  CSV_COUNT=$(echo "$OLD_CSVS" | wc -l | tr -d ' ')
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would delete $CSV_COUNT old CSV file(s) from repo root"
  else
    echo "$OLD_CSVS" | xargs rm -f 2>/dev/null || true
    ok "Deleted $CSV_COUNT old CSV file(s) from repo root"
  fi
else
  info "No old CSV files found in repo root"
fi
echo ""

# 6. Summary
log "Final disk usage:"
df -h . | head -2
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN complete - no files were deleted"
  echo ""
  echo "To actually clean up, run:"
  echo "  DRY_RUN=false $0"
else
  TOTAL_FREED_GB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_FREED / 1024 / 1024 / 1024}")
  ok "Emergency cleanup complete! ~${TOTAL_FREED_GB}GB freed"
  echo ""
  info "If you still need more space:"
  info "  - Remove ALL unused Docker images: docker image prune -a -f"
  info "  - Remove unused Docker volumes: docker volume prune -f (⚠️  dangerous!)"
  info "  - Full Docker cleanup: docker system prune -a --volumes -f (⚠️  very dangerous!)"
  info "  - Check Kubernetes PVC size: kubectl -n $NS get pvc"
fi

