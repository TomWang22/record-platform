#!/usr/bin/env bash
# Quick diagnostic: from the node (VM), curl HTTP/2 to NodePort and to LB IP.
# Proves Caddy and MetalLB are fine; if host QUIC still fails, the forwarder layer is the problem.
# See docs/QUIC_VERIFICATION_CHECKLIST.md
#
# Usage: ./scripts/verify-quic-diagnostic-in-vm.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${NS_ING:-ingress-nginx}"

echo "=== QUIC diagnostic (from node = inside VM) ==="
echo "HTTP/2 only (in-cluster curl has no HTTP/3); 200 = Caddy + path OK."
echo ""

NP=$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | head -1 || echo "32449")
LB=$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

if [[ -z "$LB" ]]; then
  echo "No LoadBalancer IP; skipping LB IP test. Install MetalLB and ensure caddy-h3 has EXTERNAL-IP."
fi

echo "1. HTTP/2 from node to NodePort $NP (kube-proxy → Caddy)"
CODE=$(kubectl -n "$NS" run quic-diag-np --rm -i --restart=Never --image=curlimages/curl:latest --overrides='{"spec":{"hostNetwork":true}}' -- \
  curl -k -sS -o /dev/null -w '%{http_code}' --http2 -H 'Host: record.local' "https://127.0.0.1:${NP}/_caddy/healthz" 2>/dev/null || echo "000")
echo "   → $CODE"
echo ""

if [[ -n "$LB" ]]; then
  echo "2. HTTP/2 from node to LB IP $LB (MetalLB L2 → Caddy)"
  CODE=$(kubectl -n "$NS" run quic-diag-lb --rm -i --restart=Never --image=curlimages/curl:latest --overrides='{"spec":{"hostNetwork":true}}' -- \
    curl -k -sS -o /dev/null -w '%{http_code}' --http2 --resolve "record.local:443:$LB" https://record.local/_caddy/healthz 2>/dev/null || echo "000")
  echo "   → $CODE"
  echo ""
  echo "If both 200 but host QUIC fails → forwarder (socat/NodePort) is the problem. Use bridged mode for real L2."
else
  echo "2. Skipped (no LB IP)"
fi
echo "See docs/QUIC_VERIFICATION_CHECKLIST.md"
