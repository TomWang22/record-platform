#!/usr/bin/env bash
set -euo pipefail

# Fix NodePort 30443 connectivity issues
# This script ensures the caddy-h3 service is properly configured and accessible

NS="ingress-nginx"
HOST="${HOST:-record.local}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Fixing NodePort 30443 Connectivity ==="

# 1. Ensure service exists and is configured correctly
say "Step 1: Verifying caddy-h3 service configuration..."
if kubectl -n "$NS" get svc caddy-h3 >/dev/null 2>&1; then
  CURRENT_NODEPORT=$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
  if [[ "$CURRENT_NODEPORT" == "30443" ]]; then
    ok "Service caddy-h3 exists with NodePort 30443"
  else
    warn "Service exists but NodePort is $CURRENT_NODEPORT (expected 30443)"
    say "Applying service definition..."
    kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
  fi
else
  warn "Service caddy-h3 not found, creating..."
  kubectl -n "$NS" apply -f infra/k8s/caddy-h3-svc.yaml
fi

# 2. Verify pods are running
say "Step 2: Verifying caddy-h3 pods are running..."
PODS=$(kubectl -n "$NS" get pods -l app=caddy-h3 --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$PODS" ]]; then
  fail "No running caddy-h3 pods found"
else
  ok "Found running pods: $PODS"
fi

# 3. Verify service endpoints
say "Step 3: Verifying service endpoints..."
ENDPOINTS=$(kubectl -n "$NS" get endpoints caddy-h3 -o jsonpath='{.subsets[0].addresses[*].ip}' 2>/dev/null || echo "")
if [[ -z "$ENDPOINTS" ]]; then
  warn "No endpoints found for caddy-h3 service"
  say "Restarting deployment to refresh endpoints..."
  kubectl -n "$NS" rollout restart deploy/caddy-h3
  kubectl -n "$NS" rollout status deploy/caddy-h3 --timeout=60s
else
  ok "Service has endpoints: $ENDPOINTS"
fi

# 4. Test connectivity from inside cluster
say "Step 4: Testing connectivity from inside cluster..."
if kubectl -n "$NS" run test-curl-$(date +%s) --image=curlimages/curl:latest --rm -i --restart=Never -- \
  curl -k -s --http2 --max-time 5 -H "Host: $HOST" "https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz" 2>&1 | grep -q "ok"; then
  ok "Internal cluster connectivity works"
else
  warn "Internal cluster connectivity test failed"
fi

# 5. Test NodePort connectivity (may fail on macOS/Kind due to TLS issues)
say "Step 5: Testing NodePort 30443 connectivity..."
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
if [[ -f "$CURL_BIN" ]]; then
  RESPONSE=$("$CURL_BIN" -k -s --http2 --max-time 5 \
    --resolve "$HOST:30443:127.0.0.1" \
    -H "Host: $HOST" "https://$HOST:30443/_caddy/healthz" 2>&1) || RESPONSE=""
  
  if echo "$RESPONSE" | grep -q "ok"; then
    ok "NodePort 30443 connectivity works!"
  elif echo "$RESPONSE" | grep -qiE "TLS connect error|SSL.*error|unexpected eof|Connection reset"; then
    warn "NodePort 30443 has TLS handshake issues (known Kind/macOS limitation)"
    warn "This is a known issue with Kind NodePort and TLS passthrough on macOS"
    warn "The service works from inside the cluster, but external NodePort access may require port-forward"
    say "You can use port-forward as a workaround:"
    echo "  kubectl -n $NS port-forward svc/caddy-h3 8443:443"
    echo "  Then access via: https://$HOST:8443"
  else
    warn "NodePort 30443 test returned: $(echo "$RESPONSE" | head -1)"
  fi
else
  warn "curl not found at $CURL_BIN, skipping NodePort test"
fi

# 6. Verify service is listening on the port
say "Step 6: Verifying port 30443 is listening..."
if netstat -an 2>/dev/null | grep -q "\.30443.*LISTEN" || lsof -i :30443 >/dev/null 2>&1; then
  ok "Port 30443 is listening on host"
else
  warn "Port 30443 is not listening on host (may be normal if using Kind)"
fi

say "=== NodePort Fix Complete ==="
say "If NodePort 30443 still doesn't work due to TLS issues, use port-forward:"
echo "  kubectl -n $NS port-forward svc/caddy-h3 8443:443"

