#!/usr/bin/env bash
# k3d: fix "address already in use" / "API server not ready" and get HTTP/3 (NodePort 30443) working.
#
# Problems:
#   - "k3d cluster edit --port-add 30443:30443@server:0" can fail with "address already in use"
#     and leave the cluster broken (API server not ready) because it replaces the serverlb node.
#   - Something on the host may already be binding 30443, 6443, or the serverlb's port (e.g. 55617).
#
# This script: (1) finds what is using k3d-related ports, (2) suggests recovery, (3) or recreates cluster with 30443.
#
# Usage: ./scripts/k3d-fix-30443-or-recover.sh
#   FIX_ONLY=1     only print what is using ports and suggest fixes (no cluster stop/delete)
#   RECREATE=1     after checks, delete cluster and recreate with k3d-create-2-node-cluster.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

cd "$REPO_ROOT"

say "=== k3d port check and recovery ==="
info "Cluster: $CLUSTER_NAME"
echo ""

# Ports k3d uses: API 6443, serverlb often 55617 or similar, Caddy NodePort 30443
say "1. Checking what is using k3d-related ports (6443, 30443, 55617)..."
for port in 6443 30443 55617 80 443; do
  if command -v lsof >/dev/null 2>&1; then
    _pids=$(lsof -i :"$port" -t 2>/dev/null || true)
    if [[ -n "$_pids" ]]; then
      warn "Port $port is in use:"
      lsof -i :"$port" 2>/dev/null | head -20 || true
    else
      ok "Port $port: free"
    fi
  else
    info "Port $port: (lsof not available, skip)"
  fi
done

say "2. k3d NodePort 30443 (TCP + UDP) — required for HTTP/3..."
if [[ -f "$SCRIPT_DIR/verify-k3d-30443-udp.sh" ]]; then
  "$SCRIPT_DIR/verify-k3d-30443-udp.sh" || true
else
  info "Run: docker port k3d-${CLUSTER_NAME}-serverlb — expect 30443/tcp and 30443/udp"
fi

say "3. k3d node and container state..."
docker ps -a --filter "name=k3d-${CLUSTER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

# If serverlb is Exited, try to start it (quick recovery)
if docker ps -a --filter "name=k3d-${CLUSTER_NAME}-serverlb" --format "{{.Status}}" 2>/dev/null | grep -q "Exited"; then
  warn "serverlb is Exited — attempting: docker start k3d-${CLUSTER_NAME}-serverlb"
  docker start "k3d-${CLUSTER_NAME}-serverlb" 2>/dev/null && ok "serverlb started; run kubectl get nodes to verify API" || warn "serverlb start failed; try option C (recreate)"
fi

say "4. Recovery options"
echo "  A) If API server is not ready after a failed 'k3d cluster edit':"
echo "     Try: k3d cluster stop $CLUSTER_NAME && sleep 5 && k3d cluster start $CLUSTER_NAME"
echo "     Then: kubectl get nodes (wait for Ready)"
echo ""
echo "  B) If 'address already in use' when adding 30443:"
echo "     Free the port (stop the process from step 1), or do not add 30443 and use port-forward 8443 for HTTP/2 only."
echo "     To get HTTP/3 reliably: recreate the cluster so 30443 is included at create time (option C)."
echo ""
echo "  C) Recreate cluster with 30443 (TCP + UDP) published from the start (required for HTTP/3/QUIC):"
echo "     k3d cluster delete $CLUSTER_NAME"
echo "     ./scripts/k3d-create-2-node-cluster.sh   # now includes --port 30443:30443/udp@server:0"
echo "     Then: deploy workloads, MetalLB if needed, and run preflight/suites."
echo ""
echo "  D) If API works but HTTP/3 still fails (curl exit 7): k3d --port defaults to TCP only; QUIC needs UDP."
echo "     Ensure (1) Caddy svc has nodePort 30443 for both https (TCP) and https-udp (UDP)."
echo "     (2) k3d must publish BOTH: 30443 (TCP) and 30443 (UDP). Recreate with k3d-create-2-node-cluster.sh (option C)."
echo "     Check Caddy: kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[*].nodePort}'"
echo ""

if [[ "${RECREATE:-0}" == "1" ]]; then
  say "5. Recreating cluster (RECREATE=1)..."
  k3d cluster delete "$CLUSTER_NAME" 2>/dev/null || true
  sleep 2
  "$SCRIPT_DIR/k3d-create-2-node-cluster.sh"
  ok "Cluster recreated with 30443 published. Next: deploy workloads, then run preflight/suites."
  exit 0
fi

if [[ "${FIX_ONLY:-0}" != "1" ]]; then
  info "Run with RECREATE=1 to delete and recreate the cluster with ./scripts/k3d-create-2-node-cluster.sh (includes 30443 TCP+UDP)."
  info "Run with FIX_ONLY=1 to only print port usage and options (no cluster changes)."
  info "Root cause and rebuild checklist: docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md"
fi
ok "Done. Use option A/B/C above as needed."
