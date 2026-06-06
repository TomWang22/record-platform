#!/usr/bin/env bash
# Create Caddy configmap + copy TLS/CA secrets to ingress-nginx, then apply caddy-h3 deploy and service.
# Ensures 2 caddy-h3 pods in ingress-nginx. Uses ensure-k8s-api so tunnel/API is fixed automatically.
# Usage: ./scripts/apply-caddy-h3-ingress.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CADDYFILE="${REPO_ROOT}/docs/Caddyfile"
NS_INGRESS="ingress-nginx"
NS_RP="record-platform"

# Automated API/tunnel recovery (retries + re-forward 6443)
if ! "$SCRIPT_DIR/ensure-k8s-api.sh"; then
  exit 1
fi

echo "Creating Caddy configmap and copying secrets to $NS_INGRESS..."
kubectl create configmap caddy-h3 --from-file=Caddyfile="$CADDYFILE" -n "$NS_INGRESS" --dry-run=client -o yaml | kubectl apply -f -

# Copy service-tls -> record-local-tls in ingress-nginx (create from existing secret keys)
if kubectl get secret service-tls -n "$NS_RP" >/dev/null 2>&1; then
  kubectl get secret service-tls -n "$NS_RP" -o jsonpath='{.data.tls\.crt}' | base64 -d > /tmp/tls.crt 2>/dev/null
  kubectl get secret service-tls -n "$NS_RP" -o jsonpath='{.data.tls\.key}' | base64 -d > /tmp/tls.key 2>/dev/null
  kubectl create secret generic record-local-tls --from-file=tls.crt=/tmp/tls.crt --from-file=tls.key=/tmp/tls.key -n "$NS_INGRESS" --dry-run=client -o yaml | kubectl apply -f -
  rm -f /tmp/tls.crt /tmp/tls.key
fi

# Copy dev-root-ca to ingress-nginx
if kubectl get secret dev-root-ca -n "$NS_RP" >/dev/null 2>&1; then
  kubectl get secret dev-root-ca -n "$NS_RP" -o jsonpath='{.data.dev-root\.pem}' | base64 -d > /tmp/dev-root.pem 2>/dev/null
  kubectl create secret generic dev-root-ca --from-file=dev-root.pem=/tmp/dev-root.pem -n "$NS_INGRESS" --dry-run=client -o yaml | kubectl apply -f -
  rm -f /tmp/dev-root.pem
fi

echo "Applying caddy-h3 deployment and service..."
kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" --request-timeout=60s
kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" --request-timeout=60s

echo "Scaling caddy-h3 to 2 replicas..."
kubectl scale deployment caddy-h3 -n "$NS_INGRESS" --replicas=2

echo "✅ Caddy-h3 applied. Check: kubectl get pods -n ingress-nginx -l app=caddy-h3"
