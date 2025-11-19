#!/usr/bin/env bash
set -euo pipefail

NS="record-platform"
NS_ING="ingress-nginx"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Setting up gRPC and Observability ==="

# Step 1: Deploy Jaeger
say "Step 1: Deploying Jaeger for distributed tracing..."
kubectl apply -f infra/k8s/base/observability/jaeger-deploy.yaml
kubectl -n "$NS" wait --for=condition=Ready pod -l app=jaeger --timeout=120s 2>&1 || warn "Jaeger may still be starting"
ok "Jaeger deployed"

# Step 2: Deploy OpenTelemetry Collector
say "Step 2: Deploying OpenTelemetry Collector..."
kubectl apply -f infra/k8s/base/observability/otel-collector-deploy.yaml
kubectl -n "$NS" wait --for=condition=Ready pod -l app=otel-collector --timeout=120s 2>&1 || warn "OTel Collector may still be starting"
ok "OpenTelemetry Collector deployed"

# Step 3: Apply gRPC ingress
say "Step 3: Applying gRPC ingress configuration..."
kubectl apply -f infra/k8s/overlays/dev/ingress-grpc.yaml
ok "gRPC ingress configured"

# Step 4: Verify services
say "Step 4: Verifying observability services..."
kubectl -n "$NS" get svc jaeger otel-collector
kubectl -n "$NS" get pods -l 'app in (jaeger,otel-collector)'

say "=== Setup Complete ==="
echo ""
echo "Jaeger UI: kubectl -n $NS port-forward svc/jaeger 16686:16686"
echo "Then visit: http://localhost:16686"
echo ""
echo "gRPC endpoints:"
echo "  - /records.RecordsService/* -> records-service:50051"
echo "  - /auth.AuthService/* -> auth-service:50051"
echo ""
echo "Next steps:"
echo "1. Generate gRPC code from .proto files"
echo "2. Implement gRPC servers in services"
echo "3. Add OpenTelemetry instrumentation"
echo "4. Configure structured logging"

