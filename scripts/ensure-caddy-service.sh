#!/usr/bin/env bash
set -euo pipefail
# Ensure Caddy service with NodePort 30443 is always applied
# This prevents the service from being lost during rebuilds

NS=ingress-nginx
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "🔧 Ensuring Caddy service with NodePort 30443..."

# Apply service (idempotent - safe to run multiple times)
kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml

# Verify service exists and has correct NodePort
NODEPORT=$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
if [[ "$NODEPORT" == "30443" ]]; then
  echo "✅ Caddy service NodePort 30443 is configured correctly"
else
  echo "⚠️  Caddy service NodePort is $NODEPORT (expected 30443), fixing..."
  kubectl -n "$NS" patch svc caddy-h3 --type='json' -p='[
    {"op":"replace","path":"/spec/ports/0/nodePort","value":30443},
    {"op":"replace","path":"/spec/ports/1/nodePort","value":30443}
  ]' || kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml
  echo "✅ Fixed Caddy service NodePort"
fi

# Verify endpoints are ready
ENDPOINTS=$(kubectl -n "$NS" get endpoints caddy-h3 -o jsonpath='{.subsets[0].addresses[*].ip}' 2>/dev/null || echo "")
if [[ -n "$ENDPOINTS" ]]; then
  echo "✅ Caddy service has endpoints: $ENDPOINTS"
else
  echo "⚠️  Caddy service has no endpoints (pods may not be ready)"
fi


