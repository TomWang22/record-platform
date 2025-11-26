#!/usr/bin/env bash
set -euo pipefail

# Comprehensive observability stack installer
# Installs: Prometheus, Grafana, Jaeger, OpenTelemetry Collector, Linkerd

bold() {
  echo -e "\033[1m$1\033[0m"
}

step() {
  echo
  bold ">>> $1"
}

error() {
  echo -e "\033[31m✗ $1\033[0m" >&2
  exit 1
}

CLUSTER="${KIND_CLUSTER:-h3}"
NAMESPACE="record-platform"
OBSERVABILITY_NS="observability"

step "Installing comprehensive observability stack..."

# 1. Install/Upgrade kube-prometheus-stack (Prometheus + Grafana)
step "1. Installing kube-prometheus-stack (Prometheus + Grafana)"
kubectl create ns monitoring 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update >/dev/null

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set grafana.adminPassword='Admin123!' \
  --set grafana.service.type=ClusterIP \
  --set grafana.persistence.enabled=true \
  --set grafana.persistence.size=10Gi \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.storageClassName=standard \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=50Gi \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
  --wait --timeout=5m || error "Failed to install kube-prometheus-stack"

# Wait for CRDs
step "Waiting for Prometheus CRDs to be available..."
for i in {1..60}; do
  if kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1 && \
     kubectl get crd podmonitors.monitoring.coreos.com >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# 2. Create observability namespace and deploy components
step "2. Creating observability namespace and deploying components..."
kubectl create ns "$OBSERVABILITY_NS" 2>/dev/null || true

# Apply observability resources
kubectl apply -k infra/k8s/base/observability || error "Failed to apply observability resources"

# 3. Wait for observability components
step "3. Waiting for observability components to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/otel-collector -n "$OBSERVABILITY_NS" || true
kubectl wait --for=condition=available --timeout=300s deployment/jaeger -n "$OBSERVABILITY_NS" || true

# 4. Apply ServiceMonitors and PodMonitors
step "4. Applying ServiceMonitors and PodMonitors..."
kubectl apply -f infra/k8s/base/monitoring/servicemonitors.yaml || true
kubectl apply -f infra/k8s/base/observability/servicemonitors.yaml || true
kubectl apply -f infra/k8s/base/observability/podmonitors.yaml || true

# 5. Install Service Mesh (Linkerd or Istio - choose one)
step "5. Installing service mesh (Linkerd or Istio)..."
SERVICE_MESH="${SERVICE_MESH:-linkerd}"

if [[ "$SERVICE_MESH" == "istio" ]]; then
  echo "Installing Istio service mesh..."
  if command -v istioctl &> /dev/null; then
    if ! kubectl get namespace istio-system 2>/dev/null; then
      bash infra/k8s/scripts/install-istio.sh || echo "⚠️  Istio installation had issues. Check logs."
    else
      echo "✅ Istio already installed. Skipping..."
    fi
  else
    echo "⚠️  Istio CLI not found. Install it to enable service mesh:"
    echo "   curl -sL https://istio.io/downloadIstio | sh"
    echo "   export PATH=\$PATH:\$(pwd)/istio-\$ISTIO_VERSION/bin"
    echo "   bash infra/k8s/scripts/install-istio.sh"
  fi
else
  # Default to Linkerd
  echo "Installing Linkerd service mesh..."
  if command -v linkerd &> /dev/null; then
    echo "Linkerd CLI found. Checking if Linkerd is already installed..."
    if ! kubectl get namespace linkerd 2>/dev/null; then
      echo "Installing Linkerd..."
      bash infra/k8s/scripts/install-linkerd.sh || echo "⚠️  Linkerd installation had issues. Check logs."
    else
      echo "✅ Linkerd already installed. Skipping..."
    fi
  else
    echo "⚠️  Linkerd CLI not found. Install it to enable service mesh:"
    echo "   curl -sL https://run.linkerd.io/install-edge | sh"
    echo "   export PATH=\$PATH:\$HOME/.linkerd2/bin"
    echo "   bash infra/k8s/scripts/install-linkerd.sh"
  fi
fi

# 6. Configure New Relic (if license key is provided)
step "6. Configuring New Relic integration..."
if [ -n "${NEW_RELIC_LICENSE_KEY:-}" ]; then
  kubectl create secret generic newrelic-secret \
    --from-literal=license-key="$NEW_RELIC_LICENSE_KEY" \
    -n "$OBSERVABILITY_NS" \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "✅ New Relic secret created. OTel Collector will export to New Relic."
  
  # Restart OTel Collector to pick up new secret
  kubectl rollout restart deployment/otel-collector -n "$OBSERVABILITY_NS" || true
