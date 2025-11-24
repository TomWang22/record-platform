#!/usr/bin/env bash
set -euo pipefail

# Emergency cleanup of Kubernetes PVCs (WAL archive and backups)
# This script aggressively cleans up old files in PVCs to free space
# Usage: ./scripts/cleanup-k8s-pvc-space.sh [--dry-run] [--keep-wal N] [--keep-backups N]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NS="${NS:-record-platform}"
KEEP_WAL_FILES="${KEEP_WAL_FILES:-50}"  # Keep only last 50 WAL files (aggressive)
KEEP_BACKUPS="${KEEP_BACKUPS:-2}"  # Keep only last 2 backups of each type
DRY_RUN="${DRY_RUN:-false}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --keep-wal)
      KEEP_WAL_FILES="$2"
      shift 2
      ;;
    --keep-backups)
      KEEP_BACKUPS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--keep-wal N] [--keep-backups N]" >&2
      exit 1
      ;;
  esac
done

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }
error() { echo "❌ $*" >&2; }

echo "=== Kubernetes PVC Space Cleanup ==="
echo "Namespace: $NS"
echo "Keep WAL files: last $KEEP_WAL_FILES"
echo "Keep backups: last $KEEP_BACKUPS"
echo "Dry run: $DRY_RUN"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN MODE - No files will be deleted"
  echo ""
fi

# Check if kubectl is available
if ! command -v kubectl >/dev/null 2>&1; then
  error "kubectl not found. Cannot clean up Kubernetes PVCs."
  exit 1
fi

# Check if we can access the cluster
if ! kubectl cluster-info >/dev/null 2>&1; then
  error "Cannot access Kubernetes cluster"
  exit 1
fi

# Find PostgreSQL pod
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$PGPOD" ]]; then
  error "PostgreSQL pod not found in namespace $NS"
  exit 1
fi

info "Found PostgreSQL pod: $PGPOD"
echo ""

# 1. Clean up WAL archive
log "Step 1: Cleaning WAL archive (keeping last $KEEP_WAL_FILES files)..."
if kubectl -n "$NS" exec "$PGPOD" -c db -- test -d /wal-archive >/dev/null 2>&1; then
  BEFORE_WAL=$(kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c 'du -sh /wal-archive 2>/dev/null | cut -f1' || echo "unknown")
  WAL_COUNT=$(kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c 'ls -1 /wal-archive/[0-9]* 2>/dev/null | wc -l' || echo "0")
  
  info "Current WAL archive: $BEFORE_WAL, $WAL_COUNT files"
  
  if [[ "$WAL_COUNT" -gt "$KEEP_WAL_FILES" ]]; then
    DELETE_COUNT=$((WAL_COUNT - KEEP_WAL_FILES))
    
    if [[ "$DRY_RUN" == "true" ]]; then
      info "Would delete $DELETE_COUNT old WAL files"
    else
      kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c "
        cd /wal-archive
        ls -t [0-9]* 2>/dev/null | tail -n +$((KEEP_WAL_FILES + 1)) | xargs -r rm -f
        echo \"Deleted \$((\$(ls -1 [0-9]* 2>/dev/null | wc -l) - $KEEP_WAL_FILES)) old WAL files\"
      " 2>/dev/null || true
      
      AFTER_WAL=$(kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c 'du -sh /wal-archive 2>/dev/null | cut -f1' || echo "unknown")
      ok "WAL archive cleaned: $BEFORE_WAL -> $AFTER_WAL"
    fi
  else
    info "Only $WAL_COUNT WAL files (keeping all)"
  fi
else
  warn "WAL archive directory not found or not accessible"
fi
echo ""

# 2. Clean up backups in PVCs
log "Step 2: Cleaning backups in PVCs (keeping last $KEEP_BACKUPS of each type)..."

# Find backup pods or access PVC directly
BACKUP_PODS=$(kubectl -n "$NS" get pod -l job-name -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$BACKUP_PODS" ]]; then
  for backup_pod in $BACKUP_PODS; do
    info "Checking backup pod: $backup_pod"
    
    # Check if pod has /backups mounted
    if kubectl -n "$NS" exec "$backup_pod" -- test -d /backups >/dev/null 2>&1; then
      # Clean up different backup types
      for pattern in "*.tar.gz" "*.dump" "nightly-*.tar.gz" "basebackup-*.bundle.tar.gz" "records_*.dump"; do
        BACKUP_FILES=$(kubectl -n "$NS" exec "$backup_pod" -- bash -c "ls -1t /backups/$pattern 2>/dev/null" || echo "")
        
        if [[ -n "$BACKUP_FILES" ]]; then
          BACKUP_COUNT=$(echo "$BACKUP_FILES" | wc -l | tr -d ' ')
          
          if [[ "$BACKUP_COUNT" -gt "$KEEP_BACKUPS" ]]; then
            TO_DELETE=$(echo "$BACKUP_FILES" | tail -n +$((KEEP_BACKUPS + 1)))
            DELETE_COUNT=$(echo "$TO_DELETE" | wc -l | tr -d ' ')
            
            if [[ "$DRY_RUN" == "true" ]]; then
              info "Would delete $DELETE_COUNT old $pattern backup(s) from $backup_pod"
            else
              echo "$TO_DELETE" | while IFS= read -r f; do
                kubectl -n "$NS" exec "$backup_pod" -- rm -f "$f" 2>/dev/null && info "Deleted: $(basename "$f")"
              done
              ok "Deleted $DELETE_COUNT old $pattern backup(s) from $backup_pod"
            fi
          fi
        fi
      done
    fi
  done
else
  warn "No backup pods found. Backups may be in PVCs that require direct access."
  info "To clean backups manually, you may need to:"
  info "  1. Create a temporary pod with the backup PVC mounted"
  info "  2. Or use kubectl cp to access files"
fi
echo ""

# 3. Check PVC sizes
log "Step 3: Current PVC sizes:"
kubectl -n "$NS" get pvc -o custom-columns=NAME:.metadata.name,SIZE:.spec.resources.requests.storage,USED:.status.capacity.storage 2>/dev/null | grep -E "NAME|pg" || true
echo ""

# 4. Check disk space in postgres pod
log "Step 4: Disk space in PostgreSQL pod:"
kubectl -n "$NS" exec "$PGPOD" -c db -- df -h 2>/dev/null | grep -E "Filesystem|overlay|/pgdata|/wal-archive|/var/lib/postgresql" || true
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN complete - no files were deleted"
  echo ""
  echo "To actually clean up, run:"
  echo "  DRY_RUN=false $0"
else
  ok "PVC cleanup complete!"
  echo ""
  info "If you still need more space:"
  info "  - Check if any PVCs can be resized (most cannot be resized once bound)"
  info "  - Consider creating new larger PVCs and migrating data"
  info "  - Review backup retention policies in cron jobs"
fi

