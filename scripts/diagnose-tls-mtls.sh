#!/usr/bin/env bash
# Comprehensive TLS/mTLS diagnostic script
# Checks HTTP/3, gRPC, certificate chains, and mTLS configuration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

NS="record-platform"
NS_ING="ingress-nginx"
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"

# kubectl helper
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== TLS/mTLS Diagnostic Report ==="

# 1. Check CA Certificate Configuration
say "1. CA Certificate Configuration"
CA_CERT=""
K8S_CA_ING=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]]; then
  CA_CERT="/tmp/diagnose-ca-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
  ok "CA certificate found in ingress-nginx namespace"
  info "  Subject: $(openssl x509 -in "$CA_CERT" -noout -subject 2>/dev/null || echo "N/A")"
  info "  Issuer: $(openssl x509 -in "$CA_CERT" -noout -issuer 2>/dev/null || echo "N/A")"
  info "  Valid until: $(openssl x509 -in "$CA_CERT" -noout -enddate 2>/dev/null | cut -d= -f2 || echo "N/A")"
else
  warn "CA certificate not found in ingress-nginx namespace"
fi

# 2. Check Caddy Certificate Configuration
say "2. Caddy Certificate Configuration"
CADDY_POD=$(_kb -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$CADDY_POD" ]]; then
  ok "Caddy pod found: $CADDY_POD"
  
  # Check mounted certificates
  info "Checking mounted certificates in Caddy pod..."
  CADDY_CERT=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- cat /etc/caddy/certs/tls.crt 2>/dev/null | head -20 || echo "")
  if [[ -n "$CADDY_CERT" ]]; then
    ok "Caddy certificate found"
    CADDY_CERT_SUBJECT=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- openssl x509 -in /etc/caddy/certs/tls.crt -noout -subject 2>/dev/null || echo "N/A")
    CADDY_CERT_ISSUER=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- openssl x509 -in /etc/caddy/certs/tls.crt -noout -issuer 2>/dev/null || echo "N/A")
    info "  Subject: $CADDY_CERT_SUBJECT"
    info "  Issuer: $CADDY_CERT_ISSUER"
    
    # Check certificate chain
    CADDY_CHAIN=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- openssl x509 -in /etc/caddy/certs/tls.crt -text -noout 2>/dev/null | grep -A 5 "Issuer:" || echo "")
    if echo "$CADDY_CERT_ISSUER" | grep -q "dev-root-ca"; then
      ok "  Certificate issued by dev-root-ca"
    else
      warn "  Certificate issuer mismatch (expected dev-root-ca)"
    fi
  else
    warn "Caddy certificate not found or not readable"
  fi
else
  warn "Caddy pod not found"
fi

