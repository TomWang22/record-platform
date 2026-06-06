#!/usr/bin/env bash
# Reset Docker Desktop VM to fix corruption
# WARNING: This will delete the corrupted VM and all Docker data (containers, images, volumes)

set -euo pipefail

echo "=== Docker VM Reset Script ==="
echo ""
echo "⚠️  WARNING: This will delete:"
echo "   - All Docker containers"
echo "   - All Docker images"
echo "   - All Docker volumes (including Postgres data)"
echo "   - All Docker networks"
echo ""
echo "This is necessary to fix the corrupted Docker VM."
echo ""

# Confirm before proceeding
read -p "Are you sure you want to proceed? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "Step 1: Quitting Docker Desktop completely..."
pkill -9 -f "com.docker" || true
osascript -e 'quit app "Docker"' 2>/dev/null || true
sleep 3

echo "Step 2: Verifying Docker processes are stopped..."
if pgrep -f "com.docker" > /dev/null; then
    echo "⚠️  Some Docker processes are still running. Force killing..."
    pkill -9 -f "com.docker"
    sleep 2
fi

echo "Step 3: Removing corrupted VM..."
if [[ -d ~/Library/Containers/com.docker.docker/Data/vms ]]; then
    echo "   Removing VM directory..."
    rm -rf ~/Library/Containers/com.docker.docker/Data/vms
    echo "   ✅ VM directory removed"
else
    echo "   ⚠️  VM directory not found (may have been removed already)"
fi

echo ""
echo "Step 4: Optional - Remove all Docker data (for complete reset)"
echo "   This includes: containers, images, volumes, networks, build cache"
read -p "   Remove ALL Docker data? (yes/no, default: no): " remove_all
if [[ "$remove_all" == "yes" ]]; then
    echo "   Removing all Docker data..."
    rm -rf ~/Library/Containers/com.docker.docker
    echo "   ✅ All Docker data removed"
else
    echo "   Keeping Docker settings and preferences (only VM removed)"
fi

echo ""
echo "Step 5: Starting Docker Desktop..."
open -a Docker

echo ""
echo "⏳ Waiting for Docker to start (this may take 30-60 seconds)..."
echo "   Checking Docker status..."

# Wait for Docker to be ready (max 2 minutes)
max_wait=120
elapsed=0
while [ $elapsed -lt $max_wait ]; do
    if docker info >/dev/null 2>&1; then
        echo "   ✅ Docker is ready!"
        break
    fi
    echo "   Waiting... (${elapsed}s)"
    sleep 5
    elapsed=$((elapsed + 5))
done

if [ $elapsed -ge $max_wait ]; then
    echo "   ⚠️  Docker did not start within 2 minutes"
    echo "   Please check Docker Desktop manually"
    exit 1
fi

echo ""
echo "=== Docker Reset Complete ==="
echo ""
echo "✅ Docker VM has been reset and Docker Desktop is running"
echo ""
echo "Next steps:"
echo "1. Verify Docker is working: docker ps"
echo "2. Start Postgres containers: docker-compose up -d postgres postgres-auth postgres-social postgres-listings postgres-shopping postgres-auction-monitor postgres-analytics postgres-python-ai"
echo "3. Run database migrations for each service"
echo "4. Re-seed test data if needed"
echo ""
echo "⚠️  Remember: All Postgres data has been lost. You'll need to:"
echo "   - Run Prisma migrations to recreate schemas"
echo "   - Re-seed any test/development data"
echo "   - Set up regular backups going forward"

