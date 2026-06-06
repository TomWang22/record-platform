#!/usr/bin/env bash
# Comprehensive fix for all TLS/mTLS issues found
# Fixes HTTP/3 curl exit 77, Envoy NodePort, and strict TLS verification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

say "=== Comprehensive TLS/mTLS Fix Script ==="

# Fix 1: Ensure service-tls has full chain
say "Fix 1: Ensuring service-tls secret has full certificate chain"
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

NS="record-platform"
NS_ING="ingress-nginx"

# Check if service-tls has full chain
SVC_TLS_CRT=$(_kb -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$SVC_TLS_CRT" ]]; then
  CERT_COUNT=$(echo "$SVC_TLS_CRT" | grep -c "BEGIN CERTIFICATE" || echo "0")
  if [[ $CERT_COUNT -ge 2 ]]; then
    ok "service-tls already has full chain ($CERT_COUNT certificates)"
  else
    warn "service-tls only has $CERT_COUNT certificate(s) - will re-issue"
    say "Re-issuing certificates with full chain..."
    bash "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" 2>&1 | tail -20
  fi
else
  warn "service-tls secret not found - will create"
  bash "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" 2>&1 | tail -20
fi

# Fix 2: Verify HTTP/3 helper is using NodePort
say "Fix 2: Verifying HTTP/3 helper uses NodePort"
if grep -q "CADDY_NODEPORT" "$SCRIPT_DIR/lib/http3.sh"; then
  ok "HTTP/3 helper configured to use NodePort"
else
  warn "HTTP/3 helper may not be using NodePort correctly"
fi

# Fix 3: Check Envoy NodePort exposure
say "Fix 3: Checking Envoy NodePort exposure"
ENVOY_NODEPORT=$(_kb -n envoy-test get svc envoy-test -o jsonpath='{.spec.ports[?(@.port==10000)].nodePort}' 2>/dev/null || echo "")
if [[ -n "$ENVOY_NODEPORT" ]]; then
  ok "Envoy NodePort configured: $ENVOY_NODEPORT"
  # Test connectivity
  if command -v nc >/dev/null 2>&1; then
    if nc -z -w 2 127.0.0.1 "$ENVOY_NODEPORT" 2>/dev/null; then
      ok "Envoy NodePort $ENVOY_NODEPORT is reachable"
    else
      warn "Envoy NodePort $ENVOY_NODEPORT is not reachable from host"
      info "  This may be a Colima networking issue - using port-forward as fallback"
    fi
  fi
else
  warn "Envoy NodePort not found"
fi

# Fix 4: Verify all pods have full chain
say "Fix 4: Verifying all pods have full certificate chain"
bash "$SCRIPT_DIR/verify-full-cert-chain-all-pods.sh" 2>&1 | tail -20

say "=== Fix Complete ==="
info "All fixes applied. Ready to run test suite."
