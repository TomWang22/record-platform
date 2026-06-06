#!/usr/bin/env bash
# One-shot fix for the control plane: full teardown, start with 12 CPU / 16 GiB RAM / 256 GiB disk,
# wait for API, apply etcd/k3s tuning (optional), then verify. Use when API keeps derailing tests or k3s is activating/crash-looping.
#
# Locked profile: 12 CPU, 16 GiB RAM, 256 GiB disk (per docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md and user target).
#
# Usage:
#   ./scripts/colima-fix-control-plane-for-good.sh              # teardown + start 12/16/256 + tune + verify
#   SKIP_TUNE=1 ./scripts/colima-fix-control-plane-for-good.sh  # skip etcd/k3s tuning (faster; still 12/16/256)
#   SKIP_DIAGNOSTIC=1 ./scripts/colima-fix-control-plane-for-good.sh  # skip cross-layer diagnostic at end

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# Locked profile so control plane has enough headroom and doesn't derail tests.
COLIMA_CPU="${COLIMA_CPU:-12}"
COLIMA_MEMORY="${COLIMA_MEMORY:-16}"
COLIMA_DISK="${COLIMA_DISK:-256}"
TEARDOWN_API_WAIT="${TEARDOWN_API_WAIT:-240}"
SKIP_TUNE="${SKIP_TUNE:-0}"
SKIP_DIAGNOSTIC="${SKIP_DIAGNOSTIC:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

say "Fix control plane for good — profile ${COLIMA_CPU} CPU / ${COLIMA_MEMORY} GiB RAM / ${COLIMA_DISK} GiB disk"
info "Full teardown (delete VM) → start with locked profile → wait for API → optional tuning → verify."
echo ""

# --- 1. Teardown + start (uses colima-teardown-and-start.sh env) ---
export COLIMA_CPU COLIMA_MEMORY COLIMA_DISK TEARDOWN_API_WAIT
say "Step 1/4: Full teardown + start (profile ${COLIMA_CPU}/${COLIMA_MEMORY}GiB/${COLIMA_DISK}GiB; API wait ${TEARDOWN_API_WAIT}s)..."
"$SCRIPT_DIR/colima-teardown-and-start.sh" 2>&1 || { warn "Teardown+start failed; see above"; exit 1; }
ok "Colima up with 12/16/256"
sleep 5

# --- 2. Apply etcd/k3s tuning (reduces write amplification and 503 under load) ---
# Default: AGGRESSIVE=1 so single node can handle MetalLB and applies without struggling as badly.
# If 503 persists, re-run with CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh
K3S_TUNE="${K3S_TUNE:-aggressive}"
if [[ "$SKIP_TUNE" == "1" ]]; then
  info "Skipping etcd/k3s tuning (SKIP_TUNE=1). To apply later: AGGRESSIVE=1 ./scripts/apply-k3s-etcd-tuning.sh or CONSERVATIVE=1 for stricter queueing."
else
  say "Step 2/4: Applying etcd/k3s tuning (${K3S_TUNE})..."
  if [[ "$K3S_TUNE" == "conservative" ]]; then
    _TUNE_CMD="CONSERVATIVE=1 $SCRIPT_DIR/apply-k3s-etcd-tuning.sh"
  else
    _TUNE_CMD="AGGRESSIVE=1 $SCRIPT_DIR/apply-k3s-etcd-tuning.sh"
  fi
  if eval "$_TUNE_CMD" 2>&1; then
    ok "Tuning applied (k3s may restart; wait ~60s if you see connection refused)"
    info "Waiting 60s for k3s to settle after tuning..."
    sleep 60
    "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
  else
    warn "Tuning failed or skipped (API may not be ready). Re-run when API is up: AGGRESSIVE=1 ./scripts/apply-k3s-etcd-tuning.sh (or CONSERVATIVE=1 if 503 persists)."
  fi
fi

# --- 3. Re-check API ---
say "Step 3/4: Re-checking API..."
for i in 1 2 3 4 5 6 7 8; do
  if kubectl get nodes --request-timeout=15s 2>/dev/null; then
    ok "API reachable"
    break
  fi
  [[ $i -eq 8 ]] && { warn "API still not reachable. Run: ./scripts/colima-diagnose-when-api-down.sh"; exit 1; }
  sleep 10
done

# --- 4. Cross-layer diagnostic (optional) ---
if [[ "$SKIP_DIAGNOSTIC" != "1" ]] && [[ -x "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" ]]; then
  say "Step 4/4: Cross-layer diagnostic..."
  "$SCRIPT_DIR/colima-k3s-cross-layer-diagnostic.sh" 2>&1 | head -80
else
  say "Step 4/4: Skipping full diagnostic (SKIP_DIAGNOSTIC=1 or script missing)"
fi

say "Done — control plane fixed for good (12/16/256)"
echo ""
info "Next: Re-deploy workloads and run preflight with k6 (no pgbench):"
echo "  kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s"
echo "  ./scripts/run-preflight-k6-only-when-api-ready.sh"
echo "  # or: RUN_FULL_LOAD=0 RUN_K6=1 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh"
echo ""
info "When API is flaky again: ./scripts/colima-diagnose-when-api-down.sh  then re-run this script if needed."
