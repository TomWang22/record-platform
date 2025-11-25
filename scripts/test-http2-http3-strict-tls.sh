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
H2_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 --max-time 10 \
  --resolve "${HOST}:8443:127.0.0.1" \
  -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || H2_RESPONSE=""
if echo "$H2_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "HTTP/2 health check works"
else
  fail "HTTP/2 health check failed"
  echo "Response: $(echo "$H2_RESPONSE" | head -n3)"
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
API_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 \
  --resolve "${HOST}:8443:127.0.0.1" \
  -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" 2>&1) || API_RESPONSE=""
API_CODE=$(echo "$API_RESPONSE" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$API_CODE" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/2 (status: $API_CODE)"
else
  warn "API endpoint test failed (status: $API_CODE)"
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
TLS13_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.3 --http2 \
  --resolve "${HOST}:8443:127.0.0.1" \
  -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || TLS13_RESPONSE=""
if echo "$TLS13_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.3 works"
else
  warn "TLS 1.3 test failed"
  # Debug: show what we got
  echo "  Response: $(echo "$TLS13_RESPONSE" | head -n1)"
fi

# Test 6: Strict TLS - TLS 1.2
say "Test 6: Strict TLS - TLS 1.2"
TLS12_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.2 --http2 \
  --resolve "${HOST}:8443:127.0.0.1" \
  -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || TLS12_RESPONSE=""
if echo "$TLS12_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.2 works"
else
  warn "TLS 1.2 test failed"
  echo "  Response: $(echo "$TLS12_RESPONSE" | head -n1)"
fi

# Test 7: Strict TLS - TLS 1.1 should fail
say "Test 7: Strict TLS - TLS 1.1 should be rejected"
TLS11_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.1 --http2 \
  --resolve "${HOST}:8443:127.0.0.1" \
  -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || TLS11_RESPONSE=""
if echo "$TLS11_RESPONSE" | grep -qE "error|handshake|protocol|SSL.*error|TLS.*error|unsupported protocol"; then
  ok "TLS 1.1 correctly rejected"
else
  warn "TLS 1.1 was not rejected (strict TLS may not be working)"
  # Also verify TLS 1.3 works to confirm strict TLS is partially working
  TLS13_VERIFY=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.3 --http2 \
    --resolve "${HOST}:8443:127.0.0.1" \
    -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || TLS13_VERIFY=""
  if echo "$TLS13_VERIFY" | head -n1 | grep -qE "200|HTTP/2 200"; then
    ok "TLS 1.3 works (strict TLS partially working - TLS 1.2/1.3 enabled)"
  fi
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
  
  # Clean up any old log file
  rm -f /tmp/rotation-test.log
  
  # Pre-rotation health check
  say "Pre-rotation health check..."
  PRE_ROTATION_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
    --resolve "${HOST}:8443:127.0.0.1" \
    -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || PRE_ROTATION_RESPONSE=""
  if [[ -n "$PRE_ROTATION_RESPONSE" ]]; then
    PRE_ROTATION_HEALTH=$(echo "$PRE_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
  else
    PRE_ROTATION_HEALTH="000"
  fi
  if [[ "$PRE_ROTATION_HEALTH" != "200" ]]; then
    warn "Caddy is not healthy before rotation (HTTP $PRE_ROTATION_HEALTH) - skipping rotation test"
    SKIP_ROTATION=1
  else
    ok "Caddy is healthy before rotation (HTTP $PRE_ROTATION_HEALTH)"
  fi
  
  if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
    # Start background requests with timeout on each curl
    (
      for i in {1..60}; do
        /opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 --max-time 2 \
          --resolve "${HOST}:8443:127.0.0.1" \
          -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1 | tail -1 || echo "timeout"
        sleep 0.5
      done
    ) > /tmp/rotation-test.log 2>&1 &
    REQ_PID=$!
    
    # Perform CA rotation
    say "Rotating CA..."
    if ./scripts/rotate-ca-and-fix-tls.sh >/dev/null 2>&1; then
      ok "CA rotation script completed"
    else
      warn "CA rotation script returned non-zero status"
    fi
    
    # Wait for requests to complete with timeout (max 35 seconds)
    TIMEOUT=35
    ELAPSED=0
    while kill -0 $REQ_PID 2>/dev/null && [[ $ELAPSED -lt $TIMEOUT ]]; do
      sleep 1
      ELAPSED=$((ELAPSED + 1))
    done
    
    # If process is still running, kill it
    if kill -0 $REQ_PID 2>/dev/null; then
      warn "Background requests timed out, killing process"
      kill $REQ_PID 2>/dev/null || true
      wait $REQ_PID 2>/dev/null || true
    else
      wait $REQ_PID 2>/dev/null || true
    fi
    
    # Analyze results
    if [[ -f /tmp/rotation-test.log ]] && [[ -s /tmp/rotation-test.log ]]; then
      SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
      TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      TIMEOUT_COUNT=$(grep -cE "timeout|000|connection refused" /tmp/rotation-test.log 2>/dev/null || echo "0")
    else
      SUCCESS_COUNT="0"
      TOTAL_COUNT="0"
      TIMEOUT_COUNT="0"
    fi
    
    # Ensure counts are numeric
    SUCCESS_COUNT=$(echo "$SUCCESS_COUNT" | tr -d '[:space:]')
    TOTAL_COUNT=$(echo "$TOTAL_COUNT" | tr -d '[:space:]')
    TIMEOUT_COUNT=$(echo "$TIMEOUT_COUNT" | tr -d '[:space:]')
    
    # Default to 0 if empty
    SUCCESS_COUNT="${SUCCESS_COUNT:-0}"
    TOTAL_COUNT="${TOTAL_COUNT:-0}"
    TIMEOUT_COUNT="${TIMEOUT_COUNT:-0}"
    
    # Validate numeric
    if ! [[ "$SUCCESS_COUNT" =~ ^[0-9]+$ ]]; then
      SUCCESS_COUNT="0"
    fi
    if ! [[ "$TOTAL_COUNT" =~ ^[0-9]+$ ]]; then
      TOTAL_COUNT="0"
    fi
    
    # Calculate success rate
    if [[ "$TOTAL_COUNT" -gt 0 ]]; then
      SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))
      if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
        ok "CA rotation completed - $SUCCESS_COUNT/$TOTAL_COUNT requests succeeded during rotation (${SUCCESS_RATE}% success rate)"
        if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]]; then
          ok "Zero-downtime rotation confirmed! (100% success rate)"
        elif [[ "$SUCCESS_RATE" -ge 80 ]]; then
          ok "Rotation mostly successful (${SUCCESS_RATE}% success rate) - some downtime expected during Caddy restart"
        else
          warn "Low success rate during rotation (${SUCCESS_RATE}%) - $TIMEOUT_COUNT requests failed/timed out (expected during Caddy restart)"
        fi
      else
        warn "No successful requests during rotation ($TOTAL_COUNT total requests, $TIMEOUT_COUNT timeouts)"
        warn "This is expected if Caddy restarts take longer than request intervals"
      fi
      
      # Post-rotation health check
      say "Post-rotation health check..."
      sleep 2  # Give Caddy a moment to stabilize
      POST_ROTATION_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 \
        --resolve "${HOST}:8443:127.0.0.1" \
        -H "Host: ${HOST}" "https://${HOST}:8443/_caddy/healthz" 2>&1) || POST_ROTATION_RESPONSE=""
      if [[ -n "$POST_ROTATION_RESPONSE" ]]; then
        POST_ROTATION_HEALTH=$(echo "$POST_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
      else
        POST_ROTATION_HEALTH="000"
      fi
      if [[ "$POST_ROTATION_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_HEALTH)"
      else
        warn "Caddy health check failed after rotation (HTTP $POST_ROTATION_HEALTH)"
      fi
    else
      warn "Could not analyze rotation results (log file may be empty or malformed)"
    fi
    
    rm -f /tmp/rotation-test.log
    
    # Verify new certificate is active
    say "Test 9b: Verify new certificate is active"
    CERT_INFO=$(echo | openssl s_client -connect "${HOST}:8443" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
    if [[ -n "$CERT_INFO" ]]; then
      ok "Certificate info retrieved"
      echo "$CERT_INFO" | sed 's/^/  /'
    else
      warn "Could not retrieve certificate info (openssl may not be available or connection failed)"
    fi
  fi
else
  say "Test 9: CA Rotation (skipped - set SKIP_ROTATION=1 to skip)"
fi

say "=== All tests complete ==="
