#!/usr/bin/env bash
set -euo pipefail

# Docker cleanup script - prunes stale images, containers, and build cache
# Use this to free up storage space before building images

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

AGGRESSIVE="${AGGRESSIVE:-false}"

say "Docker Cleanup - Pruning Stale Resources"

# Show current disk usage
say "Current Docker disk usage:"
docker system df

# Prune dangling images (safe - only removes untagged images)
say "Pruning dangling images..."
docker image prune -f
ok "Dangling images pruned"

# Prune stopped containers (safe - only removes stopped containers)
say "Pruning stopped containers..."
docker container prune -f
ok "Stopped containers pruned"

# Prune unused networks (safe)
say "Pruning unused networks..."
docker network prune -f
ok "Unused networks pruned"

# Optional: Prune build cache (can free significant space but slows next build)
if [[ "$AGGRESSIVE" == "true" ]]; then
  say "Pruning build cache (aggressive mode)..."
  docker builder prune -af
  ok "Build cache pruned"
else
  warn "Skipping build cache prune (set AGGRESSIVE=true to enable)"
  warn "  This can free significant space but will slow down next build"
fi

# Show disk usage after cleanup
say "Docker disk usage after cleanup:"
docker system df

ok "Docker cleanup complete!"

