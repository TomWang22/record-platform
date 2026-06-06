#!/usr/bin/env bash
# Order of operations: stabilize API (restart k3s, wait, re-forward), then optionally install MetalLB.
# Do NOT run cert reissue or heavy applies in the same run. See docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md.
#
# Usage:
#   ./scripts/stabilize-then-metallb.sh              # stabilize only (restart k3s, wait, re-forward, re-apply tuning)
#   ./scripts/stabilize-then-metallb.sh --metallb    # stabilize then install MetalLB (pool + L2 from infra/k8s/metallb)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DO_METALLB=0
for arg in "$@"; do
  [[ "$arg" == "--metallb" ]] && DO_METALLB=1
done

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# Colima prints "colima is running" to stderr; merge streams so grep sees it
if ! colima status 2>&1 | grep -qi running; then
  warn "Colima is not running. Start with: colima start --with-kubernetes"
  exit 1
fi

# --- 1. Restart k3s (clear in-memory pressure) ---
say "1. Restarting k3s (API will be down ~30–60s)"
colima ssh -- sudo systemctl restart k3s
ok "k3s restart requested"
info "Waiting 45s for k3s to come up..."
sleep 45

# --- 2. Wait for API (in-VM first) ---
say "2. Waiting for API (in-VM)"
for i in $(seq 1 24); do
  if colima ssh -- kubectl get nodes --request-timeout=5s 2>/dev/null; then
    ok "In-VM API ready after $((i * 5))s"
    break
  fi
  [[ $i -eq 24 ]] && { warn "In-VM API not ready after 120s. Check: colima ssh -- sudo systemctl status k3s"; exit 1; }
  sleep 5
done

# --- 3. Re-apply tuning in VM (drop-in + restart k3s; avoid dependency on apply script's Colima check) ---
say "3. Re-applying k3s/etcd tuning in VM (CONSERVATIVE=1)"
colima ssh -- bash -c 'sudo mkdir -p /etc/rancher/k3s/config.yaml.d'
colima ssh -- bash -c 'echo "kube-apiserver-arg:
  - max-requests-inflight=800
  - max-mutating-requests-inflight=100
  - default-watch-cache-size=200
etcd-arg:
  - quota-backend-bytes=8589934592
  - max-request-bytes=1572864
  - snapshot-count=50000" | sudo tee /etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml > /dev/null'
colima ssh -- sudo systemctl restart k3s
ok "Tuning drop-in written; k3s restarted"
info "Waiting 50s for API after tuning restart..."
sleep 50

# --- 4. Re-forward 6443 so host kubectl works (kill stale tunnel so we use current k3s port) ---
say "4. Re-establishing tunnel (6443)"
pkill -f "ssh.*-L.*6443:127.0.0.1" 2>/dev/null || true
rm -f "${HOME}/.colima/default/colima-6443-tunnel.pid" 2>/dev/null || true
sleep 2
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true
sleep 3
if kubectl get nodes --request-timeout=10s 2>/dev/null; then
  ok "Host kubectl: API reachable"
else
  warn "Host kubectl still unreachable. Use in-VM for next steps: colima ssh -- kubectl ..."
fi

# --- 5. Optional: install MetalLB (pool + L2 from repo) ---
if [[ $DO_METALLB -eq 1 ]]; then
  say "5. Installing MetalLB (pool + L2 from infra/k8s/metallb)"
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    "$SCRIPT_DIR/install-metallb.sh" 2>&1 || warn "MetalLB install failed (API may have flaked). Re-run when stable: ./scripts/install-metallb.sh"
  else
    warn "Skipping MetalLB (host kubectl not reachable). When API is stable run: ./scripts/install-metallb.sh"
  fi
else
  say "5. Skipping MetalLB (run with --metallb to install)"
  info "When ready: ./scripts/stabilize-then-metallb.sh --metallb   or   ./scripts/install-metallb.sh"
fi

say "Done"
echo ""
info "Next: run preflight with in-VM cert step to avoid tunnel: REISSUE_STEP2_VIA_SSH=1 ./scripts/run-preflight-with-telemetry.sh"
info "Analyze every layer: docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md"
info "Cross-layer diagnostic: ./scripts/colima-k3s-cross-layer-diagnostic.sh"
