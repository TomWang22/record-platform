#!/usr/bin/env bash
# Recover from k3s crash loop (CRD registration to 127.0.0.1:51820 refused).
# Does: colima stop → colima start --with-kubernetes [--cpu N --memory N] → wait 90s → re-forward 6443.
# Use when cross-layer diagnostic shows "k3s is CRASH-LOOPING". See docs/COLIMA_K3S_CRASH_LOOP_51820.md.
#
# Usage: ./scripts/colima-k3s-recover-from-crash-loop.sh [--no-start]
#   --no-start  Only stop Colima (you start manually with your preferred flags)
#
# Env (optional):
#   COLIMA_CPU=12 COLIMA_MEMORY=16 COLIMA_DISK=256  — pin profile on start (12 CPU, 16GiB RAM, 256GiB disk).
#   RECOVERY_WAIT=120                               — seconds to wait after start before re-forward (default 120).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

ONLY_STOP=0
for arg in "$@"; do
  [[ "$arg" == "--no-start" ]] && ONLY_STOP=1
done

say "Recover from k3s crash loop (51820 / CRD registration refused)"

if ! command -v colima >/dev/null 2>&1; then
  warn "colima not found"
  exit 1
fi

info "Stopping Colima..."
colima stop
ok "Colima stopped"

if [[ "$ONLY_STOP" -eq 1 ]]; then
  info "(--no-start) Start manually, e.g.: colima start --with-kubernetes --cpu 12 --memory 12"
  exit 0
fi

# Preserve or pin profile (12 CPU, 16GiB RAM, 256GiB disk typical). --vm-type=vz for Apple Silicon.
START_ARGS="--with-kubernetes"
if [[ "$(uname -m)" == "arm64" ]] || [[ "$(uname -m)" == "aarch64" ]]; then
  START_ARGS="--with-kubernetes --vm-type=vz"
fi
if [[ -n "${COLIMA_CPU:-}" ]] && [[ -n "${COLIMA_MEMORY:-}" ]]; then
  START_ARGS="$START_ARGS --cpu $COLIMA_CPU --memory $COLIMA_MEMORY"
  [[ -n "${COLIMA_DISK:-}" ]] && START_ARGS="$START_ARGS --disk $COLIMA_DISK"
  info "Starting Colima with Kubernetes (profile: ${COLIMA_CPU} CPU, ${COLIMA_MEMORY}GiB RAM${COLIMA_DISK:+, ${COLIMA_DISK}GiB disk})..."
else
  info "Starting Colima with Kubernetes (existing profile; set COLIMA_CPU=12 COLIMA_MEMORY=16 COLIMA_DISK=256 to pin)..."
fi
colima start $START_ARGS
ok "Colima started"

WAIT="${RECOVERY_WAIT:-120}"
info "Waiting ${WAIT}s for k3s API to stabilize (set RECOVERY_WAIT=180 if still ServiceUnavailable)..."
sleep "$WAIT"

info "Re-forwarding 6443 to host..."
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true

# Retry kubectl a few times (API can return ServiceUnavailable briefly after start)
info "Checking API (retries 1–6, 15s apart)..."
for i in 1 2 3 4 5 6; do
  if kubectl get nodes --request-timeout=15s 2>/dev/null; then
    ok "API reachable (attempt $i). Run ./scripts/colima-k3s-cross-layer-diagnostic.sh to confirm k3s is stable (section 2: ActiveState=active, SubState=running). If 51820 crash-loop persists, see docs/COLIMA_K3S_CRASH_LOOP_51820.md §3 (new Colima profile)."
    break
  fi
  [[ $i -eq 6 ]] && { warn "kubectl get nodes still failing after 6 attempts. Try: colima ssh -- kubectl get nodes (in-VM); or RECOVERY_WAIT=180; or new profile: colima delete then colima start --with-kubernetes."; break; }
  sleep 15
done

echo ""
info "Resource dissection: ./scripts/colima-k3s-resource-dissection.sh"
info "Next: CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh  or  ./scripts/stabilize-then-metallb.sh"
info "Doc: docs/COLIMA_K3S_CRASH_LOOP_51820.md"
