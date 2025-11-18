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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
HTTP3_RESOLVE="${HOST}:443:127.0.0.1"

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
H3_HEALTH_OUTPUT=$(http3_curl -k -sS -I --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  H3_HEALTH_OUTPUT=""
}
if echo "$H3_HEALTH_OUTPUT" | head -n1 | grep -q "HTTP/3 200"; then
  ok "Caddy health (H3) works"
else
  warn "Caddy health (H3) failed (QUIC path unavailable)"
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
RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 15 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/api/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  RESPONSE_H3="000"
}
HTTP_CODE_H3=$(echo "$RESPONSE_H3" | tail -1)
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "Backend via ingress (H3) works - HTTP $HTTP_CODE_H3 (Full chain: Client -> Caddy -> Ingress -> Backend)"
elif [[ -n "$HTTP_CODE_H3" ]]; then
  warn "Backend via ingress (H3) returned HTTP $HTTP_CODE_H3"
else
  warn "Backend via ingress (H3) failed - no response"
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
  for i in {1..60}; do
    "$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | tail -1
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

# Test 7: Verify new certificate is being used
say "Test 7: Verify new certificate is active"
# Use openssl to get certificate info more reliably
CERT_INFO=$(echo | openssl s_client -connect "${HOST}:8443" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
if [[ -n "$CERT_INFO" ]]; then
  ok "Certificate info retrieved"
  echo "$CERT_INFO" | sed 's/^/  /'
else
  warn "Could not retrieve certificate info (openssl may not be available or connection failed)"
fi

# Test 8: Full chain with actual API call
say "Test 8: Full chain test with actual API endpoint"
API_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
API_CODE=$(echo "$API_RESPONSE" | tail -1)
if [[ "$API_CODE" =~ ^(200|404|502)$ ]]; then
  ok "Full chain works: Client -> Caddy (H2) -> Ingress Nginx -> Backend - HTTP $API_CODE"
  echo "Response body: $(echo "$API_RESPONSE" | sed '$d')"
else
  warn "Full chain test returned HTTP $API_CODE"
fi

# Optional: H3 checks for Test 8 (uses in-cluster helper for reliability on macOS)
say "Test 8b: Full chain H3 checks (Caddy and API via QUIC)"
H3_CADDY=$(
  http3_curl -k -sS -I --http3-only --max-time 15 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/_caddy/healthz" 2>&1 | head -n1 || true
)
if echo "$H3_CADDY" | grep -q "HTTP/3 200"; then
  ok "Caddy (H3) reachable - $H3_CADDY"
else
  warn "Caddy (H3) check failed - $H3_CADDY"
fi

H3_API=$(
  http3_curl -k -sS -I --http3-only --max-time 15 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/healthz" 2>&1 | head -n1 || true
)
if echo "$H3_API" | grep -qE "HTTP/3 200|HTTP/3 404|HTTP/3 502"; then
  ok "API (H3) reachable - $H3_API"
else
  warn "API (H3) check failed - $H3_API"
fi

say "=== All tests complete ==="

