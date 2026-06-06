#!/usr/bin/env bash
# Deep investigation of HTTP/3 curl exit 77 issue
# Tests certificate chain from multiple angles

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== Deep Investigation: HTTP/3 curl exit 77 ==="

# Get CA certificate
CA_CERT=""
K8S_CA_ING=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]]; then
  CA_CERT="/tmp/investigate-ca-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
  ok "CA certificate retrieved"
else
  fail "Could not retrieve CA certificate"
  exit 1
fi

# Test 1: Check what Caddy actually serves
say "Test 1: What certificate chain does Caddy actually serve?"
CADDY_POD=$(_kb -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$CADDY_POD" ]]; then
  info "Testing Caddy pod: $CADDY_POD"
  
  # Try to get certificate chain via openssl s_client from inside pod
  # First check if we can exec into pod and test
  info "Attempting to test certificate chain from inside Caddy pod..."
  
  # Get certificate via port-forward and openssl from host
  _kb -n "$NS_ING" port-forward "pod/$CADDY_POD" 8443:443 >/dev/null 2>&1 &
  PF_PID=$!
  sleep 3
  
  if kill -0 "$PF_PID" 2>/dev/null; then
    info "Port-forward established, testing certificate chain..."
    
    # Get full certificate chain
    FULL_CHAIN=$(echo | openssl s_client -connect 127.0.0.1:8443 -servername "$HOST" -showcerts 2>/dev/null || echo "")
    CERT_COUNT=$(echo "$FULL_CHAIN" | grep -c "BEGIN CERTIFICATE" || echo "0")
    info "Certificate chain from server: $CERT_COUNT certificate(s)"
    
    if [[ $CERT_COUNT -ge 2 ]]; then
      ok "Server presents full chain ($CERT_COUNT certificates)"
      
      # Extract leaf and CA
      LEAF_CERT=$(echo "$FULL_CHAIN" | awk '/BEGIN CERTIFICATE/{i++} i==1' RS='-----BEGIN CERTIFICATE-----' | sed '1s/^/-----BEGIN CERTIFICATE-----/' || echo "")
      CA_CERT_SERVED=$(echo "$FULL_CHAIN" | awk '/BEGIN CERTIFICATE/{i++} i==2' RS='-----BEGIN CERTIFICATE-----' | sed '1s/^/-----BEGIN CERTIFICATE-----/' || echo "")
      
      if [[ -n "$LEAF_CERT" ]] && [[ -n "$CA_CERT_SERVED" ]]; then
        # Verify CA matches
        CA_FROM_SERVER=$(echo "$CA_CERT_SERVED" | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || echo "")
        CA_FROM_SECRET=$(openssl x509 -in "$CA_CERT" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || echo "")
        
        if [[ "$CA_FROM_SERVER" == "$CA_FROM_SECRET" ]]; then
          ok "CA certificate in chain matches secret CA"
        else
          fail "CA certificate mismatch!"
          info "  Server CA: ${CA_FROM_SERVER:0:20}..."
          info "  Secret CA: ${CA_FROM_SECRET:0:20}..."
        fi
      fi
    else
      warn "Server only presents $CERT_COUNT certificate(s) - chain incomplete!"
    fi
    
    # Test with openssl verify
    info "Testing certificate verification with openssl..."
    VERIFY_OUTPUT=$(echo "$FULL_CHAIN" | openssl verify -CAfile "$CA_CERT" - 2>&1 || echo "")
    if echo "$VERIFY_OUTPUT" | grep -q "OK"; then
      ok "Certificate chain verifies correctly with openssl"
    else
      fail "Certificate chain verification failed with openssl"
      echo "$VERIFY_OUTPUT"
    fi
    
    kill "$PF_PID" 2>/dev/null || true
    wait "$PF_PID" 2>/dev/null || true
  else
    warn "Port-forward failed"
  fi
else
  fail "Caddy pod not found"
fi

# Test 2: Test HTTP/3 curl with verbose output
say "Test 2: HTTP/3 curl with verbose debugging"
. "$SCRIPT_DIR/lib/http3.sh" 2>/dev/null || true

HTTP3_SVC_IP=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -n "$HTTP3_SVC_IP" ]]; then
  HTTP3_RESOLVE="${HOST}:443:${HTTP3_SVC_IP}"
