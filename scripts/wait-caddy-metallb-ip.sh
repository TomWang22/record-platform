#!/usr/bin/env bash
# Wait until caddy-h3 has a real MetalLB LoadBalancer IP, then stop for manual /etc/hosts update.
#
# Usage: bash scripts/wait-caddy-metallb-ip.sh
# Env: NS_ING (default ingress-nginx), RP_PAUSE_EXIT_CODE (default 0)
set -euo pipefail

NS_ING="${NS_ING:-ingress-nginx}"
RP_PAUSE_EXIT_CODE="${RP_PAUSE_EXIT_CODE:-0}"

echo "Waiting for caddy-h3 MetalLB IP..."
for i in {1..120}; do
  METALLB_IP="$(kubectl get svc -n "$NS_ING" caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "$METALLB_IP" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "CADDY METALLB IP GATE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "CADDY_METALLB_IP=$METALLB_IP"
    echo
    kubectl get svc -n "$NS_ING" caddy-h3 -o wide 2>/dev/null || true
    echo
    echo "sudo sed -i '' '/record-platform.test/d' /etc/hosts"
    echo "sudo sed -i '' '/record-platform.test/d' /etc/hosts"
    echo "echo '$METALLB_IP record-platform.test' | sudo tee -a /etc/hosts"
    echo
    echo "A–I complete. Intentional pause before J.final_contract (browser/host edge proof)."
    echo "After /etc/hosts is updated, run:"
    echo "  COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap-post-hosts"
    echo "Or: HOSTS_AUTO=1 COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit "$RP_PAUSE_EXIT_CODE"
  fi
  sleep 5
done

echo "ERROR: caddy-h3 MetalLB IP was not assigned"
kubectl get svc -n "$NS_ING" caddy-h3 -o wide
exit 1
