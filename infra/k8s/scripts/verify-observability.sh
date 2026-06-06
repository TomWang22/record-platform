#!/usr/bin/env bash
set -euo pipefail

# Comprehensive observability stack verification script
# Verifies: Prometheus, Grafana, Jaeger, OpenTelemetry, Linkerd, Istio, New Relic

bold() {
  echo -e "\033[1m$1\033[0m"
}

ok() {
  echo -e "\033[32m✅ $1\033[0m"
}

warn() {
  echo -e "\033[33m⚠️  $1\033[0m"
}

error() {
  echo -e "\033[31m❌ $1\033[0m"
}

step() {
  echo
  bold ">>> $1"
}

OBSERVABILITY_NS="observability"
MONITORING_NS="monitoring"
LINKERD_NS="linkerd"
ISTIO_NS="istio-system"

step "Verifying Observability Stack"

# 1. Prometheus
step "1. Checking Prometheus"
PROM_PODS=$(kubectl get pods -n "$MONITORING_NS" -l app.kubernetes.io/name=prometheus --no-headers 2>/dev/null | grep -c Running || echo "0")
if [ "$PROM_PODS" -gt 0 ]; then
  ok "Prometheus: $PROM_PODS pod(s) running"
else
  error "Prometheus: No running pods"
fi

# 2. Grafana
step "2. Checking Grafana"
GRAFANA_PODS=$(kubectl get pods -n "$MONITORING_NS" -l app.kubernetes.io/name=grafana --no-headers 2>/dev/null | grep Running | wc -l | tr -d ' ' || echo "0")
if [ "$GRAFANA_PODS" -gt 0 ]; then
  ok "Grafana: $GRAFANA_PODS pod(s) running"
else
  error "Grafana: No running pods"
fi

# 3. Jaeger
step "3. Checking Jaeger"
JAEGER_PODS=$(kubectl get pods -n "$OBSERVABILITY_NS" -l app=jaeger --no-headers 2>/dev/null | grep -c Running || echo "0")
if [ "$JAEGER_PODS" -gt 0 ]; then
  ok "Jaeger: $JAEGER_PODS pod(s) running"
  
  # Check OTLP ports
  JAEGER_SVC=$(kubectl get svc -n "$OBSERVABILITY_NS" jaeger -o jsonpath='{.spec.ports[?(@.name=="otlp-grpc")].port}' 2>/dev/null || echo "")
  if [ -n "$JAEGER_SVC" ] && [ "$JAEGER_SVC" = "4317" ]; then
    ok "Jaeger OTLP gRPC port: 4317 configured"
  else
    warn "Jaeger OTLP gRPC port: Not configured correctly"
  fi
  
  JAEGER_HTTP=$(kubectl get svc -n "$OBSERVABILITY_NS" jaeger -o jsonpath='{.spec.ports[?(@.name=="otlp-http")].port}' 2>/dev/null || echo "")
  if [ -n "$JAEGER_HTTP" ] && [ "$JAEGER_HTTP" = "4318" ]; then
    ok "Jaeger OTLP HTTP port: 4318 configured"
  else
    warn "Jaeger OTLP HTTP port: Not configured correctly"
  fi
else
  error "Jaeger: No running pods"
fi

