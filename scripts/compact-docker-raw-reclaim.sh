#!/usr/bin/env bash
# Compact Docker.raw using Docker Desktop's reclaim-space command
# This is the official method for Docker Desktop

set -euo pipefail

DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"

echo "═══════════════════════════════════════════════════════════"
echo "  Docker.raw Compaction - Using Docker Desktop Reclaim Space"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Docker Desktop is running
if ! pgrep -f "Docker Desktop" > /dev/null; then
    echo "⚠️  Docker Desktop is not running!"
    echo ""
    echo "Starting Docker Desktop..."
    open -a Docker
    echo "Waiting for Docker Desktop to start (30 seconds)..."
    sleep 30
    
    # Check if Docker is ready
    if ! docker info >/dev/null 2>&1; then
        echo "❌ Docker Desktop didn't start properly"
        echo "Please start Docker Desktop manually and try again"
        exit 1
    fi
fi

echo "✅ Docker Desktop is running"
echo ""

# Check Docker.raw exists
if [ ! -f "$DOCKER_RAW" ]; then
    echo "❌ Docker.raw not found at: $DOCKER_RAW"
    exit 1
fi

# Get current size
CURRENT_SIZE=$(ls -lh "$DOCKER_RAW" | awk '{print $5}')
echo "📊 Current Docker.raw size: $CURRENT_SIZE"
echo ""

# Check free space before
FREE_BEFORE=$(df -h . | tail -1 | awk '{print $4}')
echo "📊 Free space before: $FREE_BEFORE"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Step 1: Pruning Unused Docker Data"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "First, let's remove unused containers, images, and volumes..."
echo "This reclaims space inside Docker.raw"
echo ""

read -p "Prune unused Docker data first? (recommended) (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Pruning unused images and build cache..."
    docker image prune -af 2>&1 | grep -E "Total|reclaimed|deleted" || true
    
    echo ""
    echo "Pruning build cache..."
    docker builder prune -af 2>&1 | grep -E "Total|reclaimed" || true
    
    echo ""
    echo "Pruning unused volumes (⚠️  be careful - only unused ones)..."
    docker volume prune -f 2>&1 | grep -E "Total|reclaimed" || true
    
    echo ""
    echo "✓ Pruning complete"
else
    echo "Skipping pruning"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Step 2: Reclaim Space in Docker.raw"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Running Docker Desktop's reclaim-space command..."
echo "This will compact Docker.raw to remove unused space"
echo ""
echo "⚠️  This may take 10-30 minutes depending on Docker.raw size"
echo ""

read -p "Proceed with reclaim-space compaction? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Starting compaction..."
    echo "(This will take a while - be patient)"
    echo ""
    
    docker run --privileged --pid=host docker/desktop-reclaim-space
    
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  Compaction Complete!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    
    # Get new size
    if [ -f "$DOCKER_RAW" ]; then
        NEW_SIZE=$(ls -lh "$DOCKER_RAW" | awk '{print $5}')
        echo "📊 Docker.raw size before: $CURRENT_SIZE"
        echo "📊 Docker.raw size after:  $NEW_SIZE"
    fi
    
    # Check free space after
    FREE_AFTER=$(df -h . | tail -1 | awk '{print $4}')
    echo "📊 Free space before: $FREE_BEFORE"
    echo "📊 Free space after:  $FREE_AFTER"
    echo ""
    echo "✅ Compaction complete!"
else
    echo "Skipping compaction"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Alternative: Manual Method"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "If reclaim-space doesn't work, you can also:"
echo ""
echo "1. Open Docker Desktop"
echo "2. Settings → Resources → Advanced"
echo "3. Reduce 'Disk image size' slider"
echo "4. Click 'Apply & Restart'"
echo ""
echo "⚠️  Warning: Reducing disk image size may delete containers/images"
echo "   Only do this after backing up data!"
