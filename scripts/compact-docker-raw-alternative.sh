#!/usr/bin/env bash
# Alternative methods to compact Docker.raw
# Since Docker Desktop UI doesn't always have compact button

set -euo pipefail

DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
BACKUP_RAW="${DOCKER_RAW}.backup-$(date +%Y%m%d-%H%M%S)"

echo "═══════════════════════════════════════════════════════════"
echo "  Docker.raw Compaction - Alternative Methods"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Docker Desktop is running
if pgrep -f "Docker Desktop" > /dev/null; then
    echo "⚠️  Docker Desktop is running!"
    echo "Please quit Docker Desktop first:"
    echo "  killall Docker"
    echo ""
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
CURRENT_SIZE_BYTES=$(stat -f%z "$DOCKER_RAW" 2>/dev/null || stat -c%s "$DOCKER_RAW" 2>/dev/null)

echo "📊 Current Docker.raw size: $CURRENT_SIZE ($(numfmt --to=iec-i --suffix=B $CURRENT_SIZE_BYTES 2>/dev/null || echo "$CURRENT_SIZE_BYTES bytes"))"
echo ""

# Check free space
FREE_SPACE=$(df -h . | tail -1 | awk '{print $4}')
echo "📊 Current free space: $FREE_SPACE"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Method 1: Using qemu-img (Recommended)"
echo "═══════════════════════════════════════════════════════════"
echo ""

if command -v qemu-img >/dev/null 2>&1; then
    echo "✅ qemu-img found!"
    echo ""
    echo "This will:"
    echo "  1. Create a backup of Docker.raw"
    echo "  2. Convert to compacted qcow2 format"
    echo "  3. Replace original with compacted version"
    echo ""
    echo "⚠️  WARNING: This requires disk space for:"
    echo "   • Backup: ~256GB"
    echo "   • Compacted: ~50-100GB"
    echo "   Total needed: ~300-350GB free space"
    echo ""
    
    # Check if we have enough space
    AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
    NEEDED_SPACE=$((CURRENT_SIZE_BYTES * 2))
    
    if [ "$AVAILABLE_SPACE" -lt "$NEEDED_SPACE" ]; then
        echo "❌ Not enough free space for this method"
        echo "   Need: ~300GB, Have: $(df -h . | tail -1 | awk '{print $4}')"
        echo ""
        echo "Consider Method 2 (manual cleanup first)"
    else
        echo "Space check: OK"
        echo ""
        read -p "Proceed with qemu-img compaction? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "Creating backup..."
            cp "$DOCKER_RAW" "$BACKUP_RAW"
            echo "✓ Backup created: $BACKUP_RAW"
            
            echo ""
            echo "Compacting (this takes 10-30 minutes)..."
            qemu-img convert -O qcow2 -c "$DOCKER_RAW" "${DOCKER_RAW}.compacted"
            
            if [ -f "${DOCKER_RAW}.compacted" ]; then
                NEW_SIZE=$(ls -lh "${DOCKER_RAW}.compacted" | awk '{print $5}')
                echo ""
                echo "✅ Compaction complete!"
                echo "   Original: $CURRENT_SIZE"
                echo "   Compacted: $NEW_SIZE"
                echo ""
                echo "Replacing original..."
                mv "${DOCKER_RAW}.compacted" "$DOCKER_RAW"
                echo "✅ Docker.raw compacted!"
                echo ""
                echo "Backup available at: $BACKUP_RAW"
                echo "You can delete it after verifying Docker works."
            fi
        fi
    fi
else
    echo "❌ qemu-img not found"
    echo ""
    echo "Install via Homebrew:"
    echo "  brew install qemu"
    echo ""
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Method 2: Manual Cleanup + Recreate (If Method 1 Fails)"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "1. Start Docker Desktop"
echo "2. Remove unused containers, images, volumes:"
echo "   docker system prune -a --volumes"
echo "3. Export important volumes/data first!"
echo "4. Quit Docker Desktop"
echo "5. Delete Docker.raw (after backups confirmed)"
echo "6. Start Docker Desktop (will create new, smaller Docker.raw)"
echo "7. Restore data from backups"
echo ""
echo "⚠️  Only use if you have backups!"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Method 3: Move to External Drive"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "If you have an external drive:"
echo "1. Copy Docker.raw to external drive (backup)"
echo "2. Delete local Docker.raw"
echo "3. Start Docker Desktop (creates new, smaller)"
echo "4. Restore only what you need"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Recommendation"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Since you're moving to Colima:"
echo "  1. ✅ You have PostgreSQL backups (1.9GB)"
echo "  2. Consider: Just delete Docker.raw after Colima is set up"
echo "  3. Or: Move Docker.raw to external drive as backup"
echo "  4. Docker.raw isn't needed once Colima is running"
echo ""
echo "This frees 256GB immediately without compaction!"
