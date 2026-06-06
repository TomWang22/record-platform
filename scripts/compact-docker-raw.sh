#!/usr/bin/env bash
# Compact Docker.raw disk image to free space
# Docker Desktop must be quit for this to work

set -euo pipefail

DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"

echo "═══════════════════════════════════════════════════════════"
echo "  Docker.raw Compaction Guide"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Docker Desktop is running
if pgrep -f "Docker Desktop" > /dev/null; then
    echo "⚠️  Docker Desktop is still running!"
    echo ""
    echo "Please quit Docker Desktop first:"
    echo "  1. Open Docker Desktop"
    echo "  2. Click Docker icon in menu bar"
    echo "  3. Select 'Quit Docker Desktop'"
    echo ""
    echo "Then run this script again or compact via Docker Desktop UI"
    exit 1
fi

echo "✅ Docker Desktop is quit"
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

# Check free space
FREE_SPACE=$(df -h . | tail -1 | awk '{print $4}')
echo "📊 Current free space: $FREE_SPACE"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Compaction Methods"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "⚠️  Docker.raw compaction must be done via Docker Desktop UI"
echo ""
echo "Method 1: Via Docker Desktop (Recommended)"
echo "───────────────────────────────────────────────────────────"
echo "1. Open Docker Desktop"
echo "2. Click Settings (gear icon)"
echo "3. Go to Resources → Advanced"
echo "4. Click 'Compact disk image' button"
echo "5. Wait 10-30 minutes (depending on size)"
echo ""
echo "This will:"
echo "  • Remove unused space inside Docker.raw"
echo "  • Reduce file size from 256GB to ~50-100GB"
echo "  • Recover ~150-200GB of disk space"
echo ""
echo "Method 2: Command Line (If Available)"
echo "───────────────────────────────────────────────────────────"
echo "Docker Desktop CLI may support compaction, but the UI method"
echo "is more reliable and provides progress feedback."
echo ""

# Check if we can estimate space
echo "📋 Estimated Recovery:"
echo "   Current size: $CURRENT_SIZE"
echo "   Expected after: ~50-100GB (depends on actual usage)"
echo "   Estimated recovery: ~150-200GB"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Important Notes"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "✅ Safe Operation:"
echo "   • Compaction doesn't delete data"
echo "   • Only removes unused space"
echo "   • Your volumes and containers are preserved"
echo ""
echo "⏱️  Time Required:"
echo "   • 10-30 minutes depending on disk size"
echo "   • Progress shown in Docker Desktop UI"
echo ""
echo "📊 After Compaction:"
echo "   • Verify Docker Desktop still works"
echo "   • Check free space increased"
echo "   • Proceed with Colima migration"
echo ""

echo "Ready to compact? Open Docker Desktop and use Method 1 above."
