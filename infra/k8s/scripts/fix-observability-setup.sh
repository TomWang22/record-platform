#!/usr/bin/env bash
# Fix observability stack setup (Linkerd, Jaeger, Prometheus, Grafana, OTEL, New Relic)
# Ensures all components are properly configured and injected

set -euo pipefail

NS="record-platform"
OBS_NS="observability"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Fixing Observability Stack Setup ==="

# Step 1: Check if Linkerd is installed
say "Step 1: Checking Linkerd installation..."
if command -v linkerd >/dev/null 2>&1; then
  if linkerd check --quiet 2>/dev/null; then
    ok "Linkerd is installed and healthy"
    LINKERD_INSTALLED=true
  else
    warn "Linkerd is installed but not healthy. Run: linkerd check"
    LINKERD_INSTALLED=false
  fi
else
  warn "Linkerd CLI not found. Linkerd may not be installed."
  LINKERD_INSTALLED=false
fi

# Step 2: Enable Linkerd injection for record-platform namespace
if [[ "$LINKERD_INSTALLED" == "true" ]]; then
  say "Step 2: Enabling Linkerd injection for $NS namespace..."
  if kubectl get namespace "$NS" >/dev/null 2>&1; then
    kubectl annotate namespace "$NS" linkerd.io/inject=enabled --overwrite
    ok "Linkerd injection enabled for $NS namespace"
  else
    warn "Namespace $NS does not exist. Creating it..."
    kubectl create namespace "$NS"
    kubectl annotate namespace "$NS" linkerd.io/inject=enabled
    ok "Created namespace $NS with Linkerd injection enabled"
  fi
else
  warn "Skipping Linkerd injection (Linkerd not installed)"
fi

# Step 3: Ensure observability namespace exists with Linkerd injection
say "Step 3: Setting up observability namespace..."
if kubectl get namespace "$OBS_NS" >/dev/null 2>&1; then
  kubectl annotate namespace "$OBS_NS" linkerd.io/inject=enabled --overwrite 2>/dev/null || true
  ok "Observability namespace exists"
else
  kubectl create namespace "$OBS_NS"
  kubectl annotate namespace "$OBS_NS" linkerd.io/inject=enabled
  ok "Created observability namespace with Linkerd injection"
fi

# Step 4: Apply observability stack
say "Step 4: Applying observability stack..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"
if kubectl apply -k infra/k8s/base/observability; then
  ok "Observability stack applied"
else
  fail "Failed to apply observability stack"
fi

# Step 5: Fix OTEL Collector - wait for Jaeger to be ready
say "Step 5: Waiting for Jaeger to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/jaeger -n "$OBS_NS" || warn "Jaeger not ready yet"

# Step 6: Restart OTEL Collector to pick up new config
say "Step 6: Restarting OTEL Collector..."
kubectl rollout restart deployment/otel-collector -n "$OBS_NS" || warn "OTEL Collector restart failed"
kubectl wait --for=condition=available --timeout=120s deployment/otel-collector -n "$OBS_NS" || warn "OTEL Collector not ready yet"

# Step 7: Fix auth-service Linkerd injection
if [[ "$LINKERD_INSTALLED" == "true" ]]; then
  say "Step 7: Fixing auth-service Linkerd injection..."
  if kubectl get deployment auth-service -n "$NS" >/dev/null 2>&1; then
    # Check if already injected
    if kubectl get deployment auth-service -n "$NS" -o yaml | grep -q "linkerd.io/inject"; then
      ok "Auth-service already has Linkerd annotation"
    else
      # Inject Linkerd
      kubectl get deployment auth-service -n "$NS" -o yaml | \
        linkerd inject - | kubectl apply -f -
      ok "Linkerd injected into auth-service"
      
      # Wait for rollout
      kubectl rollout status deployment/auth-service -n "$NS" --timeout=120s || warn "Auth-service rollout taking longer than expected"
    fi
  else
    warn "Auth-service deployment not found"
  fi
fi

# Step 8: Verify all services
say "Step 8: Verifying observability components..."

check_pod() {
  local name=$1
  local namespace=$2
  if kubectl get pod -l app="$name" -n "$namespace" -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running; then
    ok "$name is running in $namespace"
    return 0
  else
    warn "$name is not running in $namespace"
    return 1
  fi
}

check_pod jaeger "$OBS_NS"
check_pod prometheus "$OBS_NS"
check_pod grafana "$OBS_NS"
check_pod otel-collector "$OBS_NS"

# Step 9: Check New Relic secret
say "Step 9: Checking New Relic configuration..."
if kubectl get secret newrelic-secret -n "$OBS_NS" >/dev/null 2>&1; then
  if kubectl get secret newrelic-secret -n "$OBS_NS" -o jsonpath='{.data.license-key}' 2>/dev/null | base64 -d | grep -q "YOUR_NEW_RELIC_LICENSE_KEY_HERE"; then
    warn "New Relic secret has placeholder value. Update it with:"
    echo "  kubectl create secret generic newrelic-secret \\"
    echo "    --from-literal=license-key='YOUR_ACTUAL_KEY' \\"
    echo "    -n $OBS_NS --dry-run=client -o yaml | kubectl apply -f -"
  else
    ok "New Relic secret is configured"
  fi
else
  warn "New Relic secret not found (optional - only needed if using New Relic)"
fi

# Step 10: Summary
say "=== Observability Stack Fix Complete ==="
echo ""
ok "Summary:"
echo "  - Linkerd injection: $([ "$LINKERD_INSTALLED" == "true" ] && echo "Enabled" || echo "Not installed")"
echo "  - Observability namespace: Configured"
echo "  - Jaeger: $(check_pod jaeger "$OBS_NS" >/dev/null 2>&1 && echo "Running" || echo "Not running")"
echo "  - Prometheus: $(check_pod prometheus "$OBS_NS" >/dev/null 2>&1 && echo "Running" || echo "Not running")"
echo "  - Grafana: $(check_pod grafana "$OBS_NS" >/dev/null 2>&1 && echo "Running" || echo "Not running")"
echo "  - OTEL Collector: $(check_pod otel-collector "$OBS_NS" >/dev/null 2>&1 && echo "Running" || echo "Not running")"
echo ""
say "Next steps:"
echo "  1. Verify auth-service: kubectl get pods -n $NS -l app=auth-service"
echo "  2. Check Linkerd: linkerd check"
echo "  3. View Jaeger: kubectl port-forward -n $OBS_NS svc/jaeger 16686:16686"
echo "  4. View Grafana: kubectl port-forward -n $OBS_NS svc/grafana 3000:3000"
echo "  5. View Prometheus: kubectl port-forward -n $OBS_NS svc/prometheus 9090:9090"

