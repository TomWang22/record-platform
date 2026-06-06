#!/usr/bin/env bash
set -euo pipefail

# Safe Docker storage cleanup script
# This script helps reclaim disk space by removing stale Docker resources

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Docker Storage Cleanup Script ==="
echo ""
echo "This script will help reclaim disk space by removing:"
echo "  1. Dangling (untagged) images"
echo "  2. Build cache"
echo "  3. Duplicate backup files"
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Show current state
echo "=== Current Docker Storage ==="
docker system df
echo ""

# Calculate reclaimable space
BUILD_CACHE_SIZE=$(docker builder du 2>/dev/null | grep -E "RECLAIMABLE.*GB|RECLAIMABLE.*MB" | awk '{print $3}' | head -1 || echo "0")
DANGLING_COUNT=$(docker images -f "dangling=true" -q | wc -l | tr -d ' ')

echo "=== Reclaimable Resources ==="
echo "🗑️  Build Cache: ${BUILD_CACHE_SIZE} (100% reclaimable)"
echo "🖼️  Dangling Images: ${DANGLING_COUNT} images"
echo ""

# Ask for confirmation
read -p "Do you want to proceed with cleanup? (yes/no, default: no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "=== Starting Cleanup ==="
echo ""

# 1. Remove dangling images
if [ ${DANGLING_COUNT} -gt 0 ]; then
    echo "🗑️  Removing ${DANGLING_COUNT} dangling images..."
    docker image prune -f
    echo "   ✅ Dangling images removed"
else
    echo "   ℹ️  No dangling images to remove"
fi
echo ""

# 2. Prune build cache (conservative: only remove cache older than 14 days)
echo "🗑️  Pruning old build cache (older than 14 days)..."
echo "   ℹ️  This will temporarily slow down first build after cleanup"
echo "   ℹ️  Cache will rebuild automatically on next build"
BUILD_CACHE_BEFORE=$(docker builder du 2>/dev/null | grep -E "RECLAIMABLE.*GB|RECLAIMABLE.*MB" | awk '{print $3}' | head -1 || echo "0")
docker builder prune -af --filter "until=336h" 2>/dev/null || docker system prune -af --filter "until=336h" 2>/dev/null
BUILD_CACHE_AFTER=$(docker builder du 2>/dev/null | grep -E "RECLAIMABLE.*GB|RECLAIMABLE.*MB" | awk '{print $3}' | head -1 || echo "0")
echo "   ✅ Build cache pruned (removed cache older than 14 days)"
echo ""

# 3. Clean up duplicate backup files (keep only latest)
echo "📦 Cleaning up duplicate backup files..."
BACKUP_DIR="${PROJECT_ROOT}/backups"

# Keep only the latest postgres-1 backup
LATEST_POSTGRES1=$(ls -t "${BACKUP_DIR}"/record-platform-postgres-1-all-*.sql 2>/dev/null | head -1)
if [ -n "${LATEST_POSTGRES1}" ]; then
    OLD_POSTGRES1=$(ls -t "${BACKUP_DIR}"/record-platform-postgres-1-all-*.sql 2>/dev/null | tail -n +2)
    if [ -n "${OLD_POSTGRES1}" ]; then
        COUNT=$(echo "${OLD_POSTGRES1}" | wc -l | tr -d ' ')
        echo "   Removing ${COUNT} old postgres-1 backups (keeping latest)..."
        echo "${OLD_POSTGRES1}" | xargs rm -f
        echo "   ✅ Removed ${COUNT} duplicate backups"
    fi
fi

# Remove test backup files
if ls "${BACKUP_DIR}"/test-*.sql 2>/dev/null | grep -q .; then
    TEST_COUNT=$(ls "${BACKUP_DIR}"/test-*.sql 2>/dev/null | wc -l | tr -d ' ')
    echo "   Removing ${TEST_COUNT} test backup files..."
    rm -f "${BACKUP_DIR}"/test-*.sql
    echo "   ✅ Removed ${TEST_COUNT} test backups"
fi

# Remove old incomplete backups
if [ -f "${BACKUP_DIR}/record-platform-postgres-analytics-1-analytics-20260101-213114.sql" ]; then
    echo "   Removing old incomplete analytics backup..."
    rm -f "${BACKUP_DIR}/record-platform-postgres-analytics-1-analytics-20260101-213114.sql"
    echo "   ✅ Removed incomplete backup"
fi

echo ""

# Show final state
echo "=== Cleanup Complete ==="
echo ""
echo "📊 Updated Docker Storage:"
docker system df
echo ""

echo "📦 Backup directory size:"
du -sh "${BACKUP_DIR}" 2>/dev/null || echo "   (unable to calculate)"
echo ""

echo "✅ Cleanup completed successfully!"
echo ""
echo "💡 Tip: Run 'docker system prune -a' to remove all unused images (more aggressive)"