# 4. OpenTelemetry Collector
step "4. Checking OpenTelemetry Collector"
OTEL_PODS=$(kubectl get pods -n "$OBSERVABILITY_NS" -l app=otel-collector --no-headers 2>/dev/null | grep -c Running || echo "0")
if [ "$OTEL_PODS" -gt 0 ]; then
  ok "OTEL Collector: $OTEL_PODS pod(s) running"
  
  # Check OTLP ports
  OTEL_GRPC=$(kubectl get svc -n "$OBSERVABILITY_NS" otel-collector -o jsonpath='{.spec.ports[?(@.name=="otlp-grpc")].port}' 2>/dev/null || echo "")
  if [ -n "$OTEL_GRPC" ] && [ "$OTEL_GRPC" = "4317" ]; then
    ok "OTEL Collector OTLP gRPC port: 4317 configured"
  else
    warn "OTEL Collector OTLP gRPC port: Not configured correctly"
  fi
  
  OTEL_HTTP=$(kubectl get svc -n "$OBSERVABILITY_NS" otel-collector -o jsonpath='{.spec.ports[?(@.name=="otlp-http")].port}' 2>/dev/null || echo "")
  if [ -n "$OTEL_HTTP" ] && [ "$OTEL_HTTP" = "4318" ]; then
    ok "OTEL Collector OTLP HTTP port: 4318 configured"
  else
    warn "OTEL Collector OTLP HTTP port: Not configured correctly"
  fi
  
  # Check OTEL Collector configuration
  OTEL_CONFIG=$(kubectl get configmap -n "$OBSERVABILITY_NS" otel-collector-config -o jsonpath='{.data.otel-collector-config\.yaml}' 2>/dev/null || echo "")
  if echo "$OTEL_CONFIG" | grep -q "otlp/jaeger"; then
    ok "OTEL Collector: Jaeger exporter configured"
  else
    warn "OTEL Collector: Jaeger exporter not found in config"
  fi
  
  if echo "$OTEL_CONFIG" | grep -q "otlp/newrelic"; then
    ok "OTEL Collector: New Relic exporter configured"
  else
    warn "OTEL Collector: New Relic exporter not found in config"
  fi
else
  error "OTEL Collector: No running pods"
fi

# 5. Linkerd
step "5. Checking Linkerd"
LINKERD_PODS=$(kubectl get pods -n "$LINKERD_NS" --no-headers 2>/dev/null | grep -c Running || echo "0")
if [ "$LINKERD_PODS" -gt 0 ]; then
  ok "Linkerd: $LINKERD_PODS pod(s) running"
  
  # Check specific components
  LINKERD_IDENTITY=$(kubectl get pods -n "$LINKERD_NS" -l app=linkerd-identity --no-headers 2>/dev/null | grep Running | wc -l | tr -d ' ' || echo "0")
  if [ "$LINKERD_IDENTITY" -gt 0 ]; then
    ok "Linkerd Identity: Running"
  else
    warn "Linkerd Identity: Not running"
  fi
  
  LINKERD_DEST=$(kubectl get pods -n "$LINKERD_NS" -l app=linkerd-destination --no-headers 2>/dev/null | grep Running | wc -l | tr -d ' ' || echo "0")
  if [ "$LINKERD_DEST" -gt 0 ]; then
    ok "Linkerd Destination: Running"
  else
    warn "Linkerd Destination: Not running"
  fi
  
  LINKERD_INJECTOR=$(kubectl get pods -n "$LINKERD_NS" -l app=linkerd-proxy-injector --no-headers 2>/dev/null | grep Running | wc -l | tr -d ' ' || echo "0")
  if [ "$LINKERD_INJECTOR" -gt 0 ]; then
    ok "Linkerd Proxy Injector: Running"
  else
    warn "Linkerd Proxy Injector: Not running"
  fi
  
  # Check namespace injection
  INJECTED_NS=$(kubectl get namespace -l linkerd.io/inject=enabled --no-headers 2>/dev/null | wc -l || echo "0")
  if [ "$INJECTED_NS" -gt 0 ]; then
    ok "Linkerd injection: Enabled on $INJECTED_NS namespace(s)"
  else
    warn "Linkerd injection: No namespaces with injection enabled"
  fi
else
  warn "Linkerd: Not installed or no running pods"
fi

# 6. Istio
step "6. Checking Istio"
ISTIO_PODS=$(kubectl get pods -n "$ISTIO_NS" --no-headers 2>/dev/null | grep -c Running || echo "0")
if [ "$ISTIO_PODS" -gt 0 ]; then
  ok "Istio: $ISTIO_PODS pod(s) running"
  
  ISTIOD=$(kubectl get pods -n "$ISTIO_NS" -l app=istiod --no-headers 2>/dev/null | grep -c Running || echo "0")
  if [ "$ISTIOD" -gt 0 ]; then
    ok "Istiod: Running"
  else
    warn "Istiod: Not running"
  fi
  
  ISTIO_INGRESS=$(kubectl get pods -n "$ISTIO_NS" -l app=istio-ingressgateway --no-headers 2>/dev/null | grep -c Running || echo "0")
  if [ "$ISTIO_INGRESS" -gt 0 ]; then
    ok "Istio Ingress Gateway: Running"
  else
    warn "Istio Ingress Gateway: Not running"
  fi
