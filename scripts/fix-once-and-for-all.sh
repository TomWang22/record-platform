#!/usr/bin/env bash
# Fix cluster, API server, Envoy, and test issues "once and for all".
# 1. Pin Colima K8s API port (if Colima)
# 2. Ensure API server is reachable (wait loop)
# 3. Apply Envoy ConfigMap fix (gRPC routes)
# 4. Restart Envoy; optionally run smoke/enhanced/rotation suite
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_TESTS="${RUN_TESTS:-0}"
COLIMA_PIN_PORT="${COLIMA_PIN_PORT:-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# --- 1. Colima: pin Kubernetes API port ---
# Returns 0 normally, 2 if we just pinned (caller should exit so user restarts Colima first).
pin_colima_k8s_port() {
  [[ "$COLIMA_PIN_PORT" != "1" ]] && return 0
  local ctx
  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  [[ "$ctx" != "colima" ]] && return 0

  local cfg="$HOME/.colima/default/colima.yaml"
  if [[ ! -f "$cfg" ]]; then
    warn "Colima config not found at $cfg; skipping port pin"
    return 0
  fi

  if grep -q "kubernetes:" "$cfg" && grep -A30 "kubernetes:" "$cfg" | grep -q "port: 0"; then
    say "Pinning Colima Kubernetes API port to 6443..."
    awk '/kubernetes:/{f=1} f && /^[[:space:]]+port: 0$/{sub(/port: 0/,"port: 6443"); f=0} 1' "$cfg" > "$cfg.tmp" && mv "$cfg.tmp" "$cfg"
    if grep -A30 "kubernetes:" "$cfg" | grep -q "port: 6443"; then
      ok "Colima Kubernetes port set to 6443"
      warn "Run: colima stop && colima start --kubernetes (then re-run this script)"
      return 2
    fi
  else
    ok "Colima Kubernetes port already pinned or not using port 0"
  fi
  return 0
}

# --- 2. Wait for API server ---
wait_for_api() {
  say "Waiting for Kubernetes API server..."
  "$SCRIPT_DIR/ensure-api-server-ready.sh" || fail "API server not ready"
}

# --- 3. Apply Envoy ConfigMap and restart ---
apply_envoy_fix() {
  say "Applying Envoy ConfigMap fix (gRPC routes)..."
  local envoy_yaml="$SCRIPT_DIR/../infra/k8s/base/envoy-test/envoy.yaml"
  if [[ ! -f "$envoy_yaml" ]]; then
    warn "Envoy YAML not found at $envoy_yaml; skipping"
    return 0
  fi

  kubectl -n envoy-test create configmap envoy-config \
    --from-file=envoy.yaml="$envoy_yaml" \
    --dry-run=client -o yaml | kubectl apply --validate=false -f - 2>/dev/null || {
    warn "ConfigMap apply failed; continuing..."
    return 0
  }
  ok "Envoy ConfigMap updated"

  kubectl -n envoy-test rollout restart deploy/envoy-test 2>/dev/null || true
  say "Waiting for Envoy rollout (max 60s)..."
  kubectl -n envoy-test rollout status deploy/envoy-test --timeout=60s 2>/dev/null || {
    warn "Envoy rollout timed out; pods may still be starting"
    kubectl -n envoy-test get pods -l app=envoy-test 2>/dev/null | head -5
  }
  ok "Envoy restart complete"
}

# --- 4. Optional: run tests ---
run_tests() {
  [[ "$RUN_TESTS" != "1" ]] && return 0
  say "Running smoke test..."
  "$SCRIPT_DIR/test-microservices-http2-http3.sh" 2>&1 | tail -80
}

# --- main ---
main() {
  say "=== Fix once and for all ==="
  pin_colima_k8s_port
  local pin_ret=$?
  if [[ $pin_ret -eq 2 ]]; then
    say "Restart Colima, then re-run: ./scripts/fix-once-and-for-all.sh"
    exit 0
  fi
  wait_for_api
  apply_envoy_fix
  run_tests
  say "=== Done ==="
}

main "$@"
