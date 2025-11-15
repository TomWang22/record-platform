#!/usr/bin/env bash
set -Eeuo pipefail

# Clean up old backup files, keeping only the most recent ones
# Usage: ./scripts/cleanup-old-backups.sh [--dry-run] [--keep N]

BACKUP_DIR="${BACKUP_DIR:-backups}"
DRY_RUN=false
KEEP_COUNT=5  # Keep 5 most recent of each type

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --keep)
      KEEP_COUNT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--keep N]" >&2
      exit 1
      ;;
  esac
done

echo "=== Backup Cleanup ==="
echo "Backup directory: $BACKUP_DIR"
echo "Keep count: $KEEP_COUNT"
echo "Dry run: $DRY_RUN"
echo ""

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Error: Backup directory '$BACKUP_DIR' does not exist" >&2
  exit 1
fi

# Calculate total size before cleanup
TOTAL_BEFORE=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')
echo "Total size before cleanup: $TOTAL_BEFORE"
echo ""

# Function to cleanup a specific pattern
cleanup_pattern() {
  local pattern="$1"
  local type_name="$2"
  
  echo "=== $type_name backups ==="
  
  # Get all matching files sorted by modification time (newest first)
  local files=($(ls -t "$BACKUP_DIR"/$pattern 2>/dev/null || true))
  local count=${#files[@]}
  
  if [[ $count -eq 0 ]]; then
    echo "  No $type_name backups found"
    return
  fi
  
  echo "  Found $count $type_name backup(s)"
  
  if [[ $count -le $KEEP_COUNT ]]; then
    echo "  Keeping all $count (within limit of $KEEP_COUNT)"
    return
  fi
  
  # Keep the first KEEP_COUNT, delete the rest
  local to_delete=("${files[@]:$KEEP_COUNT}")
  local to_keep=("${files[@]:0:$KEEP_COUNT}")
  
  echo "  Keeping:"
  for file in "${to_keep[@]}"; do
    local size=$(ls -lh "$file" | awk '{print $5}')
    echo "    - $(basename "$file") ($size)"
  done
  
  echo "  Deleting:"
  local total_deleted_size=0
  for file in "${to_delete[@]}"; do
    local size=$(du -b "$file" 2>/dev/null | awk '{print $1}')
    local size_human=$(ls -lh "$file" | awk '{print $5}')
    echo "    - $(basename "$file") ($size_human)"
    total_deleted_size=$((total_deleted_size + size))
    
    if [[ "$DRY_RUN" == "false" ]]; then
      rm -f "$file"
    fi
  done
  
  local deleted_gb=$(awk "BEGIN {printf \"%.2f\", $total_deleted_size / 1024 / 1024 / 1024}")
  echo "  Total to delete: ${deleted_gb}GB"
  echo ""
}

# Cleanup different backup types
cleanup_pattern "*.dump" "Dump files"
cleanup_pattern "*.tar.gz" "Tar.gz archives"
cleanup_pattern "emergency_backup_*.dump" "Emergency backups"
cleanup_pattern "pre_restart_backup_*.dump" "Pre-restart backups"

# Calculate total size after cleanup
if [[ "$DRY_RUN" == "false" ]]; then
  TOTAL_AFTER=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')
  echo "=== Summary ==="
  echo "Total size before: $TOTAL_BEFORE"
  echo "Total size after:  $TOTAL_AFTER"
else
  echo "=== Summary ==="
  echo "DRY RUN - No files were deleted"
  echo "Run without --dry-run to actually delete files"
fi

