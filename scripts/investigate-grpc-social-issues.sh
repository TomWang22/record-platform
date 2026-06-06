#!/usr/bin/env bash
# Investigate NodePort gRPC and Social Service Issues
# Run this before tests to diagnose problems

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
INVESTIGATION_LOG="/tmp/grpc-social-investigation-${TIMESTAMP}.log"

exec > >(tee "$INVESTIGATION_LOG")
exec 2>&1

say "=== Investigating NodePort gRPC and Social Service Issues ==="
info "Log: $INVESTIGATION_LOG"

# 1. Check Envoy Service and NodePorts
say "1. Checking Envoy Service Configuration..."
ENVOY_SVC=$(kubectl get svc -n envoy-test envoy-test -o json 2>/dev/null || kubectl get svc -n ingress-nginx envoy -o json 2>/dev/null || echo "")

if [[ -n "$ENVOY_SVC" ]]; then
  ok "Envoy service found"
  
  # Check NodePorts
  NODEPORT_30000=$(echo "$ENVOY_SVC" | jq -r '.spec.ports[]? | select(.nodePort == 30000) | .port' 2>/dev/null || echo "")
  NODEPORT_30001=$(echo "$ENVOY_SVC" | jq -r '.spec.ports[]? | select(.nodePort == 30001) | .port' 2>/dev/null || echo "")
  
  if [[ -n "$NODEPORT_30000" ]]; then
    ok "NodePort 30000: Maps to service port $NODEPORT_30000"
  else
    warn "NodePort 30000: Not configured (only 30001 may be available)"
    info "  Note: Tests may need to use port 30001 instead of 30000"
  fi
  
  if [[ -n "$NODEPORT_30001" ]]; then
    ok "NodePort 30001: Maps to service port $NODEPORT_30001"
  else
    warn "NodePort 30001: Not configured"
  fi
  
  # Check if Envoy requires TLS (strict TLS mode)
  if echo "$ENVOY_SVC" | jq -e '.spec.ports[]? | select(.name == "grpc")' >/dev/null 2>&1; then
    info "Envoy gRPC port configured"
    # Note: Envoy uses strict TLS to backends, so plaintext grpcurl may not work
    warn "  Note: Envoy uses strict TLS to backends - plaintext grpcurl may fail"
    info "  Use TLS with CA certificate for gRPC calls via NodePort"
  fi
  
  # Check service type
  SVC_TYPE=$(echo "$ENVOY_SVC" | jq -r '.spec.type' 2>/dev/null || echo "")
  info "Service type: $SVC_TYPE"
  
  if [[ "$SVC_TYPE" != "NodePort" ]] && [[ "$SVC_TYPE" != "LoadBalancer" ]]; then
    warn "Envoy service is not NodePort or LoadBalancer - external access may not work"
  fi
else
  warn "Envoy service not found"
fi

