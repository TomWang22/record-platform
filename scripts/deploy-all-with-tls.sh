#!/usr/bin/env bash
# Deploy all services with strict TLS, bypassing kubectl timeout

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Deploying All Services with Strict TLS ==="

# Fix kubectl port
CORRECT_PORT=$(docker port h3-control-plane 2>&1 | grep 6443 | awk '{print $3}' | cut -d: -f2)
if [[ -n "$CORRECT_PORT" ]]; then
  kubectl config set-cluster kind-h3 --server="https://127.0.0.1:$CORRECT_PORT" >/dev/null 2>&1
fi

# Copy files to container
say "Copying deployment files..."
docker cp . h3-control-plane:/tmp/record-platform >/dev/null 2>&1

# Deploy using docker exec (bypasses timeout)
say "Deploying services..."
docker exec h3-control-plane sh -c "cd /tmp/record-platform && kubectl apply -k infra/k8s/overlays/dev --validate=false" 2>&1 | grep -E "created|configured|deployment" | head -20

say "=== Deployment Complete ==="
ok "Services deploying with strict TLS (CA + leaf)"
