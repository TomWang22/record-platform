#!/usr/bin/env bash
set -euo pipefail
# Script to fix Caddy certificates and ensure service is properly configured
# Run this after rebuilds/restarts to ensure everything is working

NS=ingress-nginx
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "🔧 Fixing Caddy certificates and service..."

# 1. Ensure certificates exist and are valid
if [ ! -f "certs/record.local.crt" ] || [ ! -f "certs/record.local.key" ]; then
  echo "⚠️  Certificate files not found in certs/, regenerating..."
  if command -v mkcert >/dev/null 2>&1; then
    mkdir -p certs
    mkcert -cert-file certs/record.local.crt -key-file certs/record.local.key record.local "*.record.local" localhost 127.0.0.1 ::1
    # Copy CA cert
    CA_PATH="$(mkcert -CAROOT)/rootCA.pem"
    if [ -f "$CA_PATH" ]; then
      cp "$CA_PATH" certs/dev-root.pem
    fi
    echo "✅ Certificates regenerated"
  else
    echo "❌ mkcert not found. Install with: brew install mkcert && mkcert -install"
    exit 1
  fi
fi

# 2. Apply certificates to Kubernetes
echo "📦 Applying certificates to Kubernetes..."
if [ -f "scripts/strict-tls-bootstrap.sh" ]; then
  bash scripts/strict-tls-bootstrap.sh
else
  kubectl -n "$NS" create secret tls record-local-tls \
    --cert=certs/record.local.crt --key=certs/record.local.key \
    -o yaml --dry-run=client | kubectl apply -f -
  kubectl -n "$NS" create secret generic dev-root-ca \
    --from-file=dev-root.pem=certs/dev-root.pem \
    -o yaml --dry-run=client | kubectl apply -f -
fi

# 3. Ensure service exists
echo "🔌 Ensuring Caddy service exists..."
if [ -f "scripts/ensure-caddy-service.sh" ]; then
  bash scripts/ensure-caddy-service.sh
else
  if [ -f "infra/k8s/caddy-h3-svc.yaml" ]; then
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
  elif [ -f "infra/k8s/caddy-h3-service.yaml" ]; then
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-service.yaml
  fi
fi

# 4. Restart Caddy to reload certificates
echo "🔄 Restarting Caddy to reload certificates..."
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=90s

# 5. Wait a bit for TLS to be ready
echo "⏳ Waiting for TLS to be ready..."
sleep 3

# 6. Verify service
echo "✅ Verification:"
kubectl -n "$NS" get svc caddy-h3
kubectl -n "$NS" get pods -l app=caddy-h3

echo ""
echo "✅ Caddy certificates and service fixed!"
echo "💡 Test with: curl -k -sS -I --http2 -H 'Host: record.local' 'https://127.0.0.1:30443/_caddy/healthz'"

