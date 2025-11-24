#!/usr/bin/env bash
set -euo pipefail

# Comprehensive disk space cleanup script
# This script cleans up:
# - Old Docker images and build cache
# - Old benchmark logs (keeps last 7 days)
# - Old backups (keeps last 3 backups)
# - Unused Docker volumes (with confirmation)
# - Old PostgreSQL WAL files if any

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KEEP_BACKUPS="${KEEP_BACKUPS:-3}"  # Keep last N backups
KEEP_BENCH_LOGS_DAYS="${KEEP_BENCH_LOGS_DAYS:-7}"  # Keep last N days of bench logs
DRY_RUN="${DRY_RUN:-false}"

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

echo "=== Disk Space Cleanup Script ==="
echo ""

# Check current disk usage
log "Current disk usage:"
df -h . | head -2
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN MODE - No files will be deleted"
  echo ""
fi

# 1. Clean up old backups (keep last N)
log "Step 1: Cleaning old backups (keeping last $KEEP_BACKUPS)..."
if [[ -d "backups" ]]; then
  BACKUP_COUNT=$(find backups/ -type f -name "*.tar.gz" -o -name "*.sql" -o -name "*.dump" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$BACKUP_COUNT" -gt "$KEEP_BACKUPS" ]]; then
    OLD_BACKUPS=$(find backups/ -type f \( -name "*.tar.gz" -o -name "*.sql" -o -name "*.dump" \) -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n +$((KEEP_BACKUPS + 1)) | cut -d' ' -f2-)
    if [[ -n "$OLD_BACKUPS" ]]; then
      OLD_SIZE=$(du -ch $OLD_BACKUPS 2>/dev/null | tail -1 | cut -f1)
      if [[ "$DRY_RUN" == "true" ]]; then
        info "Would delete $(echo "$OLD_BACKUPS" | wc -l | tr -d ' ') old backup(s) ($OLD_SIZE)"
        echo "$OLD_BACKUPS" | while read -r f; do echo "  - $f"; done
      else
        echo "$OLD_BACKUPS" | while read -r f; do
          rm -f "$f" && info "Deleted: $f"
        done
        ok "Cleaned up old backups: $OLD_SIZE freed"
      fi
    fi
  else
    info "Only $BACKUP_COUNT backup(s) found, keeping all"
  fi
else
  info "No backups directory found"
fi
echo ""

# 2. Clean up old benchmark logs
log "Step 2: Cleaning benchmark logs older than $KEEP_BENCH_LOGS_DAYS days..."
if [[ -d "bench_logs" ]]; then
  OLD_LOGS=$(find bench_logs/ -type f -mtime +$KEEP_BENCH_LOGS_DAYS 2>/dev/null)
  if [[ -n "$OLD_LOGS" ]]; then
    OLD_COUNT=$(echo "$OLD_LOGS" | wc -l | tr -d ' ')
    OLD_SIZE=$(du -ch $OLD_LOGS 2>/dev/null | tail -1 | cut -f1 || echo "0")
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would delete $OLD_COUNT old log file(s) ($OLD_SIZE)"
    else
      echo "$OLD_LOGS" | xargs rm -f 2>/dev/null || true
      # Clean up empty directories
      find bench_logs/ -type d -empty -delete 2>/dev/null || true
      ok "Cleaned up $OLD_COUNT old log file(s): $OLD_SIZE freed"
    fi
  else
    info "No old benchmark logs found"
  fi
else
  info "No bench_logs directory found"
fi
echo ""

# 3. Clean up Docker build cache
log "Step 3: Cleaning Docker build cache..."
DOCKER_CACHE_SIZE=$(docker system df | grep "Build Cache" | awk '{print $4}' | head -1)
if [[ "$DOCKER_CACHE_SIZE" != "0B" ]] && [[ -n "$DOCKER_CACHE_SIZE" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would clean Docker build cache ($DOCKER_CACHE_SIZE)"
  else
    docker builder prune -f >/dev/null 2>&1
    ok "Cleaned Docker build cache: $DOCKER_CACHE_SIZE freed"
  fi
else
  info "No Docker build cache to clean"
fi
echo ""

# 4. Clean up unused Docker images
log "Step 4: Cleaning unused Docker images..."
UNUSED_IMAGES=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l | tr -d ' ')
if [[ "$UNUSED_IMAGES" -gt 0 ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would remove $UNUSED_IMAGES dangling image(s)"
  else
    docker image prune -f >/dev/null 2>&1
    ok "Cleaned up $UNUSED_IMAGES dangling image(s)"
  fi
else
  info "No dangling images to clean"
fi
echo ""

# 5. Show unused volumes (but don't delete without confirmation)
log "Step 5: Checking for unused Docker volumes..."
UNUSED_VOLUMES=$(docker volume ls -f "dangling=true" -q 2>/dev/null | wc -l | tr -d ' ')
if [[ "$UNUSED_VOLUMES" -gt 0 ]]; then
  warn "Found $UNUSED_VOLUMES unused volume(s)"
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would remove unused volumes (use --force to actually delete)"
  else
    info "To remove unused volumes, run: docker volume prune -f"
    info "⚠️  WARNING: This will delete unused volumes. Make sure you have backups!"
  fi
else
  info "No unused volumes found"
fi
echo ""

# 6. Show largest Docker volumes
log "Step 6: Largest Docker volumes:"
docker system df -v 2>/dev/null | grep -A 20 "Local Volumes space usage" | grep -E "^[a-z]" | head -10 | while read -r line; do
  VOL_NAME=$(echo "$line" | awk '{print $1}')
  VOL_SIZE=$(echo "$line" | awk '{print $NF}')
  info "  $VOL_NAME: $VOL_SIZE"
done
echo ""

# 7. Summary
log "Step 7: Final disk usage:"
df -h . | head -2
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN complete - no files were deleted"
  echo "To actually clean up, run: DRY_RUN=false $0"
else
  ok "Cleanup complete!"
  echo ""
  info "To free more space:"
  info "  - Remove unused volumes: docker volume prune -f (⚠️  dangerous!)"
  info "  - Remove all unused images: docker image prune -a -f"
  info "  - Full Docker cleanup: docker system prune -a --volumes -f (⚠️  very dangerous!)"
fi

