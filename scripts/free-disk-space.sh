#!/usr/bin/env bash
set -Eeuo pipefail

# Free up disk space for PostgreSQL optimizations
# Cleans Docker resources and checks available space

echo "=== Freeing Up Disk Space ==="
echo ""

# Check current disk usage
echo "Current Docker disk usage:"
docker system df
echo ""

# Remove unused containers
echo "Removing stopped containers..."
docker container prune -f
echo ""

# Remove unused images
echo "Removing unused images..."
docker image prune -f
echo ""

# Remove build cache
echo "Removing build cache..."
docker builder prune -f
echo ""

# Check PostgreSQL volume size
echo "PostgreSQL volumes:"
docker volume ls | grep -E "(postgres|pg)" || echo "No postgres volumes found"
echo ""

# Final disk usage
echo "Disk usage after cleanup:"
docker system df
echo ""

# Check system disk space
echo "System disk space:"
df -h / | tail -1
echo ""

echo "✅ Cleanup complete"
echo ""
echo "If still low on space:"
echo "1. Check Docker volume sizes: docker volume inspect <volume-name>"
echo "2. Consider removing old backups/logs"
echo "3. Expand Docker disk allocation in Docker Desktop settings"
