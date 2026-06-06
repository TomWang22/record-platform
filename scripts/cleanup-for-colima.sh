#!/usr/bin/env bash
# Comprehensive cleanup for Colima migration
# Prunes Docker Desktop resources and cleans up space

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  Cleanup for Colima Migration"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Get initial free space
INITIAL_FREE=$(df -h . | tail -1 | awk '{print $4}')
echo "📊 Initial free space: $INITIAL_FREE"
echo ""

# Step 1: Docker cleanup
echo "🧹 Step 1: Cleaning Docker Desktop..."
echo "   (Keeping running containers and volumes for safety)"

# Remove unused images (except currently running)
docker image prune -af 2>&1 | grep -E "Total|reclaimed|deleted" || true

# Remove build cache
docker builder prune -af 2>&1 | grep -E "Total|reclaimed" || true

# Remove unused networks
docker network prune -f 2>&1 | grep -E "Total|reclaimed" || true

# Remove dangling volumes (unused, not attached to containers)
docker volume prune -f 2>&1 | grep -E "Total|reclaimed" || true

echo "✓ Docker cleanup complete"
echo ""

# Step 2: Clear caches
echo "🧹 Step 2: Clearing additional caches..."

# Browser caches (safe to clear)
echo "   Clearing browser caches..."
rm -rf ~/Library/Caches/Firefox 2>/dev/null || true
rm -rf ~/Library/Caches/Google 2>/dev/null || true

# Development caches
echo "   Clearing development caches..."
rm -rf ~/Library/Caches/Cypress 2>/dev/null || true
rm -rf ~/Library/Caches/ms-playwright 2>/dev/null || true
rm -rf ~/Library/Caches/Homebrew 2>/dev/null || true

# Other caches
rm -rf ~/Library/Caches/SiriTTS 2>/dev/null || true
rm -rf ~/Library/Caches/Adobe 2>/dev/null || true

echo "✓ Cache cleanup complete"
echo ""

# Step 3: Clear old logs
echo "🧹 Step 3: Clearing old logs..."
find ~/Library/Logs -type f -mtime +7 -delete 2>/dev/null || true
echo "✓ Log cleanup complete"
echo ""

# Step 4: Optional - Clean node_modules (comment out if you want to keep)
# echo "🧹 Step 4: Cleaning node_modules..."
# find ~/record-platform -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
# echo "⚠️  Note: node_modules removed - run 'pnpm install' to restore"

# Get final free space
FINAL_FREE=$(df -h . | tail -1 | awk '{print $4}')
echo "═══════════════════════════════════════════════════════════"
echo "  Cleanup Complete"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 Free space before: $INITIAL_FREE"
echo "📊 Free space after:  $FINAL_FREE"
echo ""
echo "✅ Ready for Colima migration!"
echo ""
echo "📋 Next Steps:"
echo "   1. Verify PostgreSQL backups exist:"
echo "      ls -lh record-platform/backups/*.sql"
echo ""
echo "   2. Set up Colima:"
echo "      ./scripts/setup-colima-containerd.sh"
echo ""
echo "   3. Restore PostgreSQL data to Colima (if needed):"
echo "      BACKUP_DIR=./backups RESTORE_MODE=full FORCE=true \\"
echo "      ./scripts/restore-postgres-databases.sh"
echo ""
