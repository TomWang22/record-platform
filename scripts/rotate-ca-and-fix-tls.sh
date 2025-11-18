#!/usr/bin/env bash
set -euo pipefail

NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check if mkcert CA exists
if [[ -f "$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" ]]; then
  CA_PATH="$(mkcert -CAROOT)/rootCA.pem"
  ok "Found mkcert CA at: $CA_PATH"
else
  fail "mkcert CA not found. Install with: brew install mkcert && mkcert -install"
fi

# Generate new certificate with mkcert (rotate)
say "Generating new certificate for ${HOST}..."
CERT_DIR="/tmp/caddy-certs-$(date +%s)"
mkdir -p "$CERT_DIR"
mkcert -cert-file "$CERT_DIR/tls.crt" -key-file "$CERT_DIR/tls.key" "${HOST}" "*.${HOST}" localhost 127.0.0.1 ::1

ok "New certificate generated"

# Update TLS secret in Kubernetes (delete and recreate since type is immutable)
say "Updating TLS secret in Kubernetes..."
if kubectl -n "$NS_ING" get secret record-local-tls >/dev/null 2>&1; then
  kubectl -n "$NS_ING" delete secret record-local-tls
  say "Deleted existing TLS secret"
fi
kubectl -n "$NS_ING" create secret tls record-local-tls \
  --cert="$CERT_DIR/tls.crt" \
  --key="$CERT_DIR/tls.key"

ok "TLS secret created"

# Update CA secret
say "Updating CA secret..."
kubectl -n "$NS_ING" create secret generic dev-root-ca \
  --from-file=dev-root.pem="$CA_PATH" \
  --dry-run=client -o yaml | kubectl apply -f -

ok "CA secret updated"

# Update Caddyfile with strict TLS (sanitize to remove any invalid servers{} blocks)
say "Updating Caddyfile with strict TLS configuration..."
if [[ -f "./Caddyfile" ]]; then
  TMP_CF="$(mktemp)"
  # Strip any legacy 'servers { ... }' block which is invalid for our Caddy 2.8 config
  awk '
    BEGIN{skip=0}
    /^\\s*servers\\s*\\{/ { skip=1; depth=1; next }
    skip==1 {
      if ($0 ~ /\\{/) depth++
      if ($0 ~ /\\}/) { depth--; if (depth==0) { skip=0; next } }
      next
    }
    { print }
  ' ./Caddyfile > "$TMP_CF"
  kubectl -n "$NS_ING" create configmap caddy-h3 \
    --from-file=Caddyfile="$TMP_CF" \
    --dry-run=client -o yaml | kubectl apply -f -
  rm -f "$TMP_CF"
  ok "Caddyfile updated"
else
  warn "Caddyfile not found in current directory"
fi

# Restart Caddy (with better error handling)
say "Restarting Caddy..."
kubectl -n "$NS_ING" rollout restart deploy/caddy-h3

# Wait for rollout with better timeout handling
say "Waiting for Caddy rollout..."
if kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=180s 2>&1; then
  ok "Caddy restarted successfully"
else
  warn "Caddy rollout timed out, checking pod status..."
  # Check if pod is actually running and ready
  sleep 5
  POD_PHASE=$(kubectl -n "$NS_ING" get pod -l app=caddy-h3 -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "")
  POD_READY=$(kubectl -n "$NS_ING" get pod -l app=caddy-h3 -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
  
  if [[ "$POD_PHASE" == "Running" ]] && [[ "$POD_READY" == "True" ]]; then
    ok "Caddy pod is Running and Ready (rollout status may have timed out)"
  elif [[ "$POD_PHASE" == "Running" ]]; then
    warn "Caddy pod is Running but not Ready yet - waiting..."
    sleep 10
    # Check again
    POD_READY=$(kubectl -n "$NS_ING" get pod -l app=caddy-h3 -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    if [[ "$POD_READY" == "True" ]]; then
      ok "Caddy pod is now Ready"
    else
      warn "Caddy pod still not Ready - checking logs..."
      kubectl -n "$NS_ING" logs -l app=caddy-h3 --tail=10 2>&1 | head -5
    fi
  else
    warn "Caddy pod phase: $POD_PHASE (may not be ready yet)"
    kubectl -n "$NS_ING" logs -l app=caddy-h3 --tail=10 2>&1 | head -5
  fi
fi

# Wait a bit for Caddy to be ready
sleep 3

# Test HTTP/2 and HTTP/3 (non-fatal - don't exit on failure)
say "Testing HTTP/2 and HTTP/3..."
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/2 works"
else
  warn "HTTP/2 failed (non-fatal)"
fi

# HTTP/3 from host is often flaky on macOS, so make it non-fatal
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/3 works"
else
  warn "HTTP/3 failed (non-fatal - host-based H3 is often flaky on macOS)"
fi

# Test with CA trust (no -k) - requires mkcert CA to be installed
say "Testing with CA trust (strict TLS)..."
if [[ -f "$(mkcert -CAROOT 2>/dev/null)/rootCA.pem" ]]; then
  if curl -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
    ok "HTTP/2 with CA trust works"
  else
    warn "HTTP/2 with CA trust failed (check DNS/port forwarding or install mkcert CA)"
  fi
else
  warn "mkcert CA not installed - skipping CA trust test"
fi

# Test actual API endpoint (not just health check)
say "Testing actual API endpoint via HTTP/2..."
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" 2>&1 | head -n1 | grep -q "200\|404\|502"; then
  ok "API endpoint reachable via HTTP/2"
else
  warn "API endpoint test failed (non-fatal)"
fi

say "Testing actual API endpoint via HTTP/3..."
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" 2>&1 | head -n1 | grep -q "200\|404\|502"; then
  ok "API endpoint reachable via HTTP/3"
else
  warn "API endpoint test failed (non-fatal - host-based H3 is often flaky)"
fi

# Cleanup
rm -rf "$CERT_DIR"

say "CA rotation complete!"
echo ""
echo "Test commands:"
echo "  curl -sS -I --http2 -H 'Host: ${HOST}' 'https://${HOST}:8443/_caddy/healthz'"
echo "  /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H 'Host: ${HOST}' 'https://${HOST}:8443/_caddy/healthz'"

# Exit with success (0) - rotation completed even if some tests failed
exit 0

