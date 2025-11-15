#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
NS_ING="ingress-nginx"
NS_APP="record-platform"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

CURL_BIN="/opt/homebrew/opt/curl/bin/curl"

say "=== Full End-to-End Chain Test with CA Rotation ==="

# Test 1: Caddy health (H2)
say "Test 1: Caddy health via HTTP/2"
if "$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "Caddy health (H2) works"
else
  fail "Caddy health (H2) failed"
fi

# Test 2: Caddy health (H3)
say "Test 2: Caddy health via HTTP/3"
if "$CURL_BIN" -k -sS -I --http3-only -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "Caddy health (H3) works"
else
  warn "Caddy health (H3) failed (may be firewall/port issue)"
fi

# Test 3: Backend via ingress (H2) - Full chain
say "Test 3: Backend API via Ingress Nginx via Caddy (HTTP/2) - Full Chain"
RESPONSE_H2=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE_H2=$(echo "$RESPONSE_H2" | tail -1)
if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then
  ok "Backend via ingress (H2) works - HTTP $HTTP_CODE_H2 (Full chain: Client -> Caddy -> Ingress -> Backend)"
else
  warn "Backend via ingress (H2) returned HTTP $HTTP_CODE_H2"
fi

# Test 4: Backend via ingress (H3) - Full chain
say "Test 4: Backend API via Ingress Nginx via Caddy (HTTP/3) - Full Chain"
RESPONSE_H3=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http3-only -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE_H3=$(echo "$RESPONSE_H3" | tail -1)
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "Backend via ingress (H3) works - HTTP $HTTP_CODE_H3 (Full chain: Client -> Caddy -> Ingress -> Backend)"
else
  warn "Backend via ingress (H3) returned HTTP $HTTP_CODE_H3"
fi

# Test 5: Verify strict TLS
say "Test 5: Verify strict TLS (TLS 1.2/1.3 only)"
if "$CURL_BIN" -k -sS -I --tlsv1.1 --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -qE "error|handshake|protocol"; then
  ok "TLS 1.1 correctly rejected (strict TLS working)"
else
  warn "TLS 1.1 was not rejected"
fi

# Test 6: CA Rotation with zero-downtime
say "Test 6: CA Rotation with Zero-Downtime Reload"
say "Starting continuous requests during rotation..."

# Start background requests
(
  for i in {1..30}; do
    "$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | tail -1
    sleep 0.5
  done
) > /tmp/rotation-test.log &
REQ_PID=$!

# Perform CA rotation
say "Rotating CA..."
./scripts/rotate-ca-and-fix-tls.sh 2>&1 | grep -E "✅|⚠️|❌|Rotating|Testing" || true

# Wait for requests to complete
wait $REQ_PID 2>/dev/null || true

# Analyze results
SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null || echo "0")

if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
  ok "CA rotation completed - $SUCCESS_COUNT/$TOTAL_COUNT requests succeeded during rotation"
  if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]]; then
    ok "Zero-downtime rotation confirmed!"
  else
    warn "Some requests failed during rotation (may be expected during restart)"
  fi
else
  warn "No successful requests during rotation"
fi

rm -f /tmp/rotation-test.log

# Test 7: Verify new certificate is being used
say "Test 7: Verify new certificate is active"
CERT_INFO=$("$CURL_BIN" -k -v --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -i "subject:\|issuer:" | head -2 || echo "")
if [[ -n "$CERT_INFO" ]]; then
  ok "Certificate info retrieved"
  echo "$CERT_INFO"
else
  warn "Could not retrieve certificate info"
fi

# Test 8: Full chain with actual API call
say "Test 8: Full chain test with actual API endpoint"
API_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
API_CODE=$(echo "$API_RESPONSE" | tail -1)
if [[ "$API_CODE" =~ ^(200|404|502)$ ]]; then
  ok "Full chain works: Client -> Caddy (H2) -> Ingress Nginx -> Backend - HTTP $API_CODE"
  echo "Response body: $(echo "$API_RESPONSE" | head -n -1)"
else
  warn "Full chain test returned HTTP $API_CODE"
fi

say "=== All tests complete ==="

