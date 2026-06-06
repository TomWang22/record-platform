#!/usr/bin/env bash
# Preflight environment checklist: context, Docker, MetalLB, Caddy, observability.
# Run before or after preflight to see what's running and what to fix.
# See: PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Preflight environment check ==="
echo ""

# 1. Kubernetes context (preflight requires Colima)
echo "1. Kubernetes context"
ctx=$(kubectl config current-context 2>/dev/null || echo "none")
echo "   current-context: $ctx"
if [[ "$ctx" == *"kind"* ]] || [[ "$ctx" == "h3" ]]; then
  echo "   ⚠️  Preflight is Colima-only; switch: kubectl config use-context colima"
fi
nclusters=$(kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' | grep -c . || echo "0")
echo "   clusters in kubeconfig: $nclusters"
echo ""

# 2. API and nodes (establish tunnel if Colima so get nodes can succeed)
echo "2. API and nodes"
if [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]] && ! kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
  echo "   (establishing 6443 tunnel for Colima...)"
  "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
  _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || true)
  [[ -n "$_cluster" ]] && kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" 2>/dev/null || true
  sleep 2
fi
if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
  kubectl get nodes --no-headers 2>/dev/null | sed 's/^/   /'
  API_REACHABLE=1
else
  echo "   ⚠️  API not reachable (kubectl get nodes failed). Try: colima start --with-kubernetes; ./scripts/colima-forward-6443.sh"
  API_REACHABLE=0
fi
echo ""

# 2b. All namespaces (only when API reachable)
echo "2b. All namespaces"
if [[ "${API_REACHABLE:-0}" -eq 1 ]]; then
  kubectl get ns --no-headers 2>/dev/null | sed 's/^/   /' || echo "   (failed to list)"
else
  echo "   (skipped — API not reachable). Run: ./scripts/colima-forward-6443.sh ; colima start --with-kubernetes if needed; then re-run this script."
fi
echo ""

# 2c. Pods in all namespaces (when API reachable)
echo "2c. Pods in all namespaces (kubectl get pods -A)"
if [[ "${API_REACHABLE:-0}" -eq 1 ]]; then
  kubectl get pods -A --no-headers 2>/dev/null | sed 's/^/   /' || echo "   (failed to list)"
else
  echo "   (skipped — API not reachable)"
fi
echo ""

# 3. Docker (Postgres, Kafka, Zookeeper - preflight 3b2/3b3)
echo "3. Docker (postgres, kafka, zookeeper for preflight 3b2/3b3)"
if command -v docker >/dev/null 2>&1; then
  running=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
  if [[ -n "$running" ]]; then
    echo "$running" | sed 's/^/   /'
  else
    echo "   (no containers running)"
  fi
  if ! echo "$running" | grep -qE 'postgres|kafka|zookeeper'; then
    echo "   ⚠️  Preflight expects Docker Postgres/Kafka/ZK; start with docker compose up -d (see preflight 3b2/3b3)"
  fi
else
  echo "   docker not in PATH"
fi
echo ""

# 4. MetalLB (controller = webhook; pool/Caddy apply needs it)
echo "4. MetalLB (controller = webhook for pool apply)"
if [[ "${API_REACHABLE:-0}" -eq 0 ]]; then
  echo "   (skipped — API not reachable)"
elif kubectl get ns metallb-system --request-timeout=3s >/dev/null 2>&1; then
  kubectl get pods -n metallb-system --no-headers 2>/dev/null | sed 's/^/   /'
  ep=$(kubectl get ep -n metallb-system webhook-service -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
  if [[ -z "$ep" ]]; then
    echo "   ⚠️  webhook-service has no endpoints → pool apply will fail with InternalError (endpoints not found)"
    echo "   Fix: ensure controller pod is Running; see METALLB_AND_API_503_REPORT.md Option B2"
  else
    echo "   webhook-service endpoints: $ep"
  fi
else
  echo "   metallb-system namespace not found (MetalLB not installed)"
fi
echo ""

# 5. Caddy service (ingress-nginx)
echo "5. Caddy service (ingress-nginx)"
if [[ "${API_REACHABLE:-0}" -eq 0 ]]; then
  echo "   (skipped — API not reachable)"
elif kubectl get ns ingress-nginx --request-timeout=3s >/dev/null 2>&1; then
  kubectl get svc -n ingress-nginx caddy-h3 --no-headers 2>/dev/null | sed 's/^/   /' || echo "   caddy-h3 not found"
else
  echo "   ingress-nginx namespace not found"
fi
echo ""

# 6. Observability / monitoring pods
echo "6. Observability and monitoring pods"
if [[ "${API_REACHABLE:-0}" -eq 0 ]]; then
  echo "   (skipped — API not reachable)"
else
for ns in monitoring observability; do
  if kubectl get ns "$ns" --request-timeout=3s >/dev/null 2>&1; then
    pods=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | head -20)
    if [[ -n "$pods" ]]; then
      echo "   $ns:"
      echo "$pods" | sed 's/^/     /'
    else
      echo "   $ns: (no pods)"
    fi
  else
    echo "   $ns: namespace not found"
  fi
done
fi
echo ""

echo "=== End checklist ==="
echo "See PREFLIGHT_WHY_IT_WORKED_AND_WHATS_BROKEN.md and METALLB_AND_API_503_REPORT.md for fixes."
