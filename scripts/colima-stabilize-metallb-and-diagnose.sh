#!/usr/bin/env bash
# End-to-end: wait for k3s (with optional restarts), apply etcd/k3s tuning in-VM, re-forward 6443,
# install MetalLB (controller + speaker + pool + L2), then run cross-layer diagnostic.
# Does not touch Postgres or host Docker. Use after Colima is running (e.g. after colima-fix-control-plane-for-good.sh).
#
# Usage:
#   ./scripts/colima-stabilize-metallb-and-diagnose.sh
#   SKIP_METALLB=1   skip MetalLB install (tuning + diagnostic only)
#   SKIP_TUNE=1      skip k3s/etcd tuning
#   SKIP_DIAGNOSTIC=1 skip cross-layer diagnostic at end

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

SKIP_METALLB="${SKIP_METALLB:-0}"
SKIP_TUNE="${SKIP_TUNE:-0}"
SKIP_DIAGNOSTIC="${SKIP_DIAGNOSTIC:-0}"
# Wait up to 6 min for in-VM API; restart k3s every 2 min if not ready, max 3 restarts
WAIT_API_SEC="${WAIT_API_SEC:-360}"
K3S_RESTART_INTERVAL="${K3S_RESTART_INTERVAL:-120}"
K3S_RESTART_MAX="${K3S_RESTART_MAX:-3}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

say "Stabilize control plane + MetalLB + cross-layer diagnostic"
info "No Postgres or host Docker touched. Colima/k3s and MetalLB only."
echo ""

if ! colima status 2>&1 | grep -qi running; then
  warn "Colima is not running. Start with: ./scripts/colima-fix-control-plane-for-good.sh"
  exit 1
fi

# --- 1. Wait for in-VM API (with optional k3s restarts to break 51820 loop) ---
say "1. Waiting for k3s API (in-VM; up to ${WAIT_API_SEC}s, restart k3s every ${K3S_RESTART_INTERVAL}s if needed, max ${K3S_RESTART_MAX} restarts)"
start=$(date +%s)
restarts=0
while true; do
  if colima ssh -- kubectl get nodes --request-timeout=15s 2>/dev/null; then
    _sub=$(colima ssh -- systemctl show k3s -p SubState --value 2>/dev/null || echo "")
    if [[ "$_sub" == "running" ]]; then
      ok "In-VM API reachable and k3s SubState=running"
      break
    fi
    info "API responded but k3s SubState=$_sub; continuing to wait..."
  fi
  now=$(date +%s)
  elapsed=$((now - start))
  if [[ $elapsed -ge $WAIT_API_SEC ]]; then
    warn "In-VM API not ready after ${WAIT_API_SEC}s. Try full teardown: ./scripts/colima-fix-control-plane-for-good.sh"
    exit 1
  fi
  # Every K3S_RESTART_INTERVAL seconds, try restarting k3s once (up to K3S_RESTART_MAX)
  if [[ $restarts -lt $K3S_RESTART_MAX ]] && [[ $elapsed -ge $(( (restarts + 1) * K3S_RESTART_INTERVAL )) ]]; then
    restarts=$((restarts + 1))
    info "Restarting k3s (attempt $restarts/$K3S_RESTART_MAX) to try to clear 51820..."
    colima ssh -- sudo systemctl restart k3s 2>/dev/null || true
    sleep 90
  fi
  sleep 20
done

# --- 2. Apply k3s/etcd tuning in-VM (no dependency on host apply script) ---
if [[ "$SKIP_TUNE" != "1" ]]; then
  say "2. Applying k3s/etcd tuning in-VM (CONSERVATIVE=1)"
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
  info "Waiting 60s for API after tuning..."
  sleep 60
else
  say "2. Skipping tuning (SKIP_TUNE=1)"
fi

# --- 3. Re-forward 6443 and ensure host kubectl works ---
say "3. Re-establishing tunnel 127.0.0.1:6443"
pkill -f "ssh.*-L.*6443:127.0.0.1" 2>/dev/null || true
rm -f "${HOME}/.colima/default/colima-6443-tunnel.pid" 2>/dev/null || true
sleep 2
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if kubectl get nodes --request-timeout=15s 2>/dev/null; then
    ok "Host kubectl: API reachable"
    break
  fi
  [[ $i -eq 12 ]] && { warn "Host kubectl still unreachable. MetalLB install may use colima ssh for applies."; }
  sleep 10
done

# --- 4. Install MetalLB (controller, speaker, pool, L2) ---
if [[ "$SKIP_METALLB" != "1" ]]; then
  say "4. Installing MetalLB (controller + speaker + pool + L2)"
  if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    "$SCRIPT_DIR/install-metallb.sh" 2>&1 || warn "MetalLB install had issues; re-run when API is stable: ./scripts/install-metallb.sh"
  else
    info "Host API not reachable; trying MetalLB install via in-VM kubectl..."
    colima ssh -- bash -c "kubectl get ns metallb-system --request-timeout=5s 2>/dev/null" || true
    # Install manifest via colima ssh if host kubectl fails
    METALLB_VERSION="${METALLB_VERSION:-v0.14.3}"
    METALLB_URL="https://raw.githubusercontent.com/metallb/metallb/${METALLB_VERSION}/config/manifests/metallb-native.yaml"
    if ! colima ssh -- kubectl get ns metallb-system --request-timeout=5s 2>/dev/null; then
      colima ssh -- "kubectl apply -f $METALLB_URL --request-timeout=90s" 2>/dev/null || warn "MetalLB apply failed in-VM"
    fi
    warn "MetalLB may be partial. When host API is up run: ./scripts/install-metallb.sh"
  fi
else
  say "4. Skipping MetalLB (SKIP_METALLB=1)"
fi

# --- 5. Cross-layer diagnostic ---
if [[ "$SKIP_DIAGNOSTIC" != "1" ]] && [[ -x "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" ]]; then
  say "5. Cross-layer diagnostic"
  "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" 2>&1 | tee /tmp/colima-cross-layer-$(date +%Y%m%d-%H%M%S).txt || true
else
  say "5. Skipping diagnostic (SKIP_DIAGNOSTIC=1 or script missing)"
fi

say "Done"
echo ""
info "Summary: k3s tuned; MetalLB installed (if not skipped); cross-layer diagnostic above."
info "Next: kubectl apply -k infra/k8s/base --validate=ignore  then  ./scripts/run-preflight-k6-only-when-api-ready.sh"
info "MetalLB: kubectl -n metallb-system get pods; kubectl get svc -A | grep LoadBalancer"
