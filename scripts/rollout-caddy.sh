#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Apply Caddy ConfigMap
kubectl -n "$NS" create configmap caddy-h3 --from-file=Caddyfile=./Caddyfile -o yaml --dry-run=client | kubectl apply -f -

# Apply Caddy Deployment
if [ -f "infra/k8s/caddy-h3-deploy.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-deploy.yaml
elif [ -f "./caddy-deploy.yaml" ]; then
  kubectl -n "$NS" apply -f ./caddy-deploy.yaml
fi

# CRITICAL: Apply Service to ensure NodePort 30443 persists
# Try both possible file names (svc.yaml and service.yaml)
if [ -f "infra/k8s/caddy-h3-svc.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
  echo "✅ Applied Caddy service (NodePort 30443) from caddy-h3-svc.yaml"
elif [ -f "infra/k8s/caddy-h3-service.yaml" ]; then
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml
  echo "✅ Applied Caddy service (NodePort 30443) from caddy-h3-service.yaml"
else
  echo "⚠️  WARNING: No Caddy service file found! NodePort 30443 may not be configured."
  echo "   Expected: infra/k8s/caddy-h3-svc.yaml or infra/k8s/caddy-h3-service.yaml"
fi

kubectl -n "$NS" rollout status deploy/caddy-h3
kubectl -n "$NS" logs deploy/caddy-h3 --tail=200 | egrep -i 'HTTP/3 listener|server running|protocols|http.log.error|x509|verify|dial|lookup' || true