else
  echo "⚠️  NEW_RELIC_LICENSE_KEY not set. Skipping New Relic setup."
  echo "   To enable New Relic, set the environment variable:"
  echo "     export NEW_RELIC_LICENSE_KEY='your-key-here'"
  echo "   Then run this script again or update the secret manually:"
  echo "     kubectl create secret generic newrelic-secret --from-literal=license-key='your-key' -n $OBSERVABILITY_NS"
  echo "   Then restart the OTel Collector:"
  echo "     kubectl rollout restart deployment/otel-collector -n $OBSERVABILITY_NS"
fi

# 7. Verify all components
step "7. Verifying observability components..."
echo
echo "Checking component status:"
echo "  Prometheus:    $(kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus 2>/dev/null | grep -c Running || echo '0') running"
echo "  Grafana:       $(kubectl get pods -n monitoring -l app.kubernetes.io/name=grafana 2>/dev/null | grep -c Running || echo '0') running"
echo "  Jaeger:        $(kubectl get pods -n $OBSERVABILITY_NS -l app=jaeger 2>/dev/null | grep -c Running || echo '0') running"
echo "  OTel Collector: $(kubectl get pods -n $OBSERVABILITY_NS -l app=otel-collector 2>/dev/null | grep -c Running || echo '0') running"
if [[ "$SERVICE_MESH" == "linkerd" ]]; then
  echo "  Linkerd:       $(kubectl get pods -n linkerd 2>/dev/null | grep -c Running || echo '0') running"
elif [[ "$SERVICE_MESH" == "istio" ]]; then
  echo "  Istio:         $(kubectl get pods -n istio-system 2>/dev/null | grep -c Running || echo '0') running"
fi

# 8. Summary
step "Observability stack installation complete!"
echo
bold "📊 Installed Components:"
echo "  ✅ Prometheus (metrics collection)"
echo "  ✅ Grafana (visualization)"
echo "  ✅ Jaeger (distributed tracing)"
echo "  ✅ OpenTelemetry Collector (OTLP receiver/processor)"
if [[ "$SERVICE_MESH" == "linkerd" ]]; then
  echo "  ✅ Linkerd (service mesh)"
elif [[ "$SERVICE_MESH" == "istio" ]]; then
  echo "  ✅ Istio (service mesh)"
fi
if [ -n "${NEW_RELIC_LICENSE_KEY:-}" ]; then
  echo "  ✅ New Relic (APM integration)"
else
  echo "  ⚠️  New Relic (not configured - set NEW_RELIC_LICENSE_KEY)"
fi
echo
bold "🔗 Port-forward access:"
echo "  Grafana:       kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80"
echo "  Prometheus:    kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090"
echo "  Jaeger:        kubectl -n $OBSERVABILITY_NS port-forward svc/jaeger 16686:16686"
echo "  OTel Collector: kubectl -n $OBSERVABILITY_NS port-forward svc/otel-collector 4317:4317"
if [[ "$SERVICE_MESH" == "linkerd" ]]; then
  echo "  Linkerd Viz:   linkerd viz dashboard"
elif [[ "$SERVICE_MESH" == "istio" ]]; then
  echo "  Istio Kiali:   istioctl dashboard kiali"
  echo "  Istio Grafana: istioctl dashboard grafana"
  echo "  Istio Jaeger:  istioctl dashboard jaeger"
fi
echo
bold "🔐 Grafana credentials:"
echo "  Username: admin"
echo "  Password: Admin123!"
echo
bold "🌐 Access URLs (when port-forwarding):"
echo "  Grafana:       http://localhost:3000"
echo "  Prometheus:    http://localhost:9090"
echo "  Jaeger UI:     http://localhost:16686"
echo "  OTel Collector: http://localhost:4317 (gRPC), http://localhost:4318 (HTTP)"
echo
bold "📝 Next steps:"
if [[ "$SERVICE_MESH" == "linkerd" ]]; then
  echo "  1. Enable Linkerd auto-injection for namespaces:"
  echo "     kubectl annotate namespace $NAMESPACE linkerd.io/inject=enabled"
elif [[ "$SERVICE_MESH" == "istio" ]]; then
  echo "  1. Enable Istio auto-injection for namespaces:"
  echo "     kubectl label namespace $NAMESPACE istio-injection=enabled"
fi
echo "  2. Add OpenTelemetry instrumentation to your services"
echo "     See: infra/k8s/base/observability/otel-instrumentation.md"
echo "  3. Configure Grafana dashboards for your metrics"
echo "  4. Set up alerting rules in Prometheus"
echo "  5. Configure New Relic (if not done):"
echo "     export NEW_RELIC_LICENSE_KEY='your-key'"
echo "     kubectl create secret generic newrelic-secret --from-literal=license-key=\$NEW_RELIC_LICENSE_KEY -n $OBSERVABILITY_NS"
echo "     kubectl rollout restart deployment/otel-collector -n $OBSERVABILITY_NS"

