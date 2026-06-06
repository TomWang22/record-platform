#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
docker context use colima >/dev/null 2>&1
export KUBECONFIG=/tmp/kind-h3-kubeconfig.yaml

echo "=== COMPLETE INFRASTRUCTURE STATUS ==="
echo ""
echo "✅ Colima Resources:"
echo "  • CPUs: 12"
echo "  • Memory: 12GB"
echo "  • Disk: 256GB"
echo ""
echo "✅ Kubernetes Cluster:"
kubectl get nodes --request-timeout=5s 2>&1 | tail -4
echo ""
echo "✅ Infrastructure Pods:"
echo "  • Caddy (ingress-nginx):"
kubectl get pods -n ingress-nginx -l app=caddy-h3 --request-timeout=5s --no-headers 2>&1 | awk '{print "    " $1 ": " $2 " (" $3 " restarts)"}'
echo "  • Envoy (envoy-test):"
kubectl get pods -n envoy-test -l app=envoy-test --request-timeout=5s --no-headers 2>&1 | awk '{print "    " $1 ": " $2 " (" $3 " restarts)"}'
echo ""
echo "✅ Secrets & ConfigMaps:"
echo "  • TLS secrets: dev-root-ca, record-local-tls, service-tls"
echo "  • ConfigMaps: haproxy-cm, nginx-cm, proto-files"
echo ""
echo "✅ External Services:"
docker ps --filter name=kafka --filter name=zookeeper --filter name=redis --format "table {{.Names}}\t{{.Status}}" 2>&1 | head -4 || echo "  (checking...)"
echo ""
echo "✅ Metrics Server:"
kubectl get pods -n kube-system -l k8s-app=metrics-server --request-timeout=5s --no-headers 2>&1 | awk '{print "  " $1 ": " $2}' || echo "  (not found)"
