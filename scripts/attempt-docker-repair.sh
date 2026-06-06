#!/usr/bin/env bash
# Attempt to repair Docker VM without losing data
# This tries safe recovery methods before resetting

set -euo pipefail

echo "=== Docker VM Repair Attempt ==="
echo ""
echo "This script will attempt to repair Docker without losing data."
echo ""

# Step 1: Quit Docker Desktop properly
echo "Step 1: Quitting Docker Desktop..."
echo "   Using AppleScript to quit Docker Desktop (handles privileged processes)..."
osascript -e 'quit app "Docker"' 2>/dev/null || true
sleep 5

# Kill user-owned Docker processes (skip root-owned system helpers)
echo "   Cleaning up user-owned Docker processes..."
pkill -9 -f "Docker Desktop" 2>/dev/null || true
pkill -9 -f "com.docker.backend" 2>/dev/null || true
pkill -9 -f "docker stats" 2>/dev/null || true
sleep 2

# Check if Docker Desktop GUI is still running (user processes)
# Use || true to handle case where pgrep finds no processes (exit code 1)
USER_DOCKER_PROCS=$(pgrep -f "Docker Desktop" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [[ "${USER_DOCKER_PROCS:-0}" -gt 0 ]]; then
    echo "   ⚠️  Some Docker Desktop processes still running (may need manual quit)"
    echo "   This is usually fine - privileged helpers (like vmnetd) are managed by system"
else
    echo "   ✅ Docker Desktop processes stopped"
fi

# Note: Root-owned processes like com.docker.vmnetd are system helpers
# They're fine to leave running - Docker Desktop will manage them
echo "✅ Docker Desktop quit (privileged helpers may still run - this is normal)"

# Step 2: Check Docker.raw exists
DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
if [[ ! -f "$DOCKER_RAW" ]]; then
    echo "❌ Docker.raw not found at expected location"
    exit 1
fi

echo ""
echo "Step 2: Checking Docker.raw..."
echo "   Location: $DOCKER_RAW"
echo "   Size: $(du -h "$DOCKER_RAW" | awk '{print $1}')"
echo "✅ Docker.raw exists"

# Step 3: Check disk space
echo ""
echo "Step 3: Checking disk space..."
AVAILABLE=$(df -k ~ | tail -1 | awk '{print $4}')
DOCKER_SIZE=$(du -k "$DOCKER_RAW" | awk '{print $1}')
REQUIRED=$((DOCKER_SIZE / 10))  # Need ~10% free space for operations

if [[ $AVAILABLE -lt $REQUIRED ]]; then
    echo "⚠️  Low disk space: $(echo "scale=2; $AVAILABLE/1024/1024" | bc) GB available"
    echo "   Recommended: $(echo "scale=2; $REQUIRED/1024/1024" | bc) GB free"
    echo ""
    read -p "Continue anyway? (yes/no): " continue_anyway
    if [[ "$continue_anyway" != "yes" ]]; then
        echo "Aborted. Please free up disk space first."
        exit 1
    fi
fi

# Step 4: Try to check filesystem (if possible)
echo ""
echo "Step 4: Attempting filesystem check..."
echo "   Note: This requires mounting the VM, which may not work if severely corrupted"
echo "   We'll try a safe check first..."

# Check if we can read the file
if [[ -r "$DOCKER_RAW" ]]; then
    echo "   ✅ Docker.raw is readable"
else
    echo "   ❌ Docker.raw is not readable"
    exit 1
fi

# Step 5: Try increasing Docker disk size (if at limit)
echo ""
echo "Step 5: Checking Docker disk configuration..."
echo "   Docker.raw allocated size: 256GB"
echo "   Actual usage: $(du -h "$DOCKER_RAW" | awk '{print $1}')"
echo ""
echo "   If Docker was hitting disk limits, increasing size might help."
echo "   This will be done after restarting Docker."

# Step 6: Restart macOS recommendation
echo ""
echo "Step 6: Restart Recommendation"
echo "   ⚠️  IMPORTANT: Before restarting Docker, consider restarting macOS first."
echo "   This can clear file locks and allow Docker to remount the VM."
echo ""
read -p "Restart macOS now? (yes/no, default: no): " restart_macos
if [[ "$restart_macos" == "yes" ]]; then
    echo "   Restarting macOS in 10 seconds..."
    echo "   Press Ctrl+C to cancel"
    sleep 10
    sudo shutdown -r now
    exit 0
fi

# Step 7: Try starting Docker
echo ""
echo "Step 7: Starting Docker Desktop..."
open -a Docker

echo ""
echo "⏳ Waiting for Docker to start (this may take 30-60 seconds)..."
echo "   Checking Docker status..."

# Wait for Docker to be ready (max 3 minutes)
max_wait=180
elapsed=0
while [ $elapsed -lt $max_wait ]; do
    if docker info >/dev/null 2>&1; then
        echo "   ✅ Docker started successfully!"
        echo ""
        echo "=== SUCCESS: Docker is running ==="
        echo ""
        echo "⚠️  CRITICAL NEXT STEPS:"
        echo "   1. Immediately dump all Postgres databases:"
        echo "      docker-compose exec postgres pg_dumpall -U postgres > postgres-backup-$(date +%Y%m%d-%H%M%S).sql"
        echo ""
        echo "   2. Do this for ALL Postgres instances:"
        echo "      - postgres (port 5433)"
        echo "      - postgres-auth (port 5437)"
        echo "      - postgres-social (port 5434)"
        echo "      - postgres-listings (port 5435)"
        echo "      - postgres-shopping (port 5436)"
        echo "      - postgres-auction-monitor (port 5438)"
        echo "      - postgres-analytics (port 5439)"
        echo "      - postgres-python-ai (port 5440)"
        echo ""
        echo "   3. Verify backups before doing anything else"
        exit 0
    fi
    
    # Check for specific error messages
    if docker info 2>&1 | grep -q "500\|corrupt\|error"; then
        echo "   ⚠️  Docker started but API is still returning errors"
    fi
    
    echo "   Waiting... (${elapsed}s)"
    sleep 5
    elapsed=$((elapsed + 5))
done

if [ $elapsed -ge $max_wait ]; then
    echo ""
    echo "❌ Docker did not start successfully"
    echo ""
    echo "Next options:"
    echo "  1. Try restarting macOS and run this script again"
    echo "  2. Attempt volume extraction (see scripts/extract-docker-volumes.sh)"
    echo "  3. Reset Docker VM (see scripts/reset-docker-vm.sh) - LAST RESORT"
    exit 1
fi