# 3. Test HTTP/3 Certificate Verification
say "3. HTTP/3 Certificate Verification Test"
if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
  . "$SCRIPT_DIR/lib/http3.sh"
  HTTP3_SVC_IP=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [[ -n "$HTTP3_SVC_IP" ]]; then
    HTTP3_RESOLVE="${HOST}:443:${HTTP3_SVC_IP}"
  else
    HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
  fi
  
  info "Testing HTTP/3 with strict TLS..."
  HTTP3_TEST=$(http3_curl --cacert "$CA_CERT" -sS -w "\n%{http_code}" --http3-only --max-time 10 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/_caddy/healthz" 2>&1) || HTTP3_RC=$?
  HTTP3_RC=${HTTP3_RC:-0}
  HTTP3_CODE=$(echo "$HTTP3_TEST" | tail -1)
  
  if [[ "$HTTP3_RC" -eq 0 ]] && [[ "$HTTP3_CODE" == "200" ]]; then
    ok "HTTP/3 certificate verification: SUCCESS"
  elif [[ "$HTTP3_RC" -eq 77 ]]; then
    fail "HTTP/3 certificate verification: FAILED (curl exit 77 - SSL certificate problem)"
    info "  This indicates the CA certificate doesn't match the server certificate"
    info "  Certificate chain may be incomplete or CA doesn't trust the server cert"
  else
    warn "HTTP/3 certificate verification: FAILED (exit $HTTP3_RC, HTTP $HTTP3_CODE)"
    echo "$HTTP3_TEST" | head -10
  fi
else
  warn "Skipping HTTP/3 test (CA certificate not available)"
fi

# 4. Check gRPC Service TLS Configuration
say "4. gRPC Service TLS Configuration"
SERVICES=("auth-service:50051" "records-service:50051" "social-service:50056" "listings-service:50057" "analytics-service:50054" "shopping-service:50058" "auction-monitor:50059")
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  info "Checking $svc (port $port)..."
  
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$POD" ]]; then
    POD=$(_kb -n "$NS" get pods -l "app.kubernetes.io/name=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  fi
  
  if [[ -n "$POD" ]]; then
    # Check if TLS certs exist
    HAS_TLS_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/tls.crt 2>/dev/null && echo "yes" || echo "no")
    HAS_TLS_KEY=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/tls.key 2>/dev/null && echo "yes" || echo "no")
    HAS_CA_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/ca.crt 2>/dev/null && echo "yes" || echo "no")
    
    if [[ "$HAS_TLS_CERT" == "yes" ]] && [[ "$HAS_TLS_KEY" == "yes" ]]; then
      ok "  $svc: TLS certificates found"
      if [[ "$HAS_CA_CERT" == "yes" ]]; then
        info "    CA certificate present (mTLS capable)"
      else
        warn "    CA certificate missing (mTLS not available)"
      fi
      
      # Check GRPC_REQUIRE_CLIENT_CERT env var
      REQUIRE_CLIENT_CERT=$(_kb -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].env[?(@.name=="GRPC_REQUIRE_CLIENT_CERT")].value}' 2>/dev/null || echo "")
      if [[ "$REQUIRE_CLIENT_CERT" == "true" ]]; then
        info "    mTLS: ENABLED (GRPC_REQUIRE_CLIENT_CERT=true)"
      else
        info "    mTLS: DISABLED (dev mode)"
      fi
    else
      warn "  $svc: TLS certificates missing"
    fi
  else
    warn "  $svc: Pod not found"
  fi
done

