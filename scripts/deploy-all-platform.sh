#!/usr/bin/env bash
# Deploy entire platform: services, Caddy, Envoy, exporters
# Usage: bash scripts/deploy-all-platform.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Wait for cluster to be accessible
wait_for_cluster() {
  say "Waiting for Kubernetes cluster to be accessible..."
  local max_attempts=24
  local attempt=1
  
  while [[ $attempt -le $max_attempts ]]; do
    if kubectl cluster-info &>/dev/null 2>&1; then
      ok "Cluster is accessible!"
      kubectl cluster-info | head -3
      return 0
    fi
    echo "Attempt $attempt/$max_attempts: Waiting for cluster..."
    sleep 5
    ((attempt++))
  done
  
  fail "Cluster not accessible after $max_attempts attempts"
}

# Verify namespaces
verify_namespaces() {
  say "Verifying required namespaces..."
  
  for ns in record-platform ingress-nginx envoy-test; do
    if kubectl get namespace "$ns" &>/dev/null 2>&1; then
      ok "Namespace $ns exists"
    else
      warn "Creating namespace $ns..."
      kubectl create namespace "$ns" 2>&1
      ok "Namespace $ns created"
    fi
  done
}

# Deploy all base services
deploy_base_services() {
  say "Deploying base services (this may take a few minutes)..."
  
  cd "$PROJECT_ROOT"
  
  # Apply with --validate=false to avoid validation errors during cluster startup
  # ServiceMonitor/PodMonitor failures are expected if Prometheus Operator CRDs aren't installed
  local output
  output=$(kubectl apply -k infra/k8s/base/ --validate=false 2>&1)
  local exit_code=$?
  
  echo "$output"
  
  # Check for expected warnings (ServiceMonitor/PodMonitor CRDs)
  if echo "$output" | grep -q "PodMonitor\|ServiceMonitor"; then
    warn "ServiceMonitor/PodMonitor resources require Prometheus Operator CRDs"
    warn "These are optional for basic functionality - services will still work"
  fi
  
  if [[ $exit_code -eq 0 ]] || echo "$output" | grep -q "created\|configured\|unchanged"; then
    ok "Base services deployed"
  else
    warn "Some resources may have failed - check output above"
  fi
  
  # Wait for deployments to be ready
  say "Waiting for deployments to be ready..."
  sleep 10
}

# Deploy Caddy
deploy_caddy() {
  say "Deploying Caddy to ingress-nginx namespace..."
  
  cd "$PROJECT_ROOT"
  
  # Retry logic for Caddy deployment (API server may be temporarily unavailable)
  local max_retries=3
  local attempt=1
  
  while [[ $attempt -le $max_retries ]]; do
    if kubectl apply -f infra/k8s/caddy-h3-deploy.yaml --validate=false 2>&1 && \
       kubectl apply -f infra/k8s/caddy-h3-service.yaml --validate=false 2>&1; then
      ok "Caddy deployed (attempt $attempt)"
      break
    else
      if [[ $attempt -eq $max_retries ]]; then
        warn "Caddy deployment failed after $max_retries attempts - checking if already exists..."
        if kubectl -n ingress-nginx get deployment caddy-h3 &>/dev/null 2>&1; then
          ok "Caddy deployment already exists"
          break
        else
          fail "Failed to deploy Caddy after $max_retries attempts"
        fi
      else
        warn "Caddy deployment attempt $attempt failed, retrying in 5s..."
        sleep 5
        ((attempt++))
      fi
    fi
  done
  
  say "Waiting for Caddy pods..."
  kubectl -n ingress-nginx wait --for=condition=ready pod -l app=caddy-h3 --timeout=120s 2>&1 || \
  warn "Caddy pods may still be starting"
}

# Deploy Envoy
deploy_envoy() {
  say "Deploying Envoy to envoy-test namespace..."
  
  cd "$PROJECT_ROOT"
  
  kubectl apply -k infra/k8s/base/envoy-test/ 2>&1 && \
  ok "Envoy deployed" || fail "Failed to deploy Envoy"
  
  say "Waiting for Envoy pod..."
  kubectl -n envoy-test wait --for=condition=ready pod -l app=envoy --timeout=120s 2>&1 || \
  warn "Envoy pod may still be starting"
}

# Show status
show_status() {
  say "=== Deployment Status ==="
  
  echo ""
  echo "Caddy pods (ingress-nginx):"
  kubectl -n ingress-nginx get pods -l app=caddy-h3 2>&1
  
  echo ""
  echo "Envoy pod (envoy-test):"
  kubectl -n envoy-test get pods 2>&1
  
  echo ""
  echo "Service pods (record-platform):"
  kubectl -n record-platform get pods 2>&1 | head -20
  
  echo ""
  echo "Services:"
  kubectl -n record-platform get services 2>&1 | head -10
}

# Main execution
main() {
  say "=== Platform Deployment ==="
  
  # Wait for cluster
  wait_for_cluster
  
  # Verify namespaces
  verify_namespaces
  
  # Deploy base services
  deploy_base_services
  
  # Deploy Caddy
  deploy_caddy
  
  # Deploy Envoy
  deploy_envoy
  
  # Show status
  show_status
  
  say "=== Deployment Complete ==="
  ok "All resources deployed!"
  echo ""
  echo "Next steps:"
  echo "  1. Wait for all pods to be ready: kubectl get pods --all-namespaces -w"
  echo "  2. Run smoke tests: bash scripts/test-microservices-http2-http3.sh"
  echo "  3. Run enhanced tests: bash scripts/test-microservices-http2-http3-enhanced.sh"
}

main "$@"
