#!/usr/bin/env bash
set -euo pipefail

# Comprehensive script to ensure all observability components are running
# Components: Linkerd, Istio, Prometheus, Grafana, Jaeger, OpenTelemetry, New Relic

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

NS="record-platform"
OBS_NS="observability"
MON_NS="monitoring"
LINKERD_NS="linkerd"
ISTIO_NS="istio-system"

say "=== Ensuring Observability Stack is Running ==="

# Check kubectl connectivity
say "Step 1: Checking kubectl connectivity..."
if ! kubectl get nodes >/dev/null 2>&1; then
  fail "kubectl cannot connect to cluster"
  say "Troubleshooting:"
  echo "  1. Check cluster container: docker ps | grep h3-control-plane"
  echo "  2. Restart cluster: docker restart h3-control-plane"
  echo "  3. Wait 30-45s for cluster to stabilize"
  echo "  4. Run: kubectl get nodes"
  exit 1
fi
ok "kubectl connectivity OK"

# Step 2: Install/Verify Prometheus & Grafana (Helm)
say "Step 2: Ensuring Prometheus & Grafana are installed..."
if ! kubectl get namespace "$MON_NS" >/dev/null 2>&1; then
  kubectl create namespace "$MON_NS"
  ok "Created namespace: $MON_NS"
fi

if ! helm list -n "$MON_NS" | grep -q monitoring; then
  warn "Prometheus/Grafana not installed via Helm. Installing..."
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null
  
  helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
    --namespace "$MON_NS" \
    --set grafana.adminPassword='Admin123!' \
    --set grafana.service.type=ClusterIP \
    --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
    --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
    --wait --timeout=5m || warn "Helm install had issues"
  ok "Prometheus/Grafana installed"
else
  ok "Prometheus/Grafana already installed"
fi

# Wait for CRDs
say "Waiting for Prometheus CRDs..."
for i in {1..30}; do
  if kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Step 3: Ensure observability namespace and components
say "Step 3: Ensuring observability namespace and components..."
if ! kubectl get namespace "$OBS_NS" >/dev/null 2>&1; then
  kubectl create namespace "$OBS_NS"
  ok "Created namespace: $OBS_NS"
fi

# Apply observability stack
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if kubectl apply -k "$SCRIPT_DIR/infra/k8s/base/observability" 2>&1; then
  ok "Observability stack applied"
else
  warn "Some observability resources may have failed to apply"
fi

# Step 4: Install/Verify Linkerd
say "Step 4: Ensuring Linkerd is installed..."
if command -v linkerd >/dev/null 2>&1; then
  if kubectl get namespace "$LINKERD_NS" >/dev/null 2>&1; then
    if linkerd check --quiet 2>/dev/null; then
      ok "Linkerd is installed and healthy"
    else
      warn "Linkerd is installed but not healthy. Run: linkerd check"
    fi
  else
    warn "Linkerd namespace not found. Installing Linkerd..."
    if [ -f "$SCRIPT_DIR/infra/k8s/scripts/install-linkerd.sh" ]; then
      bash "$SCRIPT_DIR/infra/k8s/scripts/install-linkerd.sh" || warn "Linkerd installation had issues"
    else
      warn "Linkerd install script not found"
    fi
  fi
  
  # Enable Linkerd injection for namespaces
  if kubectl get namespace "$NS" >/dev/null 2>&1; then
    kubectl annotate namespace "$NS" linkerd.io/inject=enabled --overwrite 2>/dev/null || true
    ok "Linkerd injection enabled for $NS"
  fi
  kubectl annotate namespace "$OBS_NS" linkerd.io/inject=enabled --overwrite 2>/dev/null || true
else
  warn "Linkerd CLI not found. Install it to enable service mesh:"
  echo "  curl -sL https://run.linkerd.io/install-edge | sh"
  echo "  export PATH=\$PATH:\$HOME/.linkerd2/bin"
fi

# Step 5: Install/Verify Istio
say "Step 5: Ensuring Istio is installed..."
if command -v istioctl >/dev/null 2>&1; then
  if kubectl get namespace "$ISTIO_NS" >/dev/null 2>&1; then
    ok "Istio namespace exists"
    ISTIO_PODS=$(kubectl get pods -n "$ISTIO_NS" --no-headers 2>/dev/null | grep -c Running || echo "0")
    if [ "$ISTIO_PODS" -gt 0 ]; then
      ok "Istio is installed ($ISTIO_PODS pods running)"
    else
      warn "Istio namespace exists but no pods running"
    fi
  else
    warn "Istio not installed. Installing..."
    if [ -f "$SCRIPT_DIR/infra/k8s/scripts/install-istio.sh" ]; then
      bash "$SCRIPT_DIR/infra/k8s/scripts/install-istio.sh" || warn "Istio installation had issues"
    else
      warn "Istio install script not found"
    fi
  fi
else
  warn "Istio CLI not found. Install it to enable service mesh:"
  echo "  curl -sL https://istio.io/downloadIstio | sh"
  echo "  export PATH=\$PATH:\$(pwd)/istio-\$ISTIO_VERSION/bin"
fi