# 5. Test gRPC with TLS
say "5. gRPC TLS Connection Test"
ENVOY_POD=$(_kb -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(_kb -n "$NS_ING" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ENVOY_NS="$NS_ING"
else
  ENVOY_NS="envoy-test"
fi

if [[ -n "$ENVOY_POD" ]]; then
  ok "Envoy pod found: $ENVOY_POD (namespace: $ENVOY_NS)"
  
  # Test gRPC HealthCheck via Envoy
  info "Testing gRPC HealthCheck via Envoy..."
  PROTO_DIR=""
  RELATIVE_PROTO="${SCRIPT_DIR}/../proto"
  if [[ -d "$RELATIVE_PROTO" ]]; then
    PROTO_DIR="$(cd "$RELATIVE_PROTO" && pwd)"
  else
    INFRA_PROTO="${SCRIPT_DIR}/../../infra/k8s/base/config/proto"
    if [[ -d "$INFRA_PROTO" ]]; then
      PROTO_DIR="$(cd "$INFRA_PROTO" && pwd)"
    fi
  fi
  
  if [[ -n "$PROTO_DIR" ]] && command -v grpcurl >/dev/null 2>&1; then
    # Test via Envoy NodePort (plaintext - Envoy handles TLS)
    for port in 30000 30001; do
      GRPC_TEST=$(grpcurl -plaintext -max-time 5 \
        -import-path "$PROTO_DIR" \
        -proto "$PROTO_DIR/health.proto" \
        -d '{"service":""}' \
        "127.0.0.1:${port}" \
        grpc.health.v1.Health/Check 2>&1) || GRPC_RC=$?
      GRPC_RC=${GRPC_RC:-0}
      
      if echo "$GRPC_TEST" | grep -q "SERVING"; then
        ok "  gRPC via Envoy NodePort $port: SUCCESS"
        break
      fi
    done
    
    # Test direct port-forward with TLS
    info "Testing gRPC via direct port-forward with TLS..."
    AUTH_POD=$(_kb -n "$NS" get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$AUTH_POD" ]] && [[ -n "$CA_CERT" ]]; then
      # Start port-forward in background
      _kb -n "$NS" port-forward "pod/$AUTH_POD" 50051:50051 >/dev/null 2>&1 &
      PF_PID=$!
      sleep 2
      
      if kill -0 "$PF_PID" 2>/dev/null; then
        GRPC_TLS_TEST=$(grpcurl -cacert "$CA_CERT" -max-time 5 \
          -import-path "$PROTO_DIR" \
          -proto "$PROTO_DIR/health.proto" \
          -d '{"service":""}' \
          "127.0.0.1:50051" \
          grpc.health.v1.Health/Check 2>&1) || GRPC_TLS_RC=$?
        GRPC_TLS_RC=${GRPC_TLS_RC:-0}
        
        if echo "$GRPC_TLS_TEST" | grep -q "SERVING"; then
          ok "  gRPC via direct port-forward with TLS: SUCCESS"
        else
          warn "  gRPC via direct port-forward with TLS: FAILED"
          echo "$GRPC_TLS_TEST" | head -5
        fi
        
        kill "$PF_PID" 2>/dev/null || true
        wait "$PF_PID" 2>/dev/null || true
      fi
    fi
  else
    warn "Skipping gRPC test (grpcurl or proto directory not found)"
  fi
else
  warn "Envoy pod not found"
fi

# 6. Check Certificate Chain Completeness
say "6. Certificate Chain Analysis"
if [[ -n "$CADDY_POD" ]] && [[ -n "$CA_CERT" ]]; then
  info "Analyzing certificate chain..."
  
  # Get full certificate chain from Caddy
  FULL_CHAIN=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- openssl s_client -connect localhost:443 -showcerts 2>/dev/null </dev/null | grep -A 100 "BEGIN CERTIFICATE" || echo "")
  
  if [[ -n "$FULL_CHAIN" ]]; then
    CERT_COUNT=$(echo "$FULL_CHAIN" | grep -c "BEGIN CERTIFICATE" || echo "0")
    info "  Certificate chain contains $CERT_COUNT certificate(s)"
    
    if [[ $CERT_COUNT -ge 2 ]]; then
      ok "  Certificate chain is complete (leaf + CA)"
    else
      warn "  Certificate chain may be incomplete (only $CERT_COUNT certificate(s))"
      info "  HTTP/3 curl may fail if CA is not in the chain"
    fi
  fi
  
  # Verify CA matches
  if [[ -f "$CA_CERT" ]]; then
    CA_FINGERPRINT=$(openssl x509 -in "$CA_CERT" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || echo "")
    info "  CA fingerprint: ${CA_FINGERPRINT:0:20}..."
  fi
fi

# 7. mTLS Configuration Summary
say "7. mTLS Configuration Summary"
info "Services with mTLS capability:"
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$POD" ]]; then
    POD=$(_kb -n "$NS" get pods -l "app.kubernetes.io/name=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  fi
  
  if [[ -n "$POD" ]]; then
    HAS_CA=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/ca.crt 2>/dev/null && echo "yes" || echo "no")
    REQUIRE_CLIENT=$(_kb -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].env[?(@.name=="GRPC_REQUIRE_CLIENT_CERT")].value}' 2>/dev/null || echo "false")
    
    if [[ "$HAS_CA" == "yes" ]]; then
      if [[ "$REQUIRE_CLIENT" == "true" ]]; then
        info "  ✅ $svc: mTLS ENABLED (client cert required)"
      else
        info "  ⚠️  $svc: mTLS CAPABLE (client cert optional)"
      fi
    else
      info "  ❌ $svc: mTLS NOT AVAILABLE (no CA cert)"
    fi
  fi
done

say "=== Diagnostic Complete ==="
info "Review the output above to identify TLS/mTLS issues"
info "Common issues:"
info "  - HTTP/3 exit 77: CA certificate doesn't match server certificate"
info "  - gRPC routing: Envoy configuration or TLS mismatch"
info "  - mTLS: Missing CA certificates or GRPC_REQUIRE_CLIENT_CERT not set"

# Cleanup
rm -f "$CA_CERT" 2>/dev/null || true
