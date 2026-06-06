#!/usr/bin/env bash
# Extract Postgres volumes from Docker.raw
# This attempts to mount Docker.raw and extract data directories

set -euo pipefail

echo "=== Extract Postgres Volumes from Docker.raw ==="
echo ""
echo "⚠️  This is an advanced recovery operation"
echo "   We'll attempt to mount Docker.raw and extract Postgres data"
echo ""

DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
EXTRACT_DIR="$HOME/docker-volume-recovery-$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$DOCKER_RAW" ]]; then
    echo "❌ Docker.raw not found at: $DOCKER_RAW"
    exit 1
fi

echo "Docker.raw location: $DOCKER_RAW"
echo "Extraction directory: $EXTRACT_DIR"
echo ""

read -p "Continue with extraction? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
fi

# Create extraction directory
mkdir -p "$EXTRACT_DIR"
echo "✅ Created extraction directory: $EXTRACT_DIR"

# Method 1: Try using hdiutil (macOS built-in)
echo ""
echo "Method 1: Attempting to mount with hdiutil..."
echo "   Note: Docker.raw is a raw disk image, may need conversion"

# Check if hdiutil can attach it
ATTACH_OUTPUT=$(hdiutil attach -nomount "$DOCKER_RAW" 2>&1) || true

if echo "$ATTACH_OUTPUT" | grep -q "/dev/disk"; then
    DEVICE=$(echo "$ATTACH_OUTPUT" | grep "/dev/disk" | awk '{print $1}' | head -1)
    echo "   ✅ Attached to device: $DEVICE"
    
    # Try to mount (this may fail if filesystem is corrupted)
    MOUNT_POINT="$EXTRACT_DIR/mount"
    mkdir -p "$MOUNT_POINT"
    
    echo "   Attempting to mount filesystem..."
    if mount -t ext4 "$DEVICE" "$MOUNT_POINT" 2>/dev/null || \
       mount -t hfs "$DEVICE" "$MOUNT_POINT" 2>/dev/null; then
        echo "   ✅ Filesystem mounted at: $MOUNT_POINT"
        
        # Look for Docker volumes
        VOLUMES_DIR="$MOUNT_POINT/var/lib/docker/volumes"
        if [[ -d "$VOLUMES_DIR" ]]; then
            echo ""
            echo "✅ Found Docker volumes directory!"
            echo "   Extracting Postgres volumes..."
            
            # Extract each Postgres volume
            for vol in pgdata pgdata-auth pgdata-social pgdata-listings \
                       pgdata-shopping pgdata-auction-monitor pgdata-analytics \
                       pgdata-python-ai; do
                VOL_PATH="$VOLUMES_DIR/$vol/_data"
                if [[ -d "$VOL_PATH" ]]; then
                    echo "   Extracting $vol..."
                    cp -r "$VOL_PATH" "$EXTRACT_DIR/$vol" || true
                    echo "   ✅ Extracted $vol"
                else
                    echo "   ⚠️  Volume $vol not found"
                fi
            done
            
            echo ""
            echo "✅ Extraction complete!"
            echo "   Data extracted to: $EXTRACT_DIR"
            echo ""
            echo "Next steps:"
            echo "   1. Verify extracted data: ls -la $EXTRACT_DIR"
            echo "   2. Start new Docker instance"
            echo "   3. Create new Postgres containers"
            echo "   4. Copy extracted data into new volumes"
        else
            echo "   ⚠️  Docker volumes directory not found at expected location"
        fi
        
        # Unmount
        umount "$MOUNT_POINT" || true
    else
        echo "   ❌ Could not mount filesystem (may be corrupted)"
    fi
    
    # Detach
    hdiutil detach "$DEVICE" || true
else
    echo "   ⚠️  hdiutil could not attach Docker.raw"
    echo "   This may require qemu-img or other tools"
fi

# Method 2: Try using qemu-img (if available)
if ! command -v qemu-img &> /dev/null; then
    echo ""
    echo "Method 2: qemu-img not available"
    echo "   Install with: brew install qemu"
else
    echo ""
    echo "Method 2: Attempting with qemu-img..."
    echo "   (Not implemented yet - requires qemu-nbd setup)"
fi

echo ""
echo "=== Extraction Attempt Complete ==="
echo ""
echo "If extraction succeeded, data is in: $EXTRACT_DIR"
echo "If extraction failed, Docker.raw may be too corrupted to mount"
echo ""
echo "Next options:"
echo "  1. If extraction succeeded: Restore data to new Docker instance"
echo "  2. If extraction failed: Consider reset (see scripts/reset-docker-vm.sh)"

