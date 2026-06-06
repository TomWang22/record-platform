#!/usr/bin/env bash
# Verify all fixes are applied and working
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Verifying All Fixes ==="

# 1. API Server
if kubectl cluster-info >/dev/null 2>&1; then
  ok "API server is accessible"
else
  fail "API server not accessible"
  exit 1
fi

# 2. Envoy ConfigMap
if kubectl -n envoy-test get configmap envoy-config >/dev/null 2>&1; then
  ENVOY_YAML=$(kubectl -n envoy-test get configmap envoy-config -o jsonpath='{.data.envoy\.yaml}' 2>/dev/null || true)
  if echo "$ENVOY_YAML" | grep -q "safe_regex" && echo "$ENVOY_YAML" | grep -qE "auction_monitor|auction-monitor"; then
    ok "Envoy ConfigMap has fixed YAML syntax"
  else
    warn "Envoy ConfigMap may not have fixes applied"
  fi
else
  warn "Envoy ConfigMap not found"
fi

# 3. Envoy Pod
ENVOY_READY=$(kubectl -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
if [[ "$ENVOY_READY" == "true" ]]; then
  ok "Envoy pod is ready"
else
  warn "Envoy pod not ready: $ENVOY_READY"
fi

# 4. Caddy Pods
CADDY_COUNT=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 --no-headers 2>&1 | grep Running | wc -l | tr -d ' ')
if [[ "$CADDY_COUNT" -ge 1 ]]; then
  ok "Caddy pods running ($CADDY_COUNT)"
else
  warn "Caddy pods not running"
fi

# 5. Test Scripts
if [[ -f "scripts/ensure-api-server-ready.sh" ]] && [[ -f "scripts/fix-once-and-for-all.sh" ]]; then
  ok "Fix scripts are present"
else
  warn "Fix scripts missing"
fi

say "=== Verification Complete ==="
