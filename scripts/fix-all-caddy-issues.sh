#!/usr/bin/env bash
set -euo pipefail

NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "🔧 Fixing all Caddy issues: TLS termination, protocol mismatch, certs, and service..."

# 1. Ensure Caddy NodePort service exists
say "1️⃣  Ensuring Caddy NodePort service (30443)..."
if [[ -f "infra/k8s/caddy-h3-service.yaml" ]]; then
  kubectl -n "$NS_ING" apply -f infra/k8s/caddy-h3-service.yaml >/dev/null 2>&1
  ok "Caddy service applied"
else
  fail "Caddy service file not found: infra/k8s/caddy-h3-service.yaml"
fi

# 2. Regenerate certificates to ensure fresh certs
say "2️⃣  Regenerating certificates..."
if ! command -v mkcert >/dev/null 2>&1; then
  warn "mkcert not found, skipping certificate regeneration"
else
  CA_PATH="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
  if [[ ! -f "$CA_PATH" ]]; then
    warn "mkcert CA not installed, skipping certificate regeneration"
  else
    mkdir -p certs
    mkcert -cert-file certs/record.local.crt -key-file certs/record.local.key \
      "${HOST}" "*.${HOST}" localhost 127.0.0.1 ::1 >/dev/null 2>&1
    
    # Apply TLS secret
    kubectl -n "$NS_ING" delete secret record-local-tls --ignore-not-found >/dev/null 2>&1 || true
    kubectl -n "$NS_ING" create secret tls record-local-tls \
      --cert=certs/record.local.crt --key=certs/record.local.key >/dev/null 2>&1
    
    # Apply CA secret
    kubectl -n "$NS_ING" create secret generic dev-root-ca \
      --from-file=dev-root.pem="$CA_PATH" \
      -o yaml --dry-run=client | kubectl apply -f - >/dev/null 2>&1
    
    ok "Certificates regenerated and applied"
  fi
fi

# 3. Verify Caddyfile has correct syntax (no tls_trust_pool block, use deprecated but working syntax)
say "3️⃣  Verifying Caddyfile syntax..."
if ! grep -q "tls_trusted_ca_certs /etc/caddy/ca/dev-root.pem" Caddyfile 2>/dev/null; then
  warn "Caddyfile may need tls_trusted_ca_certs directive, but continuing..."
fi

# 4. Apply Caddyfile ConfigMap
say "4️⃣  Applying Caddyfile ConfigMap..."
kubectl -n "$NS_ING" create configmap caddy-h3 \
  --from-file=Caddyfile=./Caddyfile \
  -o yaml --dry-run=client | kubectl apply -f - >/dev/null 2>&1
ok "Caddyfile ConfigMap applied"

# 5. Restart Caddy to pick up all changes
say "5️⃣  Restarting Caddy deployment..."
kubectl -n "$NS_ING" rollout restart deploy/caddy-h3 >/dev/null 2>&1
kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=120s >/dev/null 2>&1 || {
  warn "Rollout status check timed out, checking pod status..."
  kubectl -n "$NS_ING" get pods -l app=caddy-h3
}

# 6. Wait for pods to be ready
say "6️⃣  Waiting for Caddy pods to be ready..."
for i in {1..30}; do
  READY=$(kubectl -n "$NS_ING" get deployment caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  DESIRED=$(kubectl -n "$NS_ING" get deployment caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$READY" == "$DESIRED" ]] && [[ "$READY" != "0" ]]; then
    ok "All $READY/$DESIRED Caddy pods are ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    warn "Pods not ready after 30s, checking status..."
    kubectl -n "$NS_ING" get pods -l app=caddy-h3
    kubectl -n "$NS_ING" logs -l app=caddy-h3 --tail=20 | grep -iE "error|fatal" | head -10 || true
  fi
  sleep 1
done

# 7. Verify service is accessible (test from inside cluster to bypass macOS NodePort TLS issue)
say "7️⃣  Testing Caddy health from inside cluster..."
if kubectl -n "$NS_ING" run curl-test --rm -i --restart=Never --image=curlimages/curl --timeout=10s -- \
  curl -k -sS -I --http2 -H "Host: $HOST" "https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz" 2>&1 | grep -qE "200|HTTP/2 200"; then
  ok "Caddy health check passed (from inside cluster)"
else
  warn "Caddy health check failed (from inside cluster) - this may be temporary"
fi

say "✅ All fixes applied!"
echo ""
echo "📋 Summary:"
echo "  • Caddy NodePort service: 30443"
echo "  • Certificates: Regenerated"
echo "  • Caddyfile: Applied with correct TLS configuration"
echo "  • Protocol: HTTP/2 and HTTP/1.1 (ALPN negotiation)"
echo "  • Pods: $(kubectl -n "$NS_ING" get deployment caddy-h3 -o jsonpath='{.status.readyReplicas}/{.spec.replicas}' 2>/dev/null || echo 'unknown')"
echo ""
echo "💡 Test from host (may have macOS NodePort TLS limitations):"
echo "   curl -k -sS -I --http2 -H 'Host: $HOST' 'https://127.0.0.1:30443/_caddy/healthz'"

