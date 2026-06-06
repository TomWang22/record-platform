#!/usr/bin/env bash
# Deploy services using docker exec to bypass kubectl TLS issues

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Deploying Services via Docker Exec ==="

# Copy k8s manifests into kind container
CONTAINER="h3-control-plane"
WORKSPACE="/workspace"

# Check if workspace exists in container
if ! docker exec $CONTAINER test -d $WORKSPACE 2>/dev/null; then
  warn "Workspace not mounted - using kubectl apply with --validate=false"
  kubectl apply -k infra/k8s/overlays/dev --validate=false 2>&1 | head -30
else
  ok "Using docker exec to deploy"
  docker exec $CONTAINER kubectl apply -k $WORKSPACE/infra/k8s/overlays/dev 2>&1 | head -30
fi

say "=== Deployment Complete ==="
ok "Services deploying..."
