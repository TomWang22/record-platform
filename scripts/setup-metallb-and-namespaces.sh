#!/usr/bin/env bash
# Create namespaces and install MetalLB (LoadBalancer pool) for Colima.
# Run after Colima is up and external infra is up. Use after ensure-external-databases-created.sh.
# Pool defaults to 192.168.64.240-192.168.64.250 (same subnet as colima address 192.168.64.7).
# Usage: ./scripts/setup-metallb-and-namespaces.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"

echo "=== Namespaces ==="
if [[ -f "$REPO_ROOT/infra/k8s/base/namespaces.yaml" ]]; then
  kubectl apply -f "$REPO_ROOT/infra/k8s/base/namespaces.yaml" --request-timeout=15s
  echo "✅ record-platform, monitoring, ingress-nginx"
fi
if [[ -f "$REPO_ROOT/infra/k8s/base/observability/namespace.yaml" ]]; then
  kubectl apply -f "$REPO_ROOT/infra/k8s/base/observability/namespace.yaml" --request-timeout=15s
  echo "✅ observability"
fi

echo ""
echo "=== MetalLB (pool $METALLB_POOL) ==="
if [[ -f "$SCRIPT_DIR/install-metallb-colima.sh" ]]; then
  chmod +x "$SCRIPT_DIR/install-metallb-colima.sh"
  METALLB_POOL="$METALLB_POOL" "$SCRIPT_DIR/install-metallb-colima.sh"
else
  echo "⚠️  install-metallb-colima.sh not found; install MetalLB manually and apply pool $METALLB_POOL"
  exit 1
fi

echo ""
echo "Done. Next: ./scripts/deploy-colima-after-infra.sh (CRDs, base apply, :dev image build, Caddy LoadBalancer). Or run preflight / kubectl apply -k infra/k8s/base then CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh"
