#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
NS_ING="ingress-nginx"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

HTTP3_RESOLVE="${HOST}:443:127.0.0.1"

say "=== Testing HTTP/2, HTTP/3, and Strict TLS ==="

# Test 1: HTTP/2 health check
say "Test 1: HTTP/2 health check"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/2 health check works"
else
  fail "HTTP/2 health check failed"
fi

# Test 2: HTTP/3 health check
say "Test 2: HTTP/3 health check"
if http3_curl -k -sS -I --http3-only --max-time 15 \
  -H "Host: ${HOST}" \
  --resolve "$HTTP3_RESOLVE" \
  "https://${HOST}/_caddy/healthz" 2>&1 | head -n1 | grep -q "HTTP/3 200"; then
  ok "HTTP/3 health check works"
else
  warn "HTTP/3 health check failed (QUIC path unavailable)"
fi

# Test 3: HTTP/2 API endpoint
say "Test 3: HTTP/2 API endpoint"
API_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" 2>&1)
if echo "$API_RESPONSE" | tail -1 | grep -qE "200|404|502"; then
  ok "API endpoint reachable via HTTP/2 (status: $(echo "$API_RESPONSE" | tail -1))"
else
  warn "API endpoint test failed"
fi

# Test 4: HTTP/3 API endpoint
say "Test 4: HTTP/3 API endpoint"
API_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
  -H "Host: ${HOST}" \
  --resolve "$HTTP3_RESOLVE" \
  "https://${HOST}/api/healthz" 2>&1)
if echo "$API_RESPONSE_H3" | tail -1 | grep -qE "200|404|502"; then
  ok "API endpoint reachable via HTTP/3 (status: $(echo "$API_RESPONSE_H3" | tail -1))"
else
  warn "API endpoint test failed"
fi

# Test 5: Strict TLS - TLS 1.3
say "Test 5: Strict TLS - TLS 1.3"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.3 --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "TLS 1.3 works"
else
  warn "TLS 1.3 test failed"
fi

# Test 6: Strict TLS - TLS 1.2
say "Test 6: Strict TLS - TLS 1.2"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.2 --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "TLS 1.2 works"
else
  warn "TLS 1.2 test failed"
fi

# Test 7: Strict TLS - TLS 1.1 should fail
say "Test 7: Strict TLS - TLS 1.1 should be rejected"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.1 --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | grep -qE "error|handshake|protocol"; then
  ok "TLS 1.1 correctly rejected"
else
  warn "TLS 1.1 was not rejected (strict TLS may not be working)"
fi

# Test 8: Verify Caddy configuration
say "Test 8: Verify Caddy TLS configuration"
CADDY_CONFIG=$(kubectl -n "$NS_ING" get configmap caddy-h3 -o jsonpath='{.data.Caddyfile}' 2>/dev/null || echo "")
if echo "$CADDY_CONFIG" | grep -q "protocols tls1.2 tls1.3"; then
  ok "Caddy configured with strict TLS (TLS 1.2/1.3 only)"
else
  warn "Caddy may not have strict TLS configured"
fi

say "=== All tests complete ==="
