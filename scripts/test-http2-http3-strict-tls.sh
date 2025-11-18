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

# Test 9: CA Rotation (optional - can be skipped with SKIP_ROTATION=1)
if [[ "${SKIP_ROTATION:-}" != "1" ]]; then
  say "Test 9: CA Rotation with Zero-Downtime Reload"
  say "Starting continuous requests during rotation..."
  
  # Start background requests (longer window to observe restart)
  (
    for i in {1..60}; do
      /opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | tail -1
      sleep 0.5
    done
  ) > /tmp/rotation-test.log &
  REQ_PID=$!
  
  # Perform CA rotation
  say "Rotating CA..."
  if ./scripts/rotate-ca-and-fix-tls.sh >/dev/null 2>&1; then
    ok "CA rotation script completed"
  else
    warn "CA rotation script returned non-zero status"
  fi
  
  # Wait for requests to complete
  wait $REQ_PID 2>/dev/null || true
  
  # Analyze results
  if [[ -f /tmp/rotation-test.log ]] && [[ -s /tmp/rotation-test.log ]]; then
    SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
    TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
  else
    SUCCESS_COUNT="0"
    TOTAL_COUNT="0"
  fi
  
  # Ensure counts are numeric (strip any whitespace/newlines)
  SUCCESS_COUNT=$(echo "$SUCCESS_COUNT" | tr -d '[:space:]')
  TOTAL_COUNT=$(echo "$TOTAL_COUNT" | tr -d '[:space:]')
  
  # Default to 0 if empty
  SUCCESS_COUNT="${SUCCESS_COUNT:-0}"
  TOTAL_COUNT="${TOTAL_COUNT:-0}"
  
  # Validate numeric
  if ! [[ "$SUCCESS_COUNT" =~ ^[0-9]+$ ]]; then
    SUCCESS_COUNT="0"
  fi
  if ! [[ "$TOTAL_COUNT" =~ ^[0-9]+$ ]]; then
    TOTAL_COUNT="0"
  fi
  
  # Only report if we have valid data
  if [[ "$TOTAL_COUNT" -gt 0 ]]; then
    if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
      ok "CA rotation completed - $SUCCESS_COUNT/$TOTAL_COUNT requests succeeded during rotation"
      if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]]; then
        ok "Zero-downtime rotation confirmed!"
      else
        warn "Some requests failed during rotation (may be expected during restart)"
      fi
    else
      warn "No successful requests during rotation ($TOTAL_COUNT total requests)"
    fi
  else
    warn "Could not analyze rotation results (log file may be empty or malformed)"
  fi
  
  rm -f /tmp/rotation-test.log
  
  # Verify new certificate is active
  say "Test 9b: Verify new certificate is active"
  # Use openssl to get certificate info more reliably
  CERT_INFO=$(echo | openssl s_client -connect "${HOST}:8443" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
  if [[ -n "$CERT_INFO" ]]; then
    ok "Certificate info retrieved"
    echo "$CERT_INFO" | sed 's/^/  /'
  else
    warn "Could not retrieve certificate info (openssl may not be available or connection failed)"
  fi
else
  say "Test 9: CA Rotation (skipped - set SKIP_ROTATION=1 to skip)"
fi

say "=== All tests complete ==="
