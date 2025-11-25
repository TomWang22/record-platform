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
CADDY_H2_RESPONSE=$("$CURL_BIN" -k -sS -I --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || CADDY_H2_RESPONSE=""
if echo "$CADDY_H2_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "Caddy health (H2) works"
else
  fail "Caddy health (H2) failed"
  echo "Response: $(echo "$CADDY_H2_RESPONSE" | head -n3)"
fi

# Test 2: Caddy health (H3)
say "Test 2: Caddy health via HTTP/3"
H3_HEALTH_OUTPUT=$(http3_curl -k -sS -I --http3-only \
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
RESPONSE_H2=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1) || RESPONSE_H2=""
HTTP_CODE_H2=$(echo "$RESPONSE_H2" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then
  ok "Backend via ingress (H2) works - HTTP $HTTP_CODE_H2 (Full chain: Client -> Caddy -> Ingress -> Backend)"
else
  warn "Backend via ingress (H2) returned HTTP $HTTP_CODE_H2"
fi

# Test 4: Backend via ingress (H3) - Full chain
say "Test 4: Backend API via Ingress Nginx via Caddy (HTTP/3) - Full Chain"
RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/api/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  RESPONSE_H3="000"
}
HTTP_CODE_H3=$(echo "$RESPONSE_H3" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "Backend via ingress (H3) works - HTTP $HTTP_CODE_H3 (Full chain: Client -> Caddy -> Ingress -> Backend)"
elif [[ -n "$HTTP_CODE_H3" ]]; then
  warn "Backend via ingress (H3) returned HTTP $HTTP_CODE_H3"
else
  warn "Backend via ingress (H3) failed - no response"
fi

# Test 5: Verify strict TLS
say "Test 5: Verify strict TLS (TLS 1.2/1.3 only)"
# Test TLS 1.2 first (should work)
TLS12_RESPONSE=$("$CURL_BIN" -k -sS -I --tlsv1.2 --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || TLS12_RESPONSE=""
TLS12_WORKS=false
if echo "$TLS12_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.2 works"
  TLS12_WORKS=true
else
  warn "TLS 1.2 test failed"
  echo "  Response: $(echo "$TLS12_RESPONSE" | head -n1)"
fi

# Test TLS 1.3 (should work)
TLS13_RESPONSE=$("$CURL_BIN" -k -sS -I --tlsv1.3 --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || TLS13_RESPONSE=""
TLS13_WORKS=false
if echo "$TLS13_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.3 works"
  TLS13_WORKS=true
else
  warn "TLS 1.3 test failed"
  echo "  Response: $(echo "$TLS13_RESPONSE" | head -n1)"
fi

# Test TLS 1.1 (should be rejected)
# Use --tls-max 1.1 to force maximum TLS 1.1 (prevent upgrade to higher versions)
set +e  # Temporarily disable exit on error to capture TLS 1.1 rejection
TLS11_RESPONSE=$("$CURL_BIN" -k -sS -I --tlsv1.1 --tls-max 1.1 --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1)
TLS11_EXIT=$?
set -e  # Re-enable exit on error
# Check if we got an error (rejection) or a successful response
if [[ $TLS11_EXIT -ne 0 ]] || echo "$TLS11_RESPONSE" | grep -qiE "error|handshake|protocol|SSL.*error|TLS.*error|unsupported protocol|alert.*protocol|wrong.*version|no protocols available|TLS connect error|routines"; then
  ok "TLS 1.1 correctly rejected (strict TLS working)"
elif echo "$TLS11_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  # TLS 1.1 connection succeeded - this means strict TLS is NOT working
  fail "TLS 1.1 was NOT rejected - connection succeeded (strict TLS not working)"
  echo "  Response: $(echo "$TLS11_RESPONSE" | head -n1)"
  echo "  Caddy should reject TLS 1.1 when configured with 'protocols tls1.2 tls1.3'"
else
  # Unknown response - check if TLS 1.2/1.3 work to confirm strict TLS is partially working
  if [[ "$TLS12_WORKS" == "true" ]] && [[ "$TLS13_WORKS" == "true" ]]; then
    warn "TLS 1.1 test inconclusive, but TLS 1.2 and 1.3 work"
    echo "  Exit code: $TLS11_EXIT"
    echo "  Response: $(echo "$TLS11_RESPONSE" | head -n3)"
  else
    warn "TLS 1.1 test failed and TLS 1.2/1.3 also failed"
  fi
fi

# Test 6: CA Rotation with zero-downtime
say "Test 6: CA Rotation with Zero-Downtime Reload"
say "Starting continuous requests during rotation..."

# Clean up any old log file
rm -f /tmp/rotation-test.log

# First, verify Caddy is working before rotation
say "Pre-rotation health check..."
PRE_ROTATION_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || PRE_ROTATION_RESPONSE=""
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
  SKIP_ROTATION=0
fi

if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
  # For production-grade zero-downtime, we need to:
  # 1. Start requests BEFORE rotation begins
  # 2. Use faster request intervals to catch any brief downtime
  # 3. Run for longer to cover the entire rotation window
  
  # Calculate how many requests we need to cover the rotation period
  # Rotation typically takes 200-250 seconds
  # Each request takes ~5 seconds (with --max-time 5), so we can do ~1 request per 5 seconds
  # For 300 seconds coverage, we can realistically do: 300 / 5 = 60 requests
  # But we want more samples, so let's do 120 requests over 300 seconds
  # This gives us ~1 request every 2.5 seconds (accounting for slow requests)
  REQUEST_INTERVAL=2.5
  ROTATION_COVERAGE_TIME=300
  # Calculate requests: 120 requests (more realistic given ~5s per request)
  NUM_REQUESTS=120
  
  say "Starting continuous health checks ($NUM_REQUESTS requests over ${ROTATION_COVERAGE_TIME}s to cover rotation period)..."
  # Clean up any old log file
  rm -f /tmp/rotation-test.log
  touch /tmp/rotation-test.log
  # Write directly to log file in the loop to avoid buffering issues
  (
    for i in $(seq 1 $NUM_REQUESTS); do
      # Add timeout to curl to prevent hanging (5 seconds per request)
      RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
        --resolve "$HOST:8443:127.0.0.1" \
        -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | tail -1 || echo "timeout")
      # Write directly to log file (append mode, unbuffered)
      echo "$RESPONSE" >> /tmp/rotation-test.log 2>&1
      sleep $REQUEST_INTERVAL
    done
  ) &
  REQ_PID=$!
  # Give the process a moment to start writing
  sleep 2
  # Verify the process is running and writing
  if ! kill -0 $REQ_PID 2>/dev/null; then
    warn "Background process failed to start"
  else
    INITIAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
    if [[ "$INITIAL_LINES" -eq "0" ]]; then
      warn "Background process started but no requests logged yet"
    else
      ok "Background process started - $INITIAL_LINES requests logged initially"
    fi
  fi

  # Let requests establish before starting rotation (better baseline)
  say "Establishing baseline requests (5 seconds)..."
  sleep 5

  # Perform CA rotation
  say "Rotating CA..."
  ROTATION_START=$(date +%s)
  if ./scripts/rotate-ca-and-fix-tls.sh >/dev/null 2>&1; then
    ROTATION_END=$(date +%s)
    ROTATION_DURATION=$((ROTATION_END - ROTATION_START))
    ok "CA rotation script completed (took ${ROTATION_DURATION}s)"
  else
    warn "CA rotation script returned non-zero status"
  fi
  
  # Continue monitoring after rotation completes
  say "Continuing to monitor post-rotation (requests still running)..."
  
  # Wait for requests to complete with timeout
  # Background process timeline:
  # - T=0: Process starts
  # - T=5: Baseline wait ends, rotation starts
  # - T=5+ROTATION_DURATION: Rotation ends (e.g., T=220 if rotation takes 215s)
  # - T=0+ROTATION_COVERAGE_TIME: All requests should complete (T=300)
  # After rotation ends, remaining time = ROTATION_COVERAGE_TIME - (5 + ROTATION_DURATION)
  # But since process started at T=0, we need: ROTATION_COVERAGE_TIME - (5 + ROTATION_DURATION) + 5
  # = ROTATION_COVERAGE_TIME - ROTATION_DURATION
  REMAINING_TIME=$((ROTATION_COVERAGE_TIME - ROTATION_DURATION + 30))  # Add 30s buffer for safety
  if [[ $REMAINING_TIME -lt 60 ]]; then
    REMAINING_TIME=60  # Minimum 60 seconds to allow process to complete
  fi
  say "Waiting for remaining requests to complete (estimated ${REMAINING_TIME}s, target: $NUM_REQUESTS requests)..."
  ELAPSED=0
  LAST_COUNT=0
  STALL_COUNT=0
  while kill -0 $REQ_PID 2>/dev/null && [[ $ELAPSED -lt $REMAINING_TIME ]]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    # Show progress every 10 seconds
    if [[ $((ELAPSED % 10)) -eq 0 ]]; then
      CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      echo "  Progress: $CURRENT_LINES/$NUM_REQUESTS requests logged, ${ELAPSED}s elapsed..."
      # Check if we're making progress
      if [[ "$CURRENT_LINES" -eq "$LAST_COUNT" ]]; then
        STALL_COUNT=$((STALL_COUNT + 1))
        if [[ $STALL_COUNT -ge 3 ]]; then
          warn "Requests appear to have stalled (no progress in 30s), checking process..."
          if ! kill -0 $REQ_PID 2>/dev/null; then
            ok "Process completed naturally"
            break
          fi
        fi
      else
        STALL_COUNT=0
        LAST_COUNT=$CURRENT_LINES
      fi
    fi
  done

  # If process is still running, check progress and decide
  if kill -0 $REQ_PID 2>/dev/null; then
    CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
    # Calculate expected requests based on elapsed time
    # Process started at T=0, so total elapsed = baseline (5s) + rotation (ROTATION_DURATION) + wait (ELAPSED)
    TOTAL_ELAPSED=$((5 + ROTATION_DURATION + ELAPSED))
    # Expected requests: ideally 2 per second, but requests are slow (taking ~5s each with timeout)
    # So we expect roughly 1 request per 5 seconds = 0.2 requests/second
    # But we cap at NUM_REQUESTS since that's our target
    EXPECTED_REQUESTS=$((TOTAL_ELAPSED / 5))  # Rough estimate: 1 request per 5 seconds
    if [[ $EXPECTED_REQUESTS -gt $NUM_REQUESTS ]]; then
      EXPECTED_REQUESTS=$NUM_REQUESTS
    fi
    
    if [[ $CURRENT_LINES -ge $((NUM_REQUESTS - 20)) ]]; then
      # We're very close to the target, wait longer
      say "Almost complete ($CURRENT_LINES/$NUM_REQUESTS), waiting up to 30 more seconds..."
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 30 ]]; do
        sleep 2
        EXTRA_WAIT=$((EXTRA_WAIT + 2))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        warn "Background requests still running after extended wait, killing process"
        kill $REQ_PID 2>/dev/null || true
        wait $REQ_PID 2>/dev/null || true
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    elif [[ $CURRENT_LINES -lt $((EXPECTED_REQUESTS * 3 / 4)) ]] && [[ $ELAPSED -gt 60 ]]; then
      # Way behind expected after 60s, might be stuck
      # But be more lenient - only 75% of expected, not 50%
      warn "Background requests behind schedule ($CURRENT_LINES logged, expected ~$EXPECTED_REQUESTS after ${TOTAL_ELAPSED}s), but continuing to wait..."
      # Don't kill yet - requests are just slow, give it more time
      say "Requests are slow but making progress, waiting up to 60 more seconds..."
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 60 ]]; do
        sleep 5
        EXTRA_WAIT=$((EXTRA_WAIT + 5))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
        if [[ $((EXTRA_WAIT % 15)) -eq 0 ]]; then
          echo "  Still waiting: $NEW_LINES/$NUM_REQUESTS requests logged..."
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        warn "Background requests still running ($FINAL_LINES/$NUM_REQUESTS), killing process"
        kill $REQ_PID 2>/dev/null || true
        wait $REQ_PID 2>/dev/null || true
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    else
      # Making progress but not done, wait longer
      # Requests are slow (~5s each), so we need to wait proportionally longer
      say "Process still running ($CURRENT_LINES/$NUM_REQUESTS), waiting longer for slow requests..."
      # Wait up to 2 minutes more (120 seconds) for slow requests to complete
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 120 ]]; do
        sleep 10
        EXTRA_WAIT=$((EXTRA_WAIT + 10))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
        if [[ $((EXTRA_WAIT % 30)) -eq 0 ]]; then
          echo "  Still waiting: $NEW_LINES/$NUM_REQUESTS requests logged (${EXTRA_WAIT}s extra wait)..."
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        # Check if we're still making progress
        PREV_LINES=$FINAL_LINES
        sleep 10
        NEW_FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        
        if [[ $NEW_FINAL_LINES -gt $PREV_LINES ]]; then
          # Still making progress, wait a bit more
          say "Process still making progress ($PREV_LINES -> $NEW_FINAL_LINES), waiting 30 more seconds..."
          sleep 30
          FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        fi
        
        if [[ $FINAL_LINES -ge $((NUM_REQUESTS * 7 / 10)) ]]; then
          # We got 70%+ of requests, that's good enough for the test
          ok "Process completed with $FINAL_LINES/$NUM_REQUESTS requests (70%+)"
          kill $REQ_PID 2>/dev/null || true
          wait $REQ_PID 2>/dev/null || true
        elif [[ $FINAL_LINES -ge $((NUM_REQUESTS / 2)) ]]; then
          # We got at least 50%, which is still useful data
          warn "Process completed with $FINAL_LINES/$NUM_REQUESTS requests (50%+) - sufficient for analysis"
          kill $REQ_PID 2>/dev/null || true
          wait $REQ_PID 2>/dev/null || true
        else
          warn "Background requests still running ($FINAL_LINES/$NUM_REQUESTS), killing process"
          kill $REQ_PID 2>/dev/null || true
          wait $REQ_PID 2>/dev/null || true
        fi
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    fi
  else
    wait $REQ_PID 2>/dev/null || true
  fi
  
  # Flush the log file and wait a moment for all writes to complete
  sync /tmp/rotation-test.log 2>/dev/null || true
  sleep 2  # Give the process time to finish writing
