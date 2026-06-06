#!/usr/bin/env bash
set -euo pipefail

# Verify all prerequisites for CA rotation test

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "Verifying CA Rotation Test Prerequisites..."

# 1. Check mkcert
if ! command -v mkcert >/dev/null 2>&1; then
  fail "mkcert not found. Install with: brew install mkcert && mkcert -install"
  exit 1
fi
CA_PATH="$(mkcert -CAROOT 2>/dev/null)/rootCA.pem"
if [[ ! -f "$CA_PATH" ]]; then
  fail "mkcert CA not found at $CA_PATH. Run: mkcert -install"
  exit 1
fi
ok "mkcert installed and CA found"

# 2. Check Caddy pods
CADDY_READY=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 --no-headers 2>/dev/null | grep -c "Running" || echo "0")
CADDY_TOTAL=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [[ "$CADDY_READY" -ge 1 ]] && [[ "$CADDY_TOTAL" -ge 1 ]]; then
  ok "Caddy pods: $CADDY_READY/$CADDY_TOTAL ready"
else
  fail "Caddy pods not ready: $CADDY_READY/$CADDY_TOTAL"
  exit 1
fi

# 3. Check Caddy service
CADDY_NODEPORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
if [[ -n "$CADDY_NODEPORT" ]]; then
  ok "Caddy NodePort: $CADDY_NODEPORT"
else
  fail "Caddy NodePort not found"
  exit 1
fi

# 4. Test Caddy health via port-forward
say "Testing Caddy health via port-forward..."
PORT_FORWARD_PID=""
kubectl -n ingress-nginx port-forward svc/caddy-h3 8443:443 >/dev/null 2>&1 &
PORT_FORWARD_PID=$!
sleep 2
if kill -0 "$PORT_FORWARD_PID" 2>/dev/null; then
  HEALTH_RESPONSE=$(curl -k -sS -I --http2 -H "Host: record.local" "https://127.0.0.1:8443/_caddy/healthz" 2>&1 | head -1 || echo "")
  kill "$PORT_FORWARD_PID" 2>/dev/null || true
  wait "$PORT_FORWARD_PID" 2>/dev/null || true
  if echo "$HEALTH_RESPONSE" | grep -qE "200|HTTP/2 200"; then
    ok "Caddy health check passed via port-forward"
  else
    warn "Caddy health check failed: $HEALTH_RESPONSE"
  fi
else
  warn "Port-forward failed to start"
fi

# 5. Check TLS secrets
if kubectl -n ingress-nginx get secret record-local-tls >/dev/null 2>&1; then
  ok "TLS secret exists in ingress-nginx namespace"
else
  warn "TLS secret missing in ingress-nginx namespace"
fi

if kubectl -n record-platform get secret record-local-tls >/dev/null 2>&1; then
  ok "TLS secret exists in record-platform namespace"
else
  warn "TLS secret missing in record-platform namespace"
fi

if kubectl -n ingress-nginx get secret dev-root-ca >/dev/null 2>&1; then
  ok "CA secret exists"
else
  warn "CA secret missing"
fi

# 6. Check curl binary
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
if [[ -f "$CURL_BIN" ]] && "$CURL_BIN" --version | grep -q "http2"; then
  ok "curl with HTTP/2 support found at $CURL_BIN"
else
  warn "curl with HTTP/2 support not found at $CURL_BIN"
fi

say "Prerequisites check complete!"

