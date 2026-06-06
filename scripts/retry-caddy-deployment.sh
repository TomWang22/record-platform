#!/usr/bin/env bash
# Retry Caddy deployment - handles cluster API server temporary unavailability
# Usage: bash scripts/retry-caddy-deployment.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

cd "$PROJECT_ROOT"

say "=== Retrying Caddy Deployment ==="

# Wait for cluster to be accessible
say "Waiting for cluster to be accessible..."
max_attempts=24
attempt=1

while [[ $attempt -le $max_attempts ]]; do
  if kubectl cluster-info &>/dev/null 2>&1; then
    ok "Cluster is accessible!"
    break
  fi
  echo "Attempt $attempt/$max_attempts: Waiting for cluster..."
  sleep 5
  ((attempt++))
done

if [[ $attempt -gt $max_attempts ]]; then
  fail "Cluster not accessible after $max_attempts attempts"
fi

# Check if Caddy already exists
if kubectl -n ingress-nginx get deployment caddy-h3 &>/dev/null 2>&1; then
  ok "Caddy deployment already exists"
  kubectl -n ingress-nginx get deployment caddy-h3
  say "Checking pods..."
  kubectl -n ingress-nginx get pods -l app=caddy-h3
  exit 0
fi

# Deploy Caddy with retry logic
say "Deploying Caddy..."
max_retries=5
retry_attempt=1

while [[ $retry_attempt -le $max_retries ]]; do
  echo "Deployment attempt $retry_attempt/$max_retries..."
  
  if kubectl apply -f infra/k8s/caddy-h3-deploy.yaml --validate=false 2>&1 && \
     kubectl apply -f infra/k8s/caddy-h3-service.yaml --validate=false 2>&1; then
    ok "Caddy deployed successfully!"
    break
  else
    if [[ $retry_attempt -eq $max_retries ]]; then
      fail "Failed to deploy Caddy after $max_retries attempts"
    else
      warn "Attempt $retry_attempt failed, waiting 10s before retry..."
      sleep 10
      ((retry_attempt++))
    fi
  fi
done

# Verify deployment
say "Verifying Caddy deployment..."
kubectl -n ingress-nginx get deployment caddy-h3
kubectl -n ingress-nginx get service caddy-h3

say "Waiting for Caddy pods to start..."
sleep 10
kubectl -n ingress-nginx get pods -l app=caddy-h3

say "=== Caddy Deployment Complete ==="
ok "Caddy should be running. Check pod status above."