# 2. Check Envoy Pods
say "2. Checking Envoy Pods..."
ENVOY_PODS=($(kubectl get pods -n envoy-test -l app=envoy-test -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || \
  kubectl get pods -n ingress-nginx -l app=envoy -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

if [[ ${#ENVOY_PODS[@]} -gt 0 ]]; then
  ok "Envoy pods found: ${#ENVOY_PODS[@]}"
  for pod in "${ENVOY_PODS[@]}"; do
    NS=$(kubectl get pod "$pod" -A -o jsonpath='{.metadata.namespace}' 2>/dev/null || echo "unknown")
    STATUS=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "unknown")
    READY=$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    
    if [[ "$STATUS" == "Running" ]] && [[ "$READY" == "true" ]]; then
      ok "  Pod $pod ($NS): Running and Ready"
      
      # Check if Envoy is listening on port 10000
      if kubectl -n "$NS" exec "$pod" -- sh -c "netstat -ln | grep 10000 || ss -ln | grep 10000" >/dev/null 2>&1; then
        ok "    Port 10000: Listening"
      else
        warn "    Port 10000: Not listening"
      fi
    else
      warn "  Pod $pod ($NS): Status=$STATUS, Ready=$READY"
    fi
  done
else
  warn "No Envoy pods found"
fi

# 3. Test gRPC NodePort Connectivity
say "3. Testing gRPC NodePort Connectivity..."
if command -v grpcurl >/dev/null 2>&1; then
  PROTO_DIR=""
  if [[ -d "$SCRIPT_DIR/../proto" ]]; then
    PROTO_DIR="$(cd "$SCRIPT_DIR/../proto" && pwd)"
  elif [[ -d "$SCRIPT_DIR/../../infra/k8s/base/config/proto" ]]; then
    PROTO_DIR="$(cd "$SCRIPT_DIR/../../infra/k8s/base/config/proto" && pwd)"
  fi
  
  if [[ -n "$PROTO_DIR" ]]; then
    # Get CA certificate for TLS
    CA_CERT=""
    K8S_CA=$("$SCRIPT_DIR/../scripts/lib/kubectl-helper.sh" 2>/dev/null || kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    if [[ -n "$K8S_CA" ]]; then
      CA_CERT="/tmp/investigation-ca-$$.pem"
      echo "$K8S_CA" > "$CA_CERT"
    fi
    
    for port in 30000 30001; do
      info "Testing port $port..."
      
      # Try plaintext first (may not work if Envoy requires TLS)
      GRPC_TEST=$(timeout 5 grpcurl -plaintext -max-time 3 \
        -import-path "$PROTO_DIR" \
        -proto "$PROTO_DIR/health.proto" \
        -d '{"service":""}' \
        "127.0.0.1:${port}" \
        grpc.health.v1.Health/Check 2>&1) || GRPC_RC=$?
      GRPC_RC=${GRPC_RC:-0}
      
      if echo "$GRPC_TEST" | grep -q "SERVING"; then
        ok "Port $port: gRPC working (plaintext)"
      elif [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
        # Try with TLS
        info "  Trying TLS with CA certificate..."
        GRPC_TLS_TEST=$(timeout 5 grpcurl -cacert "$CA_CERT" -max-time 3 \
          -import-path "$PROTO_DIR" \
          -proto "$PROTO_DIR/health.proto" \
          -d '{"service":""}' \
          "127.0.0.1:${port}" \
          grpc.health.v1.Health/Check 2>&1) || GRPC_TLS_RC=$?
        GRPC_TLS_RC=${GRPC_TLS_RC:-0}
        
        if echo "$GRPC_TLS_TEST" | grep -q "SERVING"; then
          ok "Port $port: gRPC working (TLS)"
        elif echo "$GRPC_TLS_TEST" | grep -qE "connection.*refused|dial.*failed"; then
          warn "Port $port: Connection refused (service may not be exposed or Envoy not running)"
        elif echo "$GRPC_TLS_TEST" | grep -qE "deadline.*exceeded|timeout"; then
          warn "Port $port: Timeout (Envoy may be slow or not responding)"
        else
          warn "Port $port: Failed (plaintext and TLS) - $GRPC_TLS_TEST"
        fi
      elif echo "$GRPC_TEST" | grep -qE "connection.*refused|dial.*failed"; then
        warn "Port $port: Connection refused (service may not be exposed or Envoy not running)"
      elif echo "$GRPC_TEST" | grep -qE "deadline.*exceeded|timeout"; then
        warn "Port $port: Timeout (Envoy may be slow or not responding)"
      else
        warn "Port $port: Failed - $GRPC_TEST"
        info "  Note: Envoy may require TLS - try with CA certificate"
      fi
    done
    
    [[ -n "$CA_CERT" ]] && rm -f "$CA_CERT" 2>/dev/null || true
  else
    warn "Proto directory not found - cannot test gRPC"
  fi
else
  warn "grpcurl not installed - cannot test gRPC"
fi

# 4. Check Social Service
say "4. Checking Social Service..."
SOCIAL_PODS=($(kubectl get pods -n record-platform -l app=social-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

if [[ ${#SOCIAL_PODS[@]} -eq 0 ]]; then
  warn "No social-service pods found"
else
  ok "Social service pods found: ${#SOCIAL_PODS[@]}"
  
  for pod in "${SOCIAL_PODS[@]}"; do
    STATUS=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null || echo "unknown")
    READY=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    RESTARTS=$(kubectl get pod "$pod" -n record-platform -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "0")
    
    if [[ "$STATUS" == "Running" ]] && [[ "$READY" == "true" ]]; then
      ok "  Pod $pod: Running, Ready, Restarts=$RESTARTS"
      
      # Check if service is listening on port 4006
      if kubectl -n record-platform exec "$pod" -- sh -c "netstat -ln | grep 4006 || ss -ln | grep 4006" >/dev/null 2>&1; then
        ok "    Port 4006: Listening"
      else
        warn "    Port 4006: Not listening"
      fi
      
      # Check database connectivity
      DB_CHECK=$(kubectl -n record-platform exec "$pod" -- sh -c \
        "echo 'SELECT 1;' | timeout 5 psql \$POSTGRES_URL_SOCIAL >/dev/null 2>&1 && echo 'OK' || echo 'FAILED'" 2>/dev/null || echo "FAILED")
      if [[ "$DB_CHECK" == "OK" ]]; then
        ok "    Database: Connected"
      else
        warn "    Database: Connection failed"
      fi
      
      # Check recent logs for errors
      RECENT_ERRORS=$(kubectl -n record-platform logs "$pod" --tail=50 2>/dev/null | grep -iE "error|failed|502|upstream" | head -5 || echo "")
      if [[ -n "$RECENT_ERRORS" ]]; then
        warn "    Recent errors in logs:"
        echo "$RECENT_ERRORS" | sed 's/^/      /'
      fi
    else
      warn "  Pod $pod: Status=$STATUS, Ready=$READY, Restarts=$RESTARTS"
      
      # Get pod events for debugging
      EVENTS=$(kubectl get events -n record-platform --field-selector involvedObject.name="$pod" --sort-by='.lastTimestamp' 2>/dev/null | tail -5 || echo "")
      if [[ -n "$EVENTS" ]]; then
        info "    Recent events:"
        echo "$EVENTS" | sed 's/^/      /'
      fi
    fi
  done
fi

# 5. Check Social Service Health Endpoint
say "5. Testing Social Service Health Endpoint..."
HOST="${HOST:-record.local}"
PORT="${PORT:-30443}"

if command -v curl >/dev/null 2>&1; then
  SOCIAL_HEALTH=$(curl -k -s --http2 --max-time 5 \
    --resolve "${HOST}:${PORT}:127.0.0.1" \
    -H "Host: $HOST" \
    "https://${HOST}:${PORT}/api/social/healthz" 2>&1 || echo "ERROR")
  
  if echo "$SOCIAL_HEALTH" | grep -qiE "(ok|healthy|200)"; then
    ok "Social health endpoint: OK"
  elif echo "$SOCIAL_HEALTH" | grep -qiE "502|upstream error"; then
    warn "Social health endpoint: 502 upstream error"
    info "  This indicates social-service is unreachable from api-gateway"
    info "  Possible causes:"
    info "    - social-service pod not running"
    info "    - Network policy blocking traffic"
    info "    - Service selector mismatch"
    info "    - Port mismatch (expected 4006)"
  else
    warn "Social health endpoint: Unexpected response: ${SOCIAL_HEALTH:0:100}"
  fi
else
  warn "curl not available - cannot test health endpoint"
fi

# 6. Check API Gateway to Social Service Connectivity
say "6. Checking API Gateway to Social Service Connectivity..."
GATEWAY_PODS=($(kubectl get pods -n record-platform -l app=api-gateway -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

if [[ ${#GATEWAY_PODS[@]} -gt 0 ]]; then
  GATEWAY_POD="${GATEWAY_PODS[0]}"
  ok "API Gateway pod: $GATEWAY_POD"
  
  # Test connectivity from gateway to social service
  GATEWAY_TO_SOCIAL=$(kubectl -n record-platform exec "$GATEWAY_POD" -- sh -c \
    "timeout 3 nc -z social-service 4006 2>&1 || timeout 3 curl -s http://social-service:4006/healthz 2>&1 | head -1" 2>/dev/null || echo "FAILED")
  
  if echo "$GATEWAY_TO_SOCIAL" | grep -qiE "succeeded|200|ok"; then
    ok "API Gateway -> Social Service: Connected"
  else
    warn "API Gateway -> Social Service: Connection failed"
    info "  Response: $GATEWAY_TO_SOCIAL"
  fi
else
  warn "API Gateway pods not found"
fi

# 7. Check Social Service Configuration
say "7. Checking Social Service Configuration..."
SOCIAL_SVC=$(kubectl get svc -n record-platform social-service -o json 2>/dev/null || echo "")

if [[ -n "$SOCIAL_SVC" ]]; then
  ok "Social service found"
  
  SVC_PORT=$(echo "$SOCIAL_SVC" | jq -r '.spec.ports[0].port' 2>/dev/null || echo "")
  TARGET_PORT=$(echo "$SOCIAL_SVC" | jq -r '.spec.ports[0].targetPort' 2>/dev/null || echo "")
  SELECTOR=$(echo "$SOCIAL_SVC" | jq -r '.spec.selector.app' 2>/dev/null || echo "")
  
  info "  Service port: $SVC_PORT"
  info "  Target port: $TARGET_PORT"
  info "  Selector: $SELECTOR"
  
  if [[ "$SVC_PORT" != "4006" ]]; then
    warn "  Service port mismatch: expected 4006, got $SVC_PORT"
  fi
  
  if [[ "$TARGET_PORT" != "4006" ]]; then
    warn "  Target port mismatch: expected 4006, got $TARGET_PORT"
  fi
  
  # Check if selector matches pods
  if [[ -n "$SELECTOR" ]]; then
    MATCHING_PODS=$(kubectl get pods -n record-platform -l app="$SELECTOR" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$MATCHING_PODS" ]]; then
      ok "  Selector matches pods: $(echo "$MATCHING_PODS" | wc -w | tr -d ' ') pod(s)"
    else
      warn "  Selector does not match any pods"
    fi
  fi
else
  warn "Social service not found"
fi

say "=== Investigation Complete ==="
ok "Full investigation log: $INVESTIGATION_LOG"
info "Review the log for detailed diagnostics"
