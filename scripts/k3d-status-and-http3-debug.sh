#!/usr/bin/env bash
# One-shot status: k3d nodes, registry (127.0.0.1:5000), Caddy svc, UDP 30443, and HTTP/3 path checklist.
# Usage: ./scripts/k3d-status-and-http3-debug.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-record-platform}"
REG_PORT="${REG_PORT:-5000}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

echo "=== k3d status + HTTP/3 debug (cluster: $CLUSTER_NAME) ==="

# Nodes
say "1. Nodes"
kubectl get nodes --request-timeout=10s 2>/dev/null || warn "kubectl get nodes failed"
# Registry
say "2. Registry (127.0.0.1:${REG_PORT})"
REG_CODE="000"
REG_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:${REG_PORT}/v2/" 2>/dev/null || echo "000")
if [[ "$REG_CODE" == "200" ]] || [[ "$REG_CODE" == "401" ]]; then
  ok "Registry reachable ($REG_CODE)"
else
  warn "Registry not reachable (code $REG_CODE). Start: docker start k3d-${CLUSTER_NAME}-registry  or run ./scripts/k3d-registry-push-and-patch.sh"
fi
# Caddy service
say "3. Caddy service (ingress-nginx)"
kubectl get svc caddy-h3 -n ingress-nginx -o wide 2>/dev/null || warn "caddy-h3 not found"
LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
[[ -n "$LB_IP" ]] && info "Caddy EXTERNAL-IP (MetalLB): $LB_IP"
# UDP 30443
say "4. UDP 30443 (HTTP/3)"
"$SCRIPT_DIR/verify-k3d-30443-udp.sh" "$CLUSTER_NAME" 2>/dev/null || warn "Run: $SCRIPT_DIR/verify-k3d-30443-udp.sh $CLUSTER_NAME"
# HTTP/3 path
say "5. HTTP/3 path checklist"
echo "  - NodePort: NGTCP2_ENABLE_GSO=0 curl --http3-only -k --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz"
[[ -n "$LB_IP" ]] && echo "  - LB IP: sudo LB_IP=$LB_IP NODEPORT=30443 $SCRIPT_DIR/setup-lb-ip-host-access.sh  then curl --http3-only -k --resolve record.local:443:$LB_IP https://record.local/_caddy/healthz"
echo "  - Docs: docs/HTTP3-CURL-EXIT-CODES.md, docs/HTTP3-LB-IP-FIX-CHECKLIST.md"
