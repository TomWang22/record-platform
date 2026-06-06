#!/usr/bin/env bash
# Extract PostgreSQL data from Docker.raw
# Waits for Docker Desktop to start, then extracts all 8 databases

set -euo pipefail

DOCKER_RAW="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
BACKUP_DIR="./backups/extracted-docker-raw-$(date +%Y%m%d-%H%M%S)"
MAX_WAIT=300  # 5 minutes max wait

echo "═══════════════════════════════════════════════════════════"
echo "  Docker.raw Data Extraction (Waits for Docker Desktop)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Step 1: Wait for Docker Desktop
echo "Step 1: Waiting for Docker Desktop to start..."
echo "This may take 1-2 minutes..."
for i in $(seq 1 $MAX_WAIT); do
  if docker info >/dev/null 2>&1; then
    echo "✓ Docker Desktop is ready!"
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "  Still waiting... ($i seconds)"
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker Desktop did not start within $MAX_WAIT seconds"
  echo "Please start Docker Desktop manually and run this script again"
  exit 1
fi

# Step 2: Extract volumes
echo ""
echo "Step 2: Extracting volumes from Docker.raw..."
echo "Backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

VOLUMES=(
  "record-platform_pgdata"
  "record-platform_pgdata-auth"
  "record-platform_pgdata-social"
  "record-platform_pgdata-listings"
  "record-platform_pgdata-shopping"
  "record-platform_pgdata-auction-monitor"
  "record-platform_pgdata-analytics"
  "record-platform_pgdata-python-ai"
)

success=0
failed=0

for vol in "${VOLUMES[@]}"; do
  echo ""
  echo "Extracting $vol..."
  if docker run --rm --privileged \
    -v "$DOCKER_RAW:/docker.raw:ro" \
    -v "$(pwd)/$BACKUP_DIR:/backup" \
    alpine:latest \
    sh -c "
      apk add --no-cache util-linux e2fsprogs >/dev/null 2>&1
      losetup -P /dev/loop0 /docker.raw 2>/dev/null || true
      sleep 1
      mkdir -p /mnt/docker-raw
      mount -o ro,noload /dev/loop0p1 /mnt/docker-raw 2>/dev/null || exit 1
      vol_path=\"/mnt/docker-raw/docker/volumes/$vol/_data\"
      if [ -d \"\$vol_path\" ]; then
        mkdir -p /backup/$vol
        cp -r \"\$vol_path\"/* /backup/$vol/ 2>/dev/null || true
        echo \"SUCCESS\"
      else
        echo \"FAILED: Volume path not found\" >&2
        exit 1
      fi
      umount /mnt/docker-raw 2>/dev/null || true
      losetup -d /dev/loop0 2>/dev/null || true
    " > "$BACKUP_DIR/$vol.log" 2>&1; then
    
    if grep -q "SUCCESS" "$BACKUP_DIR/$vol.log" 2>/dev/null; then
      size=$(du -sh "$BACKUP_DIR/$vol" 2>/dev/null | cut -f1 || echo "unknown")
      echo "✓ $vol extracted ($size)"
      ((success++))
    else
      echo "✗ $vol failed (check $BACKUP_DIR/$vol.log)"
      ((failed++))
    fi
  else
    echo "✗ $vol failed (check $BACKUP_DIR/$vol.log)"
    ((failed++))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Extraction Summary"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "✓ Successfully extracted: $success volumes"
echo "✗ Failed: $failed volumes"
echo ""
echo "Backup directory: $BACKUP_DIR"
echo ""

if [ $success -gt 0 ]; then
  echo "✅ Data extraction complete!"
  echo "Your PostgreSQL data is now backed up in: $BACKUP_DIR"
else
  echo "⚠️  Extraction failed. Your data is still safe in:"
  echo "   1. Docker.raw file: $DOCKER_RAW"
  echo "   2. Existing backups: ./backups/*.sql"
fi
