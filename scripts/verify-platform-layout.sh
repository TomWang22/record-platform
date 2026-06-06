#!/usr/bin/env bash
# Verify platform layout: ingress-nginx (2 Caddy), envoy-test (1 Envoy), record-platform (services + exporters), external (Redis/Kafka/ZK/Postgres).
# Usage: ./scripts/verify-platform-layout.sh
set -euo pipefail

echo "=== k8s: ingress-nginx (2 Caddy H3) ==="
kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide 2>/dev/null || echo "  (namespace or pods not found)"
echo ""
echo "=== k8s: envoy-test (1 Envoy) ==="
kubectl get pods -n envoy-test -o wide 2>/dev/null || echo "  (namespace or pods not found)"
echo ""
echo "=== k8s: record-platform (services + exporters) ==="
kubectl get pods -n record-platform --sort-by=.metadata.name -o wide 2>/dev/null | head -40 || echo "  (namespace or pods not found)"
echo ""
echo "=== External (Docker): Redis, Kafka, Zookeeper, 8 Postgres ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -E 'redis|kafka|zookeeper|postgres' || echo "  (docker not running or no matching containers)"
echo ""
echo "Pods are in ingress-nginx, envoy-test, record-platform — not in default. Use: kubectl get pods -n <namespace>"