# Step 6: Inject Linkerd into all services
say "Step 6: Ensuring Linkerd sidecar injection..."
if command -v linkerd >/dev/null 2>&1 && kubectl get namespace "$LINKERD_NS" >/dev/null 2>&1; then
  if [ -f "$SCRIPT_DIR/infra/k8s/scripts/inject-linkerd-all-services.sh" ]; then
    bash "$SCRIPT_DIR/infra/k8s/scripts/inject-linkerd-all-services.sh" || warn "Linkerd injection had issues"
  else
    # Manual injection
    DEPLOYMENTS=$(kubectl get deployments -n "$NS" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    for DEPLOYMENT in $DEPLOYMENTS; do
      if ! kubectl get deployment "$DEPLOYMENT" -n "$NS" -o yaml | grep -q "linkerd.io/inject"; then
        kubectl get deployment "$DEPLOYMENT" -n "$NS" -o yaml | \
          linkerd inject - | kubectl apply -f - 2>/dev/null || true
      fi
    done
  fi
else
  warn "Skipping Linkerd injection (Linkerd not available)"
fi

# Step 7: Apply ServiceMonitors
say "Step 7: Applying ServiceMonitors..."
if [ -f "$SCRIPT_DIR/infra/k8s/base/monitoring/servicemonitors.yaml" ]; then
  kubectl apply -f "$SCRIPT_DIR/infra/k8s/base/monitoring/servicemonitors.yaml" 2>/dev/null || true
fi
if [ -f "$SCRIPT_DIR/infra/k8s/base/observability/servicemonitors.yaml" ]; then
  kubectl apply -f "$SCRIPT_DIR/infra/k8s/base/observability/servicemonitors.yaml" 2>/dev/null || true
fi
ok "ServiceMonitors applied"

# Step 8: Wait for components to be ready
say "Step 8: Waiting for components to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/otel-collector -n "$OBS_NS" 2>/dev/null || warn "OTEL Collector not ready yet"
kubectl wait --for=condition=available --timeout=120s deployment/jaeger -n "$OBS_NS" 2>/dev/null || warn "Jaeger not ready yet"

# Step 9: Verify New Relic configuration
say "Step 9: Checking New Relic configuration..."
if kubectl get secret newrelic-secret -n "$OBS_NS" >/dev/null 2>&1; then
  NEW_RELIC_KEY=$(kubectl get secret newrelic-secret -n "$OBS_NS" -o jsonpath='{.data.license-key}' 2>/dev/null | base64 -d || echo "")
  if [[ "$NEW_RELIC_KEY" == "YOUR_NEW_RELIC_LICENSE_KEY_HERE" ]] || [[ -z "$NEW_RELIC_KEY" ]]; then
    warn "New Relic secret has placeholder value. Update it:"
    echo "  kubectl create secret generic newrelic-secret \\"
    echo "    --from-literal=license-key='YOUR_ACTUAL_KEY' \\"
    echo "    -n $OBS_NS --dry-run=client -o yaml | kubectl apply -f -"
  else
    ok "New Relic secret is configured"
  fi
else
  warn "New Relic secret not found (optional)"
fi

# Step 10: Status summary
say "=== Observability Stack Status ==="
echo
echo "📊 Component Status:"
PROM_PODS=$(kubectl get pods -n "$MON_NS" -l app.kubernetes.io/name=prometheus --no-headers 2>/dev/null | grep -c Running || echo "0")
GRAFANA_PODS=$(kubectl get pods -n "$MON_NS" -l app.kubernetes.io/name=grafana --no-headers 2>/dev/null | grep -c Running || echo "0")
JAEGER_PODS=$(kubectl get pods -n "$OBS_NS" -l app=jaeger --no-headers 2>/dev/null | grep -c Running || echo "0")
OTEL_PODS=$(kubectl get pods -n "$OBS_NS" -l app=otel-collector --no-headers 2>/dev/null | grep -c Running || echo "0")
LINKERD_PODS=$(kubectl get pods -n "$LINKERD_NS" --no-headers 2>/dev/null | grep -c Running || echo "0")
ISTIO_PODS=$(kubectl get pods -n "$ISTIO_NS" --no-headers 2>/dev/null | grep -c Running || echo "0")

echo "  Prometheus:    $PROM_PODS running"
echo "  Grafana:       $GRAFANA_PODS running"
echo "  Jaeger:        $JAEGER_PODS running"
echo "  OTEL Collector: $OTEL_PODS running"
echo "  Linkerd:       $LINKERD_PODS running"
echo "  Istio:         $ISTIO_PODS running"
echo

# Check sidecar injection
say "Sidecar Injection Status:"
INJECTED_PODS=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | awk '$2 ~ /2\/2/ {count++} END {print count+0}' || echo "0")
TOTAL_PODS=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "$TOTAL_PODS" -gt 0 ]; then
  echo "  Pods with sidecars: $INJECTED_PODS / $TOTAL_PODS"
  if [ "$INJECTED_PODS" -eq "$TOTAL_PODS" ]; then
    ok "All pods have sidecars"
  else
    warn "Some pods missing sidecars"
  fi
else
  warn "No pods found in $NS namespace"
fi
echo

say "🔗 Quick Access Commands:"
echo "  Grafana:       kubectl -n $MON_NS port-forward svc/monitoring-grafana 3000:80"
echo "  Prometheus:    kubectl -n $MON_NS port-forward svc/monitoring-kube-prom-prometheus 9090:9090"
echo "  Jaeger:        kubectl -n $OBS_NS port-forward svc/jaeger 16686:16686"
echo "  OTEL Collector: kubectl -n $OBS_NS port-forward svc/otel-collector 4317:4317"
if [ "$LINKERD_PODS" -gt 0 ]; then
  echo "  Linkerd Viz:   linkerd viz dashboard"
fi
if [ "$ISTIO_PODS" -gt 0 ]; then
  echo "  Istio Kiali:   istioctl dashboard kiali"
fi
echo

say "✅ Observability stack check complete!"
say "Run verification: bash infra/k8s/scripts/verify-observability.sh"

