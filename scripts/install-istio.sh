#!/usr/bin/env bash
# Install Istio service mesh (istiod) using istioctl from repo (istio-1.21.0).
# Run once per cluster. Usage: ./scripts/install-istio.sh
#   ISTIO_PROFILE=default  (default, minimal, or demo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ISTIOCTL="${REPO_ROOT}/istio-1.21.0/bin/istioctl"
PROFILE="${ISTIO_PROFILE:-default}"

if [[ ! -x "$ISTIOCTL" ]]; then
  echo "❌ istioctl not found at $ISTIOCTL"
  exit 1
fi

export PATH="$(dirname "$ISTIOCTL"):${PATH:-}"

echo "Installing Istio (profile=$PROFILE)..."
"$ISTIOCTL" install -y --set profile="$PROFILE"

echo "Waiting for istiod..."
kubectl wait -n istio-system --for=condition=available deployment/istiod --timeout=120s 2>/dev/null || true

echo "✅ Istio installed. To inject a namespace: kubectl label namespace record-platform istio-injection=enabled --overwrite"
echo "   Then restart workloads so they get the sidecar, or: kubectl rollout restart deployment -n record-platform"
