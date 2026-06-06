#!/usr/bin/env bash
# Diagnose Colima: is k3s running? Is the API reachable? Ready for MetalLB + real L2?
# Usage: ./scripts/colima-check-k3s-and-l2.sh
# See docs/COLIMA-K3S-METALLB-PRIMARY.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Colima + k3s + L2 diagnostic ==="
echo ""

# 1. Colima status
echo "--- Colima status ---"
if ! command -v colima &>/dev/null; then
  echo "colima not found in PATH"
  exit 1
fi
colima status 2>&1 || true
echo ""

# Optional: colima list shows runtime (docker vs docker+k3s) and network
if colima list 2>/dev/null | head -20; then
  echo ""
fi

# 2. Is k3s running inside the VM?
echo "--- k3s in VM ---"
k3s_active=""
if colima ssh -- systemctl is-active k3s 2>/dev/null | grep -q "active"; then
  k3s_active=1
  echo "k3s: active (systemctl)"
elif colima ssh -- "pgrep -x k3s 2>/dev/null" 2>/dev/null | grep -q .; then
  k3s_active=1
  echo "k3s: running (process)"
else
  echo "k3s: not running or not installed"
fi
echo ""

# 3. Kubeconfig
echo "--- Kubeconfig ---"
ctx=$(kubectl config current-context 2>/dev/null || true)
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
echo "Context: ${ctx:-<none>}"
echo "Server:  ${server:-<none>}"
if [[ -n "$server" ]] && [[ "$server" != "https://127.0.0.1:"* ]]; then
  echo "         ^ VM IP in kubeconfig — Mac may not route. Run: ./scripts/colima-fix-kubeconfig-localhost.sh"
fi
echo ""

# 4. API reachable?
echo "--- API reachable ---"
api_ok=0
if kubectl get nodes --request-timeout=5s &>/dev/null; then
  api_ok=1
  echo "Yes. Nodes:"
  kubectl get nodes 2>/dev/null || true
else
  echo "No (connection refused or no route to host)"
fi
echo ""

# 5. Summary and next steps
echo "=== Summary and next steps ==="
if [[ -z "$k3s_active" ]]; then
  echo "Colima is running but k3s is not. For MetalLB and real L2 you need k3s + bridged networking."
  echo "  Run: COLIMA_NETWORK_ADDRESS=1 ./scripts/colima-start-k3s-bridged.sh"
  echo "  (This stops Colima, starts with --kubernetes and --network-address, waits for API.)"
  exit 0
fi
if [[ $api_ok -eq 0 ]]; then
  echo "k3s is running but the API is unreachable (often: stale kubeconfig port after Colima restart)."
  echo "  1) Run: ./scripts/colima-fix-kubeconfig-localhost.sh   (refreshes port then fixes host), then: kubectl get nodes"
  echo "  If still failing: colima stop; COLIMA_NETWORK_ADDRESS=1 ./scripts/colima-start-k3s-bridged.sh"
  exit 0
fi
echo "Colima + k3s is up and API is reachable."
echo "  For MetalLB + real L2: METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/colima-metallb-bring-up.sh"
echo "  If you later see 'connection refused' or metallb-system has no pods: ./scripts/colima-recover-and-bring-up.sh"