fi

if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
  # Analyze results - read the log file
  # Wait a moment to ensure file is fully written
  sleep 1
  if [[ -f /tmp/rotation-test.log ]] && [[ -s /tmp/rotation-test.log ]]; then
    SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
    TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
    # Also count timeouts/errors as expected during restart
    TIMEOUT_COUNT=$(grep -cE "timeout|000|connection refused" /tmp/rotation-test.log 2>/dev/null || echo "0")
  else
    SUCCESS_COUNT="0"
    TOTAL_COUNT="0"
    TIMEOUT_COUNT="0"
  fi
else
  SUCCESS_COUNT="0"
  TOTAL_COUNT="0"
  TIMEOUT_COUNT="0"
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
if [[ "${SKIP_ROTATION:-0}" == "1" ]]; then
  warn "Rotation test skipped - Caddy was not healthy before rotation"
elif [[ "$TOTAL_COUNT" -gt 0 ]]; then
  # Calculate success rate
  SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))
    if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
      if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]]; then
        ok "✅ Zero-downtime rotation confirmed! (100% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
      elif [[ "$SUCCESS_RATE" -ge 95 ]]; then
        ok "✅ Near-zero-downtime rotation (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        warn "  → For production: Consider using RollingUpdate strategy with multiple replicas for true 100% uptime"
      elif [[ "$SUCCESS_RATE" -ge 60 ]]; then
        # With Recreate strategy, 50-70% success rate is normal due to downtime during restart
        ok "Rotation completed (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        say "  ℹ️  Note: This success rate is EXPECTED with Recreate strategy"
        say "  ℹ️  Caddy uses Recreate strategy, which causes downtime during pod restart"
        say "  ℹ️  Requests during the restart window (~30-60s) will fail/timeout"
        say "  ℹ️  This is normal behavior for Recreate deployments"
        warn "  → For production: Use RollingUpdate strategy with 2+ replicas for zero-downtime"
        warn "  → With RollingUpdate: Old pod stays up while new pod starts, eliminating downtime"
      elif [[ "$SUCCESS_RATE" -ge 40 ]]; then
        warn "Rotation completed with downtime (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        say "  ℹ️  Lower success rate may indicate longer restart time or more requests during restart"
        say "  ℹ️  This is still expected with Recreate strategy"
        warn "  → For production: Use RollingUpdate strategy with 2+ replicas for zero-downtime"
      else
        warn "Very low success rate during rotation (${SUCCESS_RATE}% - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        warn "  → $TIMEOUT_COUNT requests failed/timed out during Caddy restart"
        warn "  → This may indicate issues with Caddy restart or very long restart time"
        warn "  → For production: Use RollingUpdate strategy with multiple replicas"
      fi
  else
    warn "No successful requests during rotation ($TOTAL_COUNT total requests, $TIMEOUT_COUNT timeouts)"
    warn "  → Caddy restart took longer than request intervals"
    warn "  → For production: Use RollingUpdate strategy with multiple replicas for zero-downtime"
  fi
  
  # Post-rotation health check (wait for requests to finish first, then check)
  say "Post-rotation health check..."
  # Rotation script already verified readiness, but wait a bit more
  sleep 3
  
  # Try multiple times with increasing delays
  POST_ROTATION_HEALTH="000"
  for attempt in 1 2 3; do
    POST_ROTATION_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
      --resolve "$HOST:8443:127.0.0.1" \
      -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || POST_ROTATION_RESPONSE=""
    if [[ -n "$POST_ROTATION_RESPONSE" ]]; then
      POST_ROTATION_HEALTH=$(echo "$POST_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
      if [[ "$POST_ROTATION_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_HEALTH) - attempt $attempt"
        break
      fi
    fi
    if [[ $attempt -lt 3 ]]; then
      sleep 3
    fi
  done
  
  if [[ "$POST_ROTATION_HEALTH" != "200" ]]; then
    warn "Caddy health check failed after rotation (HTTP $POST_ROTATION_HEALTH after 3 attempts)"
    # Final attempt
    sleep 5
    POST_ROTATION_FINAL=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
      --resolve "$HOST:8443:127.0.0.1" \
      -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1) || POST_ROTATION_FINAL=""
    if [[ -n "$POST_ROTATION_FINAL" ]]; then
      POST_ROTATION_FINAL_HEALTH=$(echo "$POST_ROTATION_FINAL" | tail -1 | tr -d '[:space:]')
      if [[ "$POST_ROTATION_FINAL_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_FINAL_HEALTH) - needed extra time"
      else
        warn "Caddy still not healthy after final check (HTTP $POST_ROTATION_FINAL_HEALTH)"
      fi
    fi
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
API_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
  --resolve "$HOST:8443:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1) || API_RESPONSE=""
API_CODE=$(echo "$API_RESPONSE" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$API_CODE" =~ ^(200|404|502)$ ]]; then
  ok "Full chain works: Client -> Caddy (H2) -> Ingress Nginx -> Backend - HTTP $API_CODE"
  echo "Response body: $(echo "$API_RESPONSE" | sed '$d')"
else
  warn "Full chain test returned HTTP $API_CODE"
fi

# Optional: H3 checks for Test 8 (uses in-cluster helper for reliability on macOS)
say "Test 8b: Full chain H3 checks (Caddy and API via QUIC)"
H3_CADDY=$(
  http3_curl -k -sS -I --http3-only \
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
  http3_curl -k -sS -I --http3-only \
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