else
  HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
fi

info "Testing HTTP/3 with full verbose output..."
HTTP3_VERBOSE=$(http3_curl --cacert "$CA_CERT" -v --http3-only --max-time 10 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1) || HTTP3_RC=$?
HTTP3_RC=${HTTP3_RC:-0}

if [[ "$HTTP3_RC" -eq 77 ]]; then
  fail "HTTP/3 curl exit 77 confirmed"
  info "Verbose output:"
  echo "$HTTP3_VERBOSE" | grep -iE "certificate|ssl|tls|error|verify|chain" | head -20
else
  ok "HTTP/3 curl succeeded (exit $HTTP3_RC)"
fi

# Test 3: Compare HTTP/2 vs HTTP/3 certificate handling
say "Test 3: HTTP/2 vs HTTP/3 certificate verification"
info "Testing HTTP/2 with same CA cert..."
HTTP2_TEST=$(curl --cacert "$CA_CERT" -v --http2 --max-time 10 \
  --resolve "$HOST:30443:127.0.0.1" \
  -H "Host: $HOST" \
  "https://$HOST:30443/_caddy/healthz" 2>&1) || HTTP2_RC=$?
HTTP2_RC=${HTTP2_RC:-0}

if [[ "$HTTP2_RC" -eq 0 ]]; then
  ok "HTTP/2 works with same CA cert"
else
  warn "HTTP/2 also failed (exit $HTTP2_RC)"
fi

# Test 4: Check if HTTP/3 curl container has CA cert properly mounted
say "Test 4: HTTP/3 curl container CA cert verification"
info "Checking if CA cert is properly accessible in HTTP/3 curl container..."

# The http3_curl function mounts the CA cert, but let's verify it's working
# by checking the actual curl command that gets executed
info "CA cert path: $CA_CERT"
if [[ -f "$CA_CERT" ]] && [[ -s "$CA_CERT" ]]; then
  ok "CA cert file exists and is readable"
  CERT_SUBJECT=$(openssl x509 -in "$CA_CERT" -noout -subject 2>/dev/null || echo "N/A")
  info "CA cert subject: $CERT_SUBJECT"
else
  fail "CA cert file not accessible"
fi

# Test 5: Check certificate file in Caddy pod
say "Test 5: Certificate file structure in Caddy pod"
if [[ -n "$CADDY_POD" ]]; then
  CERT_FILE_CONTENT=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- cat /etc/caddy/certs/tls.crt 2>/dev/null | head -50 || echo "")
  if [[ -n "$CERT_FILE_CONTENT" ]]; then
    CERT_COUNT_FILE=$(echo "$CERT_FILE_CONTENT" | grep -c "BEGIN CERTIFICATE" || echo "0")
    info "Certificate file in pod has $CERT_COUNT_FILE certificate(s)"
    
    if [[ $CERT_COUNT_FILE -ge 2 ]]; then
      ok "Certificate file has full chain"
      
      # Check if certificates are properly formatted (no extra whitespace, etc.)
      FIRST_CERT_END=$(echo "$CERT_FILE_CONTENT" | grep -n "END CERTIFICATE" | head -1 | cut -d: -f1 || echo "0")
      SECOND_CERT_START=$(echo "$CERT_FILE_CONTENT" | grep -n "BEGIN CERTIFICATE" | tail -1 | cut -d: -f1 || echo "0")
      
      if [[ $FIRST_CERT_END -gt 0 ]] && [[ $SECOND_CERT_START -gt $FIRST_CERT_END ]]; then
        ok "Certificate chain format looks correct"
      else
        warn "Certificate chain format may be incorrect"
      fi
    else
      fail "Certificate file only has $CERT_COUNT_FILE certificate(s)"
    fi
  else
    warn "Could not read certificate file from pod"
  fi
fi

say "=== Investigation Summary ==="
info "Review the output above to identify the root cause of curl exit 77"

# Cleanup
rm -f "$CA_CERT" 2>/dev/null || true
