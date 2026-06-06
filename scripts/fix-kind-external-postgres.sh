#!/usr/bin/env bash
set -euo pipefail

# Fix Kind cluster to access external Docker Compose postgres databases
# This script needs to be run AFTER Kind cluster is created
# OR the Kind config (kind-h3.yaml) needs to have extraHosts configured

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Fixing Kind External Postgres Access ==="

# Add host.docker.internal to Kind node's /etc/hosts
KIND_NODE=$(docker ps --filter "name=h3-control-plane" --format "{{.Names}}" | head -1)

if [[ -z "$KIND_NODE" ]]; then
  fail "Kind cluster 'h3' not found"
fi

say "Found Kind node: $KIND_NODE"

# Get the Docker bridge gateway IP (this is what host.docker.internal should resolve to)
GATEWAY_IP=$(docker network inspect bridge | grep -A 1 '"Gateway"' | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)

if [[ -z "$GATEWAY_IP" ]]; then
  # Fallback to common Docker Desktop gateway
  GATEWAY_IP="172.17.0.1"
  warn "Could not detect gateway IP, using default: $GATEWAY_IP"
else
  ok "Detected Docker gateway IP: $GATEWAY_IP"
fi

# Add host.docker.internal to /etc/hosts in Kind node
say "Adding host.docker.internal to Kind node /etc/hosts..."
docker exec "$KIND_NODE" sh -c "echo '$GATEWAY_IP host.docker.internal' >> /etc/hosts" || {
  warn "Failed to add to /etc/hosts (may require cluster restart)"
}

# Verify it's added
if docker exec "$KIND_NODE" getent hosts host.docker.internal >/dev/null 2>&1; then
  ok "host.docker.internal is now resolvable in Kind node"
  docker exec "$KIND_NODE" getent hosts host.docker.internal
else
  warn "host.docker.internal still not resolvable - may need to recreate cluster"
fi

say "=== Done ==="
say "Note: If this doesn't work, recreate the Kind cluster with extraHosts in kind-h3.yaml"

