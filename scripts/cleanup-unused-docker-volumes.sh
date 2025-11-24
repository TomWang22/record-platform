#!/usr/bin/env bash
set -euo pipefail

# Safely remove unused Docker volumes
# This script identifies and removes volumes that are not attached to any containers
# Usage: ./scripts/cleanup-unused-docker-volumes.sh [--dry-run] [--force]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-false}"
FORCE="${FORCE:-false}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--force]" >&2
      exit 1
      ;;
  esac
done

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

echo "=== Docker Volume Cleanup ==="
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN MODE - No volumes will be deleted"
  echo ""
fi

# Get all unused volumes
UNUSED_VOLUMES=$(docker volume ls -f "dangling=true" -q 2>/dev/null || true)

if [[ -z "$UNUSED_VOLUMES" ]]; then
  info "No unused volumes found"
  exit 0
fi

# Get details for each unused volume
TOTAL_SIZE=0
VOLUME_LIST=""

while IFS= read -r vol_name; do
  if [[ -z "$vol_name" ]]; then
    continue
  fi
  
  # Get volume size (approximate)
  vol_info=$(docker volume inspect "$vol_name" 2>/dev/null || echo "")
  if [[ -z "$vol_info" ]]; then
    continue
  fi
  
  mountpoint=$(echo "$vol_info" | grep -o '"/var/lib/docker/volumes/[^"]*"' | sed 's/"//g' || echo "")
  if [[ -n "$mountpoint" ]] && [[ -d "$mountpoint" ]]; then
    size_bytes=$(du -sb "$mountpoint" 2>/dev/null | awk '{print $1}' || echo "0")
    size_gb=$(awk "BEGIN {printf \"%.2f\", $size_bytes / 1024 / 1024 / 1024}")
    TOTAL_SIZE=$((TOTAL_SIZE + size_bytes))
    VOLUME_LIST="${VOLUME_LIST}${vol_name}|${size_gb}GB
"
  fi
done <<< "$UNUSED_VOLUMES"

if [[ -z "$VOLUME_LIST" ]]; then
  info "No unused volumes with accessible size information found"
  exit 0
fi

TOTAL_SIZE_GB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_SIZE / 1024 / 1024 / 1024}")

echo "Found unused volumes (total: ~${TOTAL_SIZE_GB}GB):"
echo ""
echo "$VOLUME_LIST" | while IFS='|' read -r vol_name size; do
  if [[ -n "$vol_name" ]]; then
    # Try to get a friendly name or ID
    vol_display=$(docker volume inspect "$vol_name" 2>/dev/null | grep -o '"Name":"[^"]*"' | cut -d'"' -f4 || echo "$vol_name")
    echo "  - $vol_display: ~$size"
  fi
done
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN: Would delete these volumes to free ~${TOTAL_SIZE_GB}GB"
  echo ""
  echo "To actually delete, run:"
  echo "  $0 --force"
  exit 0
fi

if [[ "$FORCE" != "true" ]]; then
  warn "⚠️  WARNING: This will permanently delete unused Docker volumes!"
  warn "   Total space to free: ~${TOTAL_SIZE_GB}GB"
  echo ""
  echo "These volumes are not attached to any containers and are safe to remove."
  echo "However, make sure you have backups if you need the data."
  echo ""
  read -p "Type 'yes' to continue: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Delete unused volumes
DELETED_COUNT=0
echo ""
log "Deleting unused volumes..."
echo "$UNUSED_VOLUMES" | while IFS= read -r vol_name; do
  if [[ -n "$vol_name" ]]; then
    if docker volume rm "$vol_name" >/dev/null 2>&1; then
      info "Deleted: $vol_name"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    else
      warn "Failed to delete: $vol_name"
    fi
  fi
done

ok "Cleanup complete! ~${TOTAL_SIZE_GB}GB freed"

