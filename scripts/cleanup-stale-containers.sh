#!/usr/bin/env bash
set -euo pipefail

# Clean up stale containers from nodeport_curl and other helpers
# This frees up Docker resources and storage

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Cleaning up stale containers..."

# Clean up stale curl containers
CURL_CONTAINERS=$(docker ps -a -q --filter "ancestor=curlimages/curl:latest" 2>/dev/null | wc -l | tr -d '[:space:]')
if [[ "$CURL_CONTAINERS" -gt 0 ]]; then
  say "Removing $CURL_CONTAINERS stale curl containers..."
  docker rm -f $(docker ps -a -q --filter "ancestor=curlimages/curl:latest") 2>/dev/null || true
  ok "Removed $CURL_CONTAINERS curl containers"
else
  ok "No stale curl containers found"
fi

# Clean up any stopped containers
STOPPED=$(docker ps -a -q --filter "status=exited" 2>/dev/null | wc -l | tr -d '[:space:]')
if [[ "$STOPPED" -gt 0 ]]; then
  say "Removing $STOPPED stopped containers..."
  docker container prune -f >/dev/null 2>&1 || true
  ok "Removed stopped containers"
else
  ok "No stopped containers found"
fi

# Show current status
say "Current container status:"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | head -20

ok "Cleanup complete!"

