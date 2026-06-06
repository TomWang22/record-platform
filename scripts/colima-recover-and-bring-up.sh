#!/usr/bin/env bash
# Recover from stale kubeconfig (connection refused) and get Colima + MetalLB + cluster up.
# Use when: kubectl gets "connection refused" to 127.0.0.1:PORT, or metallb-system has no pods.
# 1) Refresh kubeconfig from Colima and fix host → 127.0.0.1
# 2) Verify API reachable
# 3) Install MetalLB (apply manifest, wait for pods + webhook, apply pool/L2)
# 4) Bring up cluster (namespaces, TLS, kustomize, Caddy LB)
# Usage:
#   ./scripts/colima-recover-and-bring-up.sh
#   METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/colima-recover-and-bring-up.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export METALLB_POOL="${METALLB_POOL:-192.168.5.240-192.168.5.250}"

echo "=== Colima recover: kubeconfig → MetalLB → bring-up ==="
echo ""

# 1) Fix kubeconfig (stale port or VM IP)
echo "1) Refreshing kubeconfig and fixing API host..."
[[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
[[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true

# 2) Verify API
echo "2) Checking API..."
_api_ok=0
for _t in 1 2 3 4 5; do
  if kubectl get nodes --request-timeout=10s &>/dev/null; then
    _api_ok=1
    break
  fi
  echo "   API unreachable, retrying in 5s..."
  [[ $_t -lt 5 ]] && sleep 5
done
if [[ $_api_ok -eq 0 ]]; then
  echo "Cannot reach API. Run: ./scripts/colima-fix-kubeconfig-localhost.sh   then retry. If Colima was stopped, run: ./scripts/colima-start-and-ready.sh  (uses --network-address). Full bridged: ./scripts/colima-start-k3s-bridged-clean.sh"
  exit 1
fi
echo "   API OK"
echo ""

# 3) MetalLB (idempotent; creates pods if missing, applies pool/L2)
echo "3) Installing MetalLB and applying pool..."
"$SCRIPT_DIR/install-metallb-colima.sh"
echo ""

# 4) Bring up cluster
echo "4) Bringing up cluster..."
"$SCRIPT_DIR/bring-up-colima-cluster.sh"

echo ""
echo "=== Done. If you see 'connection refused' again later, run: ./scripts/colima-fix-kubeconfig-localhost.sh   then your command."
echo "   Caddy LB: kubectl -n ingress-nginx get svc caddy-h3"
