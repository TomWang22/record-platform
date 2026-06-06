#!/usr/bin/env bash
# Deep investigation of gRPC Envoy NodePort and strict TLS issues

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
NS_ENVOY="envoy-test"
NS_ING="ingress-nginx"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== Deep Investigation: gRPC Envoy & Strict TLS ==="

# Find Envoy pod
ENVOY_POD=$(_kb -n "$NS_ENVOY" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(_kb -n "$NS_ING" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$ENVOY_POD" ]]; then
    NS_ENVOY="$NS_ING"
  fi
fi

if [[ -z "$ENVOY_POD" ]]; then
  fail "Envoy pod not found"
  exit 1
fi

ok "Found Envoy pod: $ENVOY_POD (namespace: $NS_ENVOY)"

# Test 1: Check Envoy service and NodePort
say "Test 1: Envoy Service and NodePort Configuration"
ENVOY_SVC=$(_kb -n "$NS_ENVOY" get svc envoy-test -o jsonpath='{.metadata.name}' 2>/dev/null || echo "")
if [[ -z "$ENVOY_SVC" ]]; then
  ENVOY_SVC=$(_kb -n "$NS_ING" get svc envoy-test -o jsonpath='{.metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$ENVOY_SVC" ]]; then
    NS_ENVOY="$NS_ING"
  fi
fi

if [[ -n "$ENVOY_SVC" ]]; then
  info "Envoy service: $ENVOY_SVC"
  NODEPORT_30000=$(_kb -n "$NS_ENVOY" get svc "$ENVOY_SVC" -o jsonpath='{.spec.ports[?(@.port==10000)].nodePort}' 2>/dev/null || echo "")
  NODEPORT_30001=$(_kb -n "$NS_ENVOY" get svc "$ENVOY_SVC" -o jsonpath='{.spec.ports[?(@.port==10001)].nodePort}' 2>/dev/null || echo "")
  
  info "NodePort 30000: ${NODEPORT_30000:-not found}"
  info "NodePort 30001: ${NODEPORT_30001:-not found}"
  
  # Test connectivity
  for port in 30000 30001; do
    info "Testing connectivity to 127.0.0.1:$port..."
    if timeout 3 nc -z 127.0.0.1 "$port" 2>/dev/null; then
      ok "Port $port is reachable"
    else
      warn "Port $port is not reachable"
    fi
  done
else
  warn "Envoy service not found"
fi

# Test 2: Check Envoy configuration
say "Test 2: Envoy Configuration"
ENVOY_CONFIG=$(_kb -n "$NS_ENVOY" exec "$ENVOY_POD" -- cat /etc/envoy/envoy.yaml 2>/dev/null || echo "")
if [[ -n "$ENVOY_CONFIG" ]]; then
  info "Envoy config found"
  
  # Check for auth service routing
  if echo "$ENVOY_CONFIG" | grep -q "/auth\."; then
    ok "Envoy routes /auth. paths"
  else
    warn "Envoy may not route /auth. paths correctly"
  fi
  
  # Check TLS configuration
  if echo "$ENVOY_CONFIG" | grep -q "transport_socket"; then
    ok "Envoy has TLS transport socket configured"
  else
    warn "Envoy TLS transport socket not found"
  fi
else
  warn "Could not read Envoy configuration"
fi

# Test 3: Test gRPC via Envoy with different methods
say "Test 3: gRPC via Envoy - Multiple Test Methods"
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
  info "Testing gRPC HealthCheck via Envoy NodePort 30000..."
  GRPC_TEST1=$(grpcurl -plaintext -max-time 5 \
    -import-path "$PROTO_DIR" \
    -proto "$PROTO_DIR/health.proto" \
    -d '{"service":""}' \
    "127.0.0.1:30000" \
    grpc.health.v1.Health/Check 2>&1) || GRPC_RC1=$?
  GRPC_RC1=${GRPC_RC1:-0}
  
  if echo "$GRPC_TEST1" | grep -q "SERVING"; then
    ok "gRPC via NodePort 30000: SUCCESS"
  else
    warn "gRPC via NodePort 30000: FAILED (exit $GRPC_RC1)"
    echo "$GRPC_TEST1" | head -5
  fi
  
  # Test with verbose
  info "Testing with verbose output..."
  GRPC_VERBOSE=$(grpcurl -v -plaintext -max-time 5 \
    -import-path "$PROTO_DIR" \
    -proto "$PROTO_DIR/health.proto" \
    -d '{"service":""}' \
    "127.0.0.1:30000" \
    grpc.health.v1.Health/Check 2>&1) || GRPC_VRC=$?
  GRPC_VRC=${GRPC_VRC:-0}
  
  if [[ "$GRPC_VRC" -ne 0 ]]; then
    info "Verbose output:"
    echo "$GRPC_VERBOSE" | head -20
  fi
else
  warn "grpcurl or proto directory not found"
fi

# Test 4: Test direct service access with strict TLS
say "Test 4: Direct Service Access with Strict TLS"
CA_CERT=""
K8S_CA=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA" ]]; then
  CA_CERT="/tmp/grpc-investigate-ca-$$.pem"
  echo "$K8S_CA" > "$CA_CERT"
fi

SERVICES=("auth-service:50051" "records-service:50051")
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  
  info "Testing $svc (port $port) with strict TLS..."
  
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$POD" ]] && [[ -n "$PROTO_DIR" ]] && [[ -n "$CA_CERT" ]] && command -v grpcurl >/dev/null 2>&1; then
    # Start port-forward
    _kb -n "$NS" port-forward "pod/$POD" ${port}:${port} >/dev/null 2>&1 &
    PF_PID=$!
    sleep 2
    
    if kill -0 "$PF_PID" 2>/dev/null; then
      # Test with strict TLS
      GRPC_TLS_TEST=$(grpcurl -cacert "$CA_CERT" -max-time 5 \
        -import-path "$PROTO_DIR" \
        -proto "$PROTO_DIR/health.proto" \
        -d '{"service":""}' \
        "127.0.0.1:${port}" \
        grpc.health.v1.Health/Check 2>&1) || GRPC_TLS_RC=$?
      GRPC_TLS_RC=${GRPC_TLS_RC:-0}
      
      if echo "$GRPC_TLS_TEST" | grep -q "SERVING"; then
        ok "  $svc strict TLS: SUCCESS"
      else
        warn "  $svc strict TLS: FAILED (exit $GRPC_TLS_RC)"
        echo "$GRPC_TLS_TEST" | head -5
      fi
      
      kill "$PF_PID" 2>/dev/null || true
      wait "$PF_PID" 2>/dev/null || true
    fi
  fi
done

# Test 5: Check service certificate configuration
say "Test 5: Service Certificate Configuration"
for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -n "$POD" ]]; then
    info "Checking $svc ($POD)..."
    
    # Check certificate files
    HAS_TLS_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/tls.crt 2>/dev/null && echo "yes" || echo "no")
    HAS_CA_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/ca.crt 2>/dev/null && echo "yes" || echo "no")
    
    if [[ "$HAS_TLS_CERT" == "yes" ]]; then
      CERT_CONTENT=$(_kb -n "$NS" exec "$POD" -- cat /etc/certs/tls.crt 2>/dev/null || echo "")
      CERT_COUNT=$(echo "$CERT_CONTENT" | grep -c "BEGIN CERTIFICATE" || echo "0")
      info "  tls.crt: $CERT_COUNT certificate(s)"
      
      if [[ $CERT_COUNT -ge 2 ]]; then
        ok "  Full chain in tls.crt"
      else
        warn "  Only $CERT_COUNT certificate(s) in tls.crt"
      fi
    else
      warn "  tls.crt not found"
    fi
    
    if [[ "$HAS_CA_CERT" == "yes" ]]; then
      ok "  ca.crt present"
    else
      warn "  ca.crt missing"
    fi
  fi
done

say "=== Investigation Summary ==="
info "Review output above to identify gRPC routing and TLS issues"

# Cleanup
rm -f "$CA_CERT" 2>/dev/null || true
