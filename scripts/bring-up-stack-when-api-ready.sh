#!/usr/bin/env bash
# One-shot bring-up: ensure API (auto tunnel retry), install Prometheus Operator CRDs, MetalLB, base, Caddy-h3, verify.
# Usage: ./scripts/bring-up-stack-when-api-ready.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "Ensuring API (retries + tunnel fix)..."
"$SCRIPT_DIR/ensure-k8s-api.sh" || exit 1

echo ""
echo "Installing Prometheus Operator CRDs (ServiceMonitor, PodMonitor)..."
"$SCRIPT_DIR/install-prometheus-operator-crds.sh" 2>&1 || echo "CRDs may already exist."

echo ""
echo "Installing MetalLB..."
"$SCRIPT_DIR/install-metallb.sh" 2>&1 || echo "MetalLB had errors; re-run when stable: ./scripts/install-metallb.sh"

echo ""
echo "Applying base (namespaces, config, observability, record-platform, envoy-test)..."
kubectl apply -k "$REPO_ROOT/infra/k8s/base" --validate=ignore --request-timeout=180s 2>&1 || echo "Some resources may have failed; re-run if needed."

echo ""
echo "Applying Caddy-h3 (2 pods in ingress-nginx)..."
"$SCRIPT_DIR/apply-caddy-h3-ingress.sh" 2>&1 || echo "Caddy apply had errors; re-run: ./scripts/apply-caddy-h3-ingress.sh"

echo ""
echo "Verifying..."
echo "Nodes:" && kubectl get nodes
echo ""
echo "Ingress-nginx (caddy-h3, expect 2):" && kubectl get pods -n ingress-nginx -l app=caddy-h3 2>/dev/null || true
echo ""
echo "Envoy-test (expect 1):" && kubectl get pods -n envoy-test -l app=envoy-test 2>/dev/null || true
echo ""
echo "Record-platform deployments:" && kubectl get deployments -n record-platform 2>/dev/null || true
echo ""
echo "Observability:" && kubectl get deployments -n observability 2>/dev/null || true
echo ""
echo "Done. Docker: ensure Colima is running (colima start --with-kubernetes --vm-type=vz --cpu 12 --memory 16 --disk 256)."
echo "DB: postgres runs on host (Docker Compose); k8s services use host.docker.internal."
