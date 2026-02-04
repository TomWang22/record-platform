#!/bin/bash
set -euo pipefail

echo "=== Disk Space Cleanup Script ==="
echo ""
echo "Current disk usage:"
df -h . | tail -1
echo ""

# Check if we're on Colima
if docker context show 2>/dev/null | grep -q colima; then
    echo "✅ Using Colima - Docker Desktop can be safely removed"
else
    echo "⚠️  WARNING: Not using Colima context. Are you sure you want to remove Docker Desktop?"
    read -p "Continue? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo "Aborted."
        exit 1
    fi
fi

echo ""
echo "=== Step 1: Stop Docker Desktop ==="
if pgrep -f "Docker Desktop" > /dev/null; then
    echo "Stopping Docker Desktop..."
    osascript -e 'quit app "Docker"' 2>/dev/null || killall Docker 2>/dev/null || true
    sleep 3
    echo "✅ Docker Desktop stopped"
else
    echo "✅ Docker Desktop not running"
fi

echo ""
echo "=== Step 2: Remove docker.raw (256GB) ==="
DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
if [[ -f "$DOCKER_RAW" ]]; then
    SIZE=$(ls -lh "$DOCKER_RAW" | awk '{print $5}')
    echo "Removing docker.raw ($SIZE)..."
    rm -f "$DOCKER_RAW"
    echo "✅ docker.raw removed"
else
    echo "✅ docker.raw not found (already removed?)"
fi

echo ""
echo "=== Step 3: Remove Docker Desktop Container Directory (164GB) ==="
DOCKER_CONTAINER_DIR="$HOME/Library/Containers/com.docker.docker"
if [[ -d "$DOCKER_CONTAINER_DIR" ]]; then
    SIZE=$(du -sh "$DOCKER_CONTAINER_DIR" 2>/dev/null | awk '{print $1}')
    echo "Removing Docker Desktop container directory ($SIZE)..."
    rm -rf "$DOCKER_CONTAINER_DIR"
    echo "✅ Docker Desktop container directory removed"
else
    echo "✅ Docker Desktop container directory not found"
fi

echo ""
echo "=== Step 4: Clean Docker Build Cache ==="
if docker context show 2>/dev/null | grep -q colima; then
    echo "Switching to Colima context..."
    docker context use colima 2>/dev/null || true
    sleep 2
fi

if docker info > /dev/null 2>&1; then
    echo "Pruning Docker build cache..."
    docker builder prune -af --volumes 2>&1 | tail -10 || echo "Build cache prune completed"
    echo "✅ Docker build cache cleaned"
else
    echo "⚠️  Docker daemon not accessible, skipping build cache prune"
fi

echo ""
echo "=== Step 5: Clean Node Modules (if needed) ==="
if [[ -d "$HOME/record-platform/node_modules" ]]; then
    SIZE=$(du -sh "$HOME/record-platform/node_modules" 2>/dev/null | awk '{print $1}')
    echo "Found node_modules ($SIZE)"
    echo "Skipping node_modules cleanup (needed for development)"
    echo "Run 'rm -rf node_modules && pnpm install' if you want to clean it"
fi

echo ""
echo "=== Step 6: Clean Build Artifacts ==="
cd "$HOME/record-platform" || exit 1
echo "Cleaning .next directories..."
find . -type d -name ".next" -exec rm -rf {} + 2>/dev/null || true
echo "Cleaning Python __pycache__..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
echo "Cleaning dist/build directories..."
find . -type d \( -name "dist" -o -name "build" \) -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
echo "✅ Build artifacts cleaned"

echo ""
echo "=== Final Disk Usage ==="
df -h . | tail -1
echo ""
echo "✅ Cleanup complete!"
