#!/usr/bin/env bash
# Stable deployment script - deploys resources in batches to avoid overwhelming k3s
# Usage: bash scripts/deploy-all-platform-stable.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

cd "$PROJECT_ROOT"

# Wait for cluster to be stable
wait_for_stable_cluster() {
  say "Waiting for cluster to be fully stable..."
  local max_attempts=30
  local attempt=1
  local stable_count=0
  local required_stable=5  # Need 5 consecutive successful checks
  
  while [[ $attempt -le $max_attempts ]]; do
    if kubectl cluster-info &>/dev/null 2>&1; then
      ((stable_count++))
      if [[ $stable_count -ge $required_stable ]]; then
        ok "Cluster is stable!"
        return 0
      fi
      echo "Stability check $stable_count/$required_stable..."
    else
      stable_count=0
      echo "Cluster not accessible, resetting stability counter..."
    fi
    sleep 3
    ((attempt++))
  done
  
  fail "Cluster did not stabilize after $max_attempts attempts"
}

# Deploy in batches with delays
deploy_batch() {
  local batch_name="$1"
  shift
  local resources=("$@")
  
  say "Deploying batch: $batch_name"
  
  for resource in "${resources[@]}"; do
    if [[ -f "$resource" ]]; then
      echo "  Applying $resource..."
      kubectl apply -f "$resource" --validate=false 2>&1 | grep -E "created|configured|unchanged" || true
      sleep 2  # Small delay between resources
    fi
  done
  
  # Wait after batch
  echo "Waiting 10 seconds after batch..."
  sleep 10
}

# Main execution
main() {
  say "=== Stable Platform Deployment ==="
  
  # Wait for stable cluster
  wait_for_stable_cluster
  
  # Batch 1: Namespaces and ConfigMaps
  say "Batch 1: Namespaces and ConfigMaps"
  kubectl apply -f infra/k8s/base/namespaces.yaml --validate=false 2>&1 || true
  kubectl apply -k infra/k8s/base/config --validate=false 2>&1 | head -20 || true
  sleep 10
  
  # Batch 2: Secrets
  say "Batch 2: Secrets"
  kubectl apply -k infra/k8s/base/secrets --validate=false 2>&1 | head -10 || true
  sleep 10
  
  # Batch 3: Infrastructure (postgres, redis, kafka)
  say "Batch 3: Infrastructure services"
  kubectl apply -k infra/k8s/base/postgres --validate=false 2>&1 | head -10 || true
  kubectl apply -k infra/k8s/base/redis --validate=false 2>&1 | head -10 || true
  kubectl apply -k infra/k8s/base/zookeeper --validate=false 2>&1 | head -10 || true
  kubectl apply -k infra/k8s/base/kafka --validate=false 2>&1 | head -10 || true
  sleep 15
  
  # Batch 4: Core services
  say "Batch 4: Core microservices"
  kubectl apply -k infra/k8s/base/api-gateway --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/auth-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/records-service --validate=false 2>&1 | head -5 || true
  sleep 15
  
  # Batch 5: Additional services
  say "Batch 5: Additional services"
  kubectl apply -k infra/k8s/base/listings-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/shopping-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/social-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/analytics-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/python-ai-service --validate=false 2>&1 | head -5 || true
  kubectl apply -k infra/k8s/base/auction-monitor --validate=false 2>&1 | head -5 || true
  sleep 15
  
  # Batch 6: Edge services (Caddy, Envoy)
  say "Batch 6: Edge services (Caddy, Envoy)"
  kubectl apply -f infra/k8s/caddy-h3-deploy.yaml --validate=false 2>&1 || true
  kubectl apply -f infra/k8s/caddy-h3-service.yaml --validate=false 2>&1 || true
  kubectl apply -k infra/k8s/base/envoy-test --validate=false 2>&1 | head -5 || true
  sleep 10
  
  # Batch 7: Exporters and monitoring
  say "Batch 7: Monitoring and exporters"
  kubectl apply -k infra/k8s/base/exporters --validate=false 2>&1 | head -10 || true
  kubectl apply -k infra/k8s/base/monitoring --validate=false 2>&1 | head -10 || true
  kubectl apply -k infra/k8s/base/observability --validate=false 2>&1 | head -10 || true
  sleep 10
  
  # Final verification
  say "=== Deployment Complete ==="
  echo ""
  echo "Namespaces:"
  kubectl get namespaces | grep -E "record-platform|ingress-nginx|envoy-test" || true
  echo ""
  echo "Caddy:"
  kubectl -n ingress-nginx get deployment,pods,service -l app=caddy-h3 2>&1 || true
  echo ""
  echo "Services:"
  kubectl -n record-platform get deployments --no-headers 2>&1 | wc -l | xargs echo "Total deployments:"
}

main "$@"
