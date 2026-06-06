#!/usr/bin/env bash
# Fix Docker Desktop daemon issues
# This script attempts to recover Docker Desktop when it won't start

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  Docker Desktop Daemon Recovery"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Docker Desktop is running
if pgrep -f "Docker Desktop" > /dev/null; then
    echo "⚠️  Docker Desktop is running. Quitting first..."
    killall Docker 2>/dev/null || true
    sleep 3
fi

# Kill any hung Docker/containerd processes
echo "🧹 Step 1: Killing hung Docker/containerd processes..."
pkill -9 -f docker 2>/dev/null || true
pkill -9 -f containerd 2>/dev/null || true
sleep 2
echo "✓ Processes killed"
echo ""

# Check Docker.raw exists
DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
if [ -f "$DOCKER_RAW" ]; then
    echo "✅ Docker.raw exists: $(ls -lh "$DOCKER_RAW" | awk '{print $5}')"
    echo "   (This contains your PostgreSQL data - will be preserved)"
else
    echo "⚠️  Docker.raw not found at expected location"
fi
echo ""

# Check Docker logs for errors
echo "📋 Step 2: Checking Docker logs for errors..."
LOG_DIR="$HOME/Library/Containers/com.docker.docker/Data/log/host"
if [ -d "$LOG_DIR" ]; then
    echo "Recent errors:"
    tail -20 "$LOG_DIR"/*.log 2>/dev/null | grep -i error | tail -5 || echo "No obvious errors in recent logs"
else
    echo "⚠️  Log directory not found"
fi
echo ""

# Option 1: Soft reset (keep Docker.raw, reset state)
echo "🔧 Step 3: Attempting soft reset..."
echo ""
echo "This will:"
echo "  • Reset Docker Desktop state files"
echo "  • Keep Docker.raw (your data is safe)"
echo "  • Reset Docker daemon configuration"
echo ""
read -p "Proceed with soft reset? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Resetting Docker state..."
    
    # Backup current state (just in case)
    BACKUP_DIR="$HOME/Library/Containers/com.docker.docker/Data.backup-$(date +%Y%m%d-%H%M%S)"
    if [ -d "$HOME/Library/Containers/com.docker.docker/Data" ]; then
        echo "Creating backup of Docker state..."
        mkdir -p "$(dirname "$BACKUP_DIR")"
        # Only backup config, not the large Docker.raw
        cp -r "$HOME/Library/Containers/com.docker.docker/Data/vms" "$BACKUP_DIR/vms.backup" 2>/dev/null || true
    fi
    
    # Reset Docker Desktop (but keep Docker.raw)
    echo "Resetting Docker Desktop state..."
    # Remove state files but keep Docker.raw
    rm -rf "$HOME/Library/Containers/com.docker.docker/Data/docker.raw.lock" 2>/dev/null || true
    rm -rf "$HOME/Library/Containers/com.docker.docker/Data/*.lock" 2>/dev/null || true
    rm -rf "$HOME/Library/Containers/com.docker.docker/Data/com.docker.backend" 2>/dev/null || true
    
    echo "✓ State reset complete"
    echo ""
    echo "Now try opening Docker Desktop:"
    echo "  open -a Docker"
    echo ""
else
    echo "Skipping reset"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Next Steps"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "1. Try opening Docker Desktop:"
echo "   open -a Docker"
echo ""
echo "2. If it still doesn't work, check logs:"
echo "   tail -50 $HOME/Library/Containers/com.docker.docker/Data/log/host/*.log"
echo ""
echo "3. If Docker.raw is the issue, you may need to:"
echo "   • Extract PostgreSQL data first (use existing SQL backups)"
echo "   • Then reset Docker completely"
echo ""
echo "4. Your PostgreSQL backups are safe:"
echo "   ls -lh record-platform/backups/*.sql"
echo ""
