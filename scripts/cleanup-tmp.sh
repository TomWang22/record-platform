#!/usr/bin/env bash
set -euo pipefail

# Cleanup temporary files in tmp/ directory
# Usage: ./scripts/cleanup-tmp.sh [--dry-run] [--days N]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DAYS="${DAYS:-7}"  # Default: remove files older than 7 days
DRY_RUN="${DRY_RUN:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --days)
      DAYS="$2"
      shift 2
      ;;
    *)
      echo "Usage: $0 [--dry-run] [--days N]" >&2
      exit 1
      ;;
  esac
done

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ ! -d "tmp" ]]; then
  echo "No tmp/ directory found"
  exit 0
fi

log "Cleaning tmp/ directory (files older than $DAYS days)..."
log "Current tmp/ size:"
du -sh tmp/ 2>/dev/null || true
echo ""

OLD_FILES=$(find tmp/ -type f -mtime +$DAYS 2>/dev/null || true)

if [[ -z "$OLD_FILES" ]]; then
  ok "No old files found in tmp/"
  exit 0
fi

OLD_COUNT=$(echo "$OLD_FILES" | wc -l | tr -d ' ')
OLD_SIZE_BYTES=$(echo "$OLD_FILES" | xargs du -cb 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
OLD_SIZE_MB=$(awk "BEGIN {printf \"%.1f\", $OLD_SIZE_BYTES / 1024 / 1024}")
OLD_SIZE_GB=$(awk "BEGIN {printf \"%.2f\", $OLD_SIZE_BYTES / 1024 / 1024 / 1024}")

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN - Would delete $OLD_COUNT file(s) (~${OLD_SIZE_GB}GB / ${OLD_SIZE_MB}MB)"
  echo "$OLD_FILES" | head -10 | while read -r f; do
    echo "  - $f"
  done
  [[ "$OLD_COUNT" -gt 10 ]] && echo "  ... and $((OLD_COUNT - 10)) more files"
else
  echo "$OLD_FILES" | xargs rm -f 2>/dev/null || true
  find tmp/ -type d -empty -delete 2>/dev/null || true
  ok "Deleted $OLD_COUNT old file(s): ~${OLD_SIZE_GB}GB freed"
  
  log "Remaining tmp/ size:"
  du -sh tmp/ 2>/dev/null || true
fi
