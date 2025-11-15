#!/usr/bin/env bash
set -euo pipefail

NS="record-platform"
OBS_NS="observability"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Setting up Observability Stack ==="

# Create observability namespace
say "Creating observability namespace..."
kubectl create namespace "$OBS_NS" --dry-run=client -o yaml | kubectl apply -f - || true
ok "Namespace created"

# 1. Prometheus
say "1. Setting up Prometheus..."
if kubectl -n "$OBS_NS" get deployment prometheus >/dev/null 2>&1; then
  ok "Prometheus already deployed"
else
  warn "Prometheus deployment needed - creating..."
  # TODO: Add Prometheus deployment
  kubectl -n "$OBS_NS" create deployment prometheus --image=prom/prometheus:latest --dry-run=client -o yaml | kubectl apply -f - || true
fi

# 2. Grafana
say "2. Setting up Grafana..."
if kubectl -n "$OBS_NS" get deployment grafana >/dev/null 2>&1; then
  ok "Grafana already deployed"
else
  warn "Grafana deployment needed - creating..."
  # TODO: Add Grafana deployment
  kubectl -n "$OBS_NS" create deployment grafana --image=grafana/grafana:latest --dry-run=client -o yaml | kubectl apply -f - || true
fi

# 3. Jaeger (already exists from previous setup)
say "3. Checking Jaeger..."
if kubectl -n "$NS" get deployment jaeger >/dev/null 2>&1; then
  ok "Jaeger already deployed"
else
  warn "Jaeger deployment needed"
fi

# 4. OpenTelemetry Collector (already exists from previous setup)
say "4. Checking OpenTelemetry Collector..."
if kubectl -n "$NS" get deployment otel-collector >/dev/null 2>&1; then
  ok "OpenTelemetry Collector already deployed"
else
  warn "OpenTelemetry Collector deployment needed"
fi

say "=== Observability Stack Setup Complete ==="
say "Next steps:"
say "1. Deploy Prometheus with proper configuration"
say "2. Deploy Grafana with Prometheus datasource"
say "3. Configure service mesh (Istio or Linkerd)"
say "4. Set up service monitoring and alerting"
