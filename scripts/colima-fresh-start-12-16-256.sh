#!/usr/bin/env bash
# Full flow: (optional delete) → stop → start with 12 CPU / 16 GiB RAM / 256 GiB disk → wait → forward 6443 → stabilize → MetalLB.
# Use when 51820 crash-loop persists after recovery; a fresh VM often fixes it. After run you must re-deploy workloads (kubectl apply -k infra/k8s/base, etc.).
#
# Usage:
#   ./scripts/colima-fresh-start-12-16-256.sh           # stop + start with profile (no delete)
#   ./scripts/colima-fresh-start-12-16-256.sh --delete  # delete VM then start fresh (recommended if 51820 persists)
#
# Env: RECOVERY_WAIT=120 (default). SKIP_STABILIZE=1 to skip stabilize+metallb step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DO_DELETE=0
for arg in "$@"; do
  [[ "$arg" == "--delete" ]] && DO_DELETE=1
done

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

CPU=12
MEM=16
DISK=256
WAIT="${RECOVERY_WAIT:-120}"

say "Colima full flow: profile ${CPU} CPU / ${MEM} GiB RAM / ${DISK} GiB disk"

if ! command -v colima >/dev/null 2>&1; then
  warn "colima not found"
  exit 1
fi

# --- Stop ---
info "Stopping Colima..."
colima stop 2>/dev/null || true
ok "Colima stopped"

# --- Optional delete (fresh VM; fixes 51820 when recovery alone didn't) ---
if [[ $DO_DELETE -eq 1 ]]; then
  info "Deleting Colima VM (fresh start)..."
  echo y | colima delete 2>/dev/null || true
  ok "VM deleted"
fi

# --- Start with profile (--vm-type=vz for Apple Silicon; omit on Intel if needed) ---
info "Starting Colima with Kubernetes (${CPU} CPU, ${MEM} GiB RAM, ${DISK} GiB disk)..."
colima start --with-kubernetes --vm-type=vz --cpu "$CPU" --memory "$MEM" --disk "$DISK"
ok "Colima started"

# --- Wait for k3s ---
info "Waiting ${WAIT}s for k3s API to stabilize..."
sleep "$WAIT"

# --- Forward 6443 ---
info "Re-forwarding 6443 to host..."
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true

# --- Retry API ---
info "Checking API (retries 1–6, 15s apart)..."
for i in 1 2 3 4 5 6; do
  if kubectl get nodes --request-timeout=15s 2>/dev/null; then
    ok "API reachable (attempt $i)"
    break
  fi
  [[ $i -eq 6 ]] && { warn "kubectl get nodes still failing. Try: colima ssh -- kubectl get nodes"; exit 1; }
  sleep 15
done

# --- Stabilize + MetalLB (unless skipped) ---
if [[ "${SKIP_STABILIZE:-0}" -eq 1 ]]; then
  info "Skipping stabilize+metallb (SKIP_STABILIZE=1). Run: ./scripts/stabilize-then-metallb.sh --metallb"
else
  say "Running stabilize then MetalLB..."
  "$SCRIPT_DIR/stabilize-then-metallb.sh" --metallb 2>&1 || warn "stabilize/metallb had issues; re-run: ./scripts/stabilize-then-metallb.sh --metallb"
fi

say "Done"
echo ""
info "Cross-layer diagnostic: ./scripts/colima-k3s-cross-layer-diagnostic.sh"
info "Re-deploy workloads: kubectl apply -k infra/k8s/base (and namespaces/ingress as needed)"
