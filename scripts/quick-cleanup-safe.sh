#!/bin/bash
# Quick Safe Cleanup Script
# Only clears caches and old logs - safe to run

set -e

echo "═══════════════════════════════════════════════════════════"
echo "  Safe Storage Cleanup Script"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Get initial free space
INITIAL_FREE=$(df -h . | tail -1 | awk '{print $4}')
echo "📊 Initial free space: $INITIAL_FREE"
echo ""

# Phase 1: Clear caches (11GB)
echo "🧹 Phase 1: Clearing caches..."
CACHE_SIZE_BEFORE=$(du -sh ~/Library/Caches 2>/dev/null | awk '{print $1}')
echo "   Cache size before: $CACHE_SIZE_BEFORE"

# Clear safe caches
echo "   Clearing development caches..."
rm -rf ~/Library/Caches/colima 2>/dev/null || true
rm -rf ~/Library/Caches/go-build 2>/dev/null || true
rm -rf ~/Library/Caches/vscode-cpptools 2>/dev/null || true
rm -rf ~/Library/Caches/node-gyp 2>/dev/null || true
rm -rf ~/Library/Caches/typescript 2>/dev/null || true
rm -rf ~/Library/Caches/helm 2>/dev/null || true
rm -rf ~/Library/Caches/pip 2>/dev/null || true
rm -rf ~/Library/Caches/pnpm 2>/dev/null || true

# Keep browser caches (but can clear if needed)
echo "   ✓ Development caches cleared"
echo "   ℹ Browser caches kept (Firefox, Chrome, etc.)"
echo "   ℹ Google/Adobe caches kept (might be useful)"
echo ""

# Phase 2: Clear old logs (1GB)
echo "📝 Phase 2: Clearing old logs (older than 7 days)..."
LOG_SIZE_BEFORE=$(du -sh ~/Library/Logs 2>/dev/null | awk '{print $1}')
echo "   Log size before: $LOG_SIZE_BEFORE"
find ~/Library/Logs -type f -mtime +7 -delete 2>/dev/null || true
LOG_SIZE_AFTER=$(du -sh ~/Library/Logs 2>/dev/null | awk '{print $1}')
echo "   Log size after: $LOG_SIZE_AFTER"
echo ""

# Phase 3: Clear Trash
echo "🗑️  Phase 3: Checking Trash..."
if [ -d ~/.Trash ] && [ "$(ls -A ~/.Trash 2>/dev/null)" ]; then
    TRASH_SIZE=$(du -sh ~/.Trash 2>/dev/null | awk '{print $1}')
    echo "   Trash size: $TRASH_SIZE"
    echo "   ℹ Trash not automatically cleared (review manually)"
else
    echo "   ✓ Trash is empty"
fi
echo ""

# Get final free space
FINAL_FREE=$(df -h . | tail -1 | awk '{print $4}')
echo "═══════════════════════════════════════════════════════════"
echo "  Cleanup Complete"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 Free space before: $INITIAL_FREE"
echo "📊 Free space after:  $FINAL_FREE"
echo ""
echo "✅ Safe cleanup complete!"
echo ""
echo "📋 Next steps (manual review recommended):"
echo "   1. Review Postgres Application Support (27GB)"
echo "   2. Compact Docker.raw (256GB → ~50-100GB if possible)"
echo "   3. Review Cursor Application Support (18GB)"
echo "   4. Review other Application Support folders"
echo ""
echo "See STORAGE_CLEANUP_PLAN.md for details"
