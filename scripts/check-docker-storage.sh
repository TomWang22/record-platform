#!/usr/bin/env bash
set -euo pipefail

# Docker Storage Monitoring Script
# Shows detailed storage usage breakdown

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "📊 Docker Storage Report"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
  warn "Docker is not running. Please start Docker Desktop first."
  exit 1
fi

# Overall Docker storage
say "Overall Docker Storage Usage:"
docker system df -v
echo ""

# System disk space
say "System Disk Space:"
df -h | head -5
echo ""

# Docker volumes
say "Docker Volumes:"
VOLUMES=$(docker volume ls -q | grep pgdata || echo "")
if [[ -n "$VOLUMES" ]]; then
  info "PostgreSQL volumes:"
  for vol in $VOLUMES; do
    # Try to get size (may fail if Docker storage is full)
    size=$(docker run --rm -v "$vol":/data alpine du -sh /data 2>/dev/null | cut -f1 || echo "Unable to read")
    echo "  $vol: $size"
  done
else
  info "No pgdata volumes found"
fi
echo ""

# Running containers
say "Running Containers:"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | head -20
echo ""

# Storage recommendations
say "💡 Storage Recommendations:"
TOTAL_USAGE=$(docker system df | grep "Local Volumes" | awk '{print $4}' || echo "0")
if [[ "$TOTAL_USAGE" != "0B" ]] && [[ "$TOTAL_USAGE" != "0" ]]; then
  warn "You have significant volume usage. Consider:"
  info "  1. Review DOCKER_STORAGE_MANAGEMENT.md for optimization strategies"
  info "  2. Run ./scripts/cleanup-docker-storage.sh to free space"
  info "  3. Consider migrating to single PostgreSQL instance (90% storage reduction)"
fi

# Check Docker Desktop disk image size (macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  say "Docker Desktop Settings:"
  info "To expand Docker disk image:"
  info "  1. Open Docker Desktop"
  info "  2. Go to Settings → Resources → Advanced"
  info "  3. Increase 'Disk image size' (recommended: 100GB+ for 8 databases)"
  info "  4. Click 'Apply & Restart'"
fi