else
  warn "Istio: Not installed or no running pods"
fi

# 7. New Relic
step "7. Checking New Relic Configuration"
NEW_RELIC_SECRET=$(kubectl get secret -n "$OBSERVABILITY_NS" newrelic-secret -o jsonpath='{.data.license-key}' 2>/dev/null | base64 -d || echo "")
if [ -n "$NEW_RELIC_SECRET" ]; then
  if [ "$NEW_RELIC_SECRET" = "YOUR_KEY" ] || [ "$NEW_RELIC_SECRET" = "" ]; then
    warn "New Relic: Secret exists but contains placeholder or empty key"
  else
    ok "New Relic: Secret configured (key present)"
  fi
else
  warn "New Relic: Secret not found (optional)"
fi

# Check OTEL Collector logs for New Relic errors
NEW_RELIC_ERRORS=$(kubectl logs -n "$OBSERVABILITY_NS" -l app=otel-collector --tail=50 2>/dev/null | grep -c "newrelic.*403" || echo "0")
if [ "$NEW_RELIC_ERRORS" -gt 0 ]; then
  warn "New Relic: 403 errors detected in OTEL Collector logs (expected if license key is invalid)"
else
  ok "New Relic: No 403 errors in recent logs"
fi

# 8. Connectivity Check (with timeout to prevent hanging)
step "8. Checking Component Connectivity"
echo "Testing Jaeger OTLP endpoint..."
if timeout 30 kubectl run -n "$OBSERVABILITY_NS" --rm -i --restart=Never test-jaeger-otlp --image=curlimages/curl:latest --timeout=10s -- \
  curl -s -o /dev/null -w "%{http_code}" http://jaeger.observability.svc.cluster.local:4318/ 2>/dev/null | grep -q "404\|405\|200"; then
  ok "Jaeger OTLP HTTP endpoint: Reachable"
else
  warn "Jaeger OTLP HTTP endpoint: May not be reachable (or test timed out)"
  # Clean up any leftover pod
  kubectl delete pod test-jaeger-otlp -n "$OBSERVABILITY_NS" 2>/dev/null || true
fi

echo "Testing OTEL Collector endpoint..."
if timeout 30 kubectl run -n "$OBSERVABILITY_NS" --rm -i --restart=Never test-otel-otlp --image=curlimages/curl:latest --timeout=10s -- \
  curl -s -o /dev/null -w "%{http_code}" http://otel-collector.observability.svc.cluster.local:4318/ 2>/dev/null | grep -q "404\|405\|200"; then
  ok "OTEL Collector OTLP HTTP endpoint: Reachable"
else
  warn "OTEL Collector OTLP HTTP endpoint: May not be reachable (or test timed out)"
  # Clean up any leftover pod
  kubectl delete pod test-otel-otlp -n "$OBSERVABILITY_NS" 2>/dev/null || true
fi

# 9. Summary
step "Verification Complete"
echo
bold "📊 Summary:"
echo "  Prometheus:    $PROM_PODS running"
echo "  Grafana:       $GRAFANA_PODS running"
echo "  Jaeger:        $JAEGER_PODS running"
echo "  OTEL Collector: $OTEL_PODS running"
echo "  Linkerd:       $LINKERD_PODS running"
echo "  Istio:         $ISTIO_PODS running"
echo
bold "🔗 Quick Access:"
echo "  Jaeger UI:     kubectl port-forward -n $OBSERVABILITY_NS svc/jaeger 16686:16686"
echo "  Grafana UI:    kubectl port-forward -n $MONITORING_NS svc/monitoring-grafana 3000:80"
echo "  Prometheus UI: kubectl port-forward -n $MONITORING_NS svc/monitoring-kube-prom-prometheus 9090:9090"
if [ "$LINKERD_PODS" -gt 0 ]; then
  echo "  Linkerd Viz:   linkerd viz dashboard"
fi
if [ "$ISTIO_PODS" -gt 0 ]; then
  echo "  Istio Kiali:   istioctl dashboard kiali"
  echo "  Istio Grafana: istioctl dashboard grafana"
fi
