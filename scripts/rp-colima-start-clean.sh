#!/usr/bin/env bash
# Z.colima_clean — native Colima start on TTY; quiet steps for align/tools/health.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
export RP_CB_REPO_ROOT="${RP_CB_REPO_ROOT:-$REPO_ROOT}"
export RP_CB_BENCH="${RP_CB_BENCH:-$REPO_ROOT/bench_logs}"
export RP_CB_DRY_RUN="${RP_COLIMA_START_DRY_RUN:-${RP_CB_DRY_RUN:-0}}"
export RP_CB_CURRENT_PHASE="${RP_CB_CURRENT_PHASE:-Z.colima_clean}"

# shellcheck source=lib/rp-cold-bootstrap-lib.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-lib.sh"

_PHASE="Z.colima_clean"
COLIMA_CPU="${COLIMA_CPU:-12}"
COLIMA_MEMORY="${COLIMA_MEMORY:-16}"
COLIMA_DISK="${COLIMA_DISK:-256}"
COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
API_WAIT_SEC="${RP_COLIMA_API_WAIT_SEC:-180}"
POST_START_SLEEP="${RP_COLIMA_POST_START_SLEEP:-90}"

_fail() {
  gate_fail "$_PHASE" "$1"
  exit 1
}

command -v colima >/dev/null 2>&1 || {
  printf '❌ colima not on PATH\n' >&2
  exit 1
}

# shellcheck source=lib/rp-colima-k3s-start-args.sh
source "$SCRIPT_DIR/lib/rp-colima-k3s-start-args.sh"

colima_args=()
rp_colima_build_start_argv colima_args "$COLIMA_CPU" "$COLIMA_MEMORY" "$COLIMA_DISK" "$COLIMA_K3S_VERSION"
rp_colima_print_start_argv colima_args

if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  exit 0
fi

if ! rp_run_native_tty "$_PHASE" colima-start colima "${colima_args[@]}"; then
  RP_COLIMA_USE_VZ=0
  colima_args=()
  rp_colima_build_start_argv colima_args "$COLIMA_CPU" "$COLIMA_MEMORY" "$COLIMA_DISK" "$COLIMA_K3S_VERSION"
  rp_colima_print_start_argv colima_args
  rp_run_native_tty "$_PHASE" colima-start-fallback colima "${colima_args[@]}" || _fail "colima start failed"
fi

if [[ "$POST_START_SLEEP" -gt 0 ]]; then
  rp_cb_countdown "$POST_START_SLEEP" "k3s to settle"
fi

_start=$(date +%s)
while true; do
  if rp_run_quiet "$_PHASE" align-kubeconfig bash "$SCRIPT_DIR/rp-align-colima-kubeconfig.sh"; then
    break
  fi
  _now=$(date +%s)
  if [[ $((_now - _start)) -ge $API_WAIT_SEC ]]; then
    _fail "k3s API not reachable after ${API_WAIT_SEC}s"
  fi
  sleep 10
done

server="$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
if [[ "$server" == *127.0.0.1* || "$server" == *localhost* || "$server" == *:6443* ]]; then
  _fail "kubeconfig must use Colima bridge API, not loopback: ${server}"
fi
printf '  ✅ kubeconfig API: %s\n' "$server"

if command -v kubectl >/dev/null 2>&1; then
  rp_run_native_tty "$_PHASE" kubectl-nodes kubectl get nodes -o wide || true
fi

export RP_CB_CURRENT_PHASE="$_PHASE"
bash "$SCRIPT_DIR/rp-install-colima-vm-tools.sh" || _fail "VM tools install failed"

if [[ -x "$SCRIPT_DIR/rp-kube-api-health.sh" ]]; then
  rp_run_quiet "$_PHASE" kube-api-health bash "$SCRIPT_DIR/rp-kube-api-health.sh" || _fail "rp-kube-api-health failed"
fi

if command -v kubectl >/dev/null 2>&1; then
  if rp_colima_verify_no_servicelb kube-system; then
    printf '  ✅ no k3s ServiceLB / svclb / klipper in kube-system\n'
  else
    _fail "k3s ServiceLB still active — see colima argv + systemctl show k3s ExecStart"
  fi
fi

export RP_COLD_BOOTSTRAP_RESET_DONE=1
printf '✅ Z.colima_clean complete\n'
