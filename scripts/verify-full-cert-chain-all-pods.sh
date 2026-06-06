#!/usr/bin/env bash
# Verify full certificate chain across all pods: Caddy, Envoy, and service pods

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
NS_ENVOY="envoy-test"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

say "=== Verifying Full Certificate Chain Across All Pods ==="

# Check certificate secret first
say "1. Checking certificate secret (source of truth)"
CERT_SECRET=$(_kb -n "$NS_ING" get secret record-local-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$CERT_SECRET" ]]; then
  CERT_COUNT=$(echo "$CERT_SECRET" | grep -c "BEGIN CERTIFICATE" || echo "0")
  if [[ $CERT_COUNT -ge 2 ]]; then
    ok "Secret has full chain: $CERT_COUNT certificate(s)"
  else
    fail "Secret only has $CERT_COUNT certificate(s) - should be 2+ (leaf + CA)"
    exit 1
  fi
else
  fail "Could not retrieve certificate from secret"
  exit 1
fi

# Check all Caddy pods
say "2. Checking Caddy pods (2 replicas)"
CADDY_PODS=($(_kb -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))
if [[ ${#CADDY_PODS[@]} -eq 0 ]]; then
  fail "No Caddy pods found"
  exit 1
fi

for pod in "${CADDY_PODS[@]}"; do
  info "Checking Caddy pod: $pod"
  
  # Check if certificate file exists and has multiple certificates
  CERT_FILE=$(_kb -n "$NS_ING" exec "$pod" -- cat /etc/caddy/certs/tls.crt 2>/dev/null || echo "")
  if [[ -n "$CERT_FILE" ]]; then
    CERT_COUNT=$(echo "$CERT_FILE" | grep -c "BEGIN CERTIFICATE" || echo "0")
    if [[ $CERT_COUNT -ge 2 ]]; then
      ok "  $pod: Full chain present ($CERT_COUNT certificates)"
    else
      warn "  $pod: Only $CERT_COUNT certificate(s) - may need restart"
      # Try to get certificate via s_client if available
      if _kb -n "$NS_ING" exec "$pod" -- which openssl >/dev/null 2>&1; then
        CHAIN_COUNT=$(_kb -n "$NS_ING" exec "$pod" -- openssl s_client -connect localhost:443 -showcerts 2>/dev/null </dev/null | grep -c "BEGIN CERTIFICATE" || echo "0")
        if [[ $CHAIN_COUNT -ge 2 ]]; then
          ok "    But server presents full chain ($CHAIN_COUNT certificates)"
        else
          warn "    Server also only presents $CHAIN_COUNT certificate(s)"
        fi
      fi
    fi
  else
    warn "  $pod: Could not read certificate file"
  fi
done

# Check Envoy pod
say "3. Checking Envoy pod"
ENVOY_POD=$(_kb -n "$NS_ENVOY" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$ENVOY_POD" ]]; then
  ENVOY_POD=$(_kb -n "$NS_ING" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$ENVOY_POD" ]]; then
    NS_ENVOY="$NS_ING"
  fi
fi

if [[ -n "$ENVOY_POD" ]]; then
  info "Checking Envoy pod: $ENVOY_POD (namespace: $NS_ENVOY)"
  
  # Check CA certificate
  CA_EXISTS=$(_kb -n "$NS_ENVOY" exec "$ENVOY_POD" -- test -f /etc/certs/ca/dev-root.pem 2>/dev/null && echo "yes" || echo "no")
  if [[ "$CA_EXISTS" == "yes" ]]; then
    ok "  Envoy has CA certificate"
  else
    warn "  Envoy missing CA certificate"
  fi
else
  warn "Envoy pod not found"
fi

# Check service pods
say "4. Checking service pods (gRPC services)"
SERVICES=("auth-service:50051" "records-service:50051" "social-service:50056" "listings-service:50057" "analytics-service:50054" "shopping-service:50058")
ALL_GOOD=1

for svc_port in "${SERVICES[@]}"; do
  svc="${svc_port%%:*}"
  info "Checking $svc..."
  
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -z "$POD" ]]; then
    POD=$(_kb -n "$NS" get pods -l "app.kubernetes.io/name=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  fi
  
  if [[ -n "$POD" ]]; then
    # Check service-tls secret mount
    HAS_TLS_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/tls.crt 2>/dev/null && echo "yes" || echo "no")
    HAS_TLS_KEY=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/tls.key 2>/dev/null && echo "yes" || echo "no")
    HAS_CA_CERT=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/ca.crt 2>/dev/null && echo "yes" || echo "no")
    
    if [[ "$HAS_TLS_CERT" == "yes" ]] && [[ "$HAS_TLS_KEY" == "yes" ]] && [[ "$HAS_CA_CERT" == "yes" ]]; then
      # Check if tls.crt has full chain
      CERT_FILE=$(_kb -n "$NS" exec "$POD" -- cat /etc/certs/tls.crt 2>/dev/null || echo "")
      if [[ -n "$CERT_FILE" ]]; then
        CERT_COUNT=$(echo "$CERT_FILE" | grep -c "BEGIN CERTIFICATE" || echo "0")
        if [[ $CERT_COUNT -ge 2 ]]; then
          ok "  $svc ($POD): Full chain present ($CERT_COUNT certificates)"
        else
          warn "  $svc ($POD): Only $CERT_COUNT certificate(s) in tls.crt"
          ALL_GOOD=0
        fi
      else
        warn "  $svc ($POD): Could not read tls.crt"
        ALL_GOOD=0
      fi
    else
      warn "  $svc ($POD): Missing certificates (tls.crt: $HAS_TLS_CERT, tls.key: $HAS_TLS_KEY, ca.crt: $HAS_CA_CERT)"
      ALL_GOOD=0
    fi
  else
    warn "  $svc: Pod not found"
    ALL_GOOD=0
  fi
done

say "=== Verification Summary ==="
if [[ $ALL_GOOD -eq 1 ]]; then
  ok "All pods have full certificate chains"
  exit 0
else
  warn "Some pods may need certificate updates or restarts"
  exit 1
fi
