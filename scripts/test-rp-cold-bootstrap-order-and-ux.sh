#!/usr/bin/env bash
# RP cold-bootstrap order: A.workspace → P0 → Z → P1 → B.crypto; terminal shape; no k3s/apt spam.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG="${1:-}"
_fail=0
_bump() { echo "❌ $*" >&2; _fail=1; }

_line_of() {
  local pat="$1" file="$2"
  grep -n "$pat" "$file" 2>/dev/null | head -1 | cut -d: -f1 || true
}

_check_order_in_log() {
  local log="$1"
  local at aw p0 z p1 b
  at="$(_line_of '\[A\.toolchain\]' "$log")"
  aw="$(_line_of '\[A\.workspace\]' "$log")"
  p0="$(_line_of '\[P0\.hard_reset\]' "$log")"
  z="$(_line_of '\[Z\.colima_clean\]' "$log")"
  p1="$(_line_of '\[P1\.host_deps\]' "$log")"
  b="$(_line_of '\[B\.crypto\]' "$log")"

  [[ -n "$at" && -n "$aw" && -n "$p0" && -n "$z" && -n "$p1" && -n "$b" ]] || {
    _bump "missing phase headers (AT=$at A=$aw P0=$p0 Z=$z P1=$p1 B=$b)"
    return 1
  }
  if [[ "$at" -ge "$aw" ]] || [[ "$aw" -ge "$p0" ]] || [[ "$p0" -ge "$z" ]] || [[ "$z" -ge "$p1" ]] || [[ "$p1" -ge "$b" ]]; then
    _bump "phase order wrong: AT@$at A@$aw P0@$p0 Z@$z P1@$p1 B@$b (want AT<A<P0<Z<P1<B)"
    return 1
  fi
  return 0
}

_check_graph_order() {
  local json="$REPO_ROOT/bench_logs/bootstrap_allowed_order.json"
  mkdir -p "$REPO_ROOT/bench_logs"
  node "$SCRIPT_DIR/derive-bootstrap-order.mjs" --json-out "$json" >/dev/null
  python3 - "$json" <<'PY' || return 1
import json, sys
from pathlib import Path
d = json.loads(Path(sys.argv[1]).read_text())
order = d.get("allowed_order", [])
need = ["A.toolchain", "A.workspace", "P0.hard_reset", "Z.colima_clean", "P1.host_deps", "B.crypto"]
pos = {n: order.index(n) for n in need if n in order}
if len(pos) != len(need):
    raise SystemExit(f"missing nodes in allowed_order: {need}")
if not (pos["A.toolchain"] < pos["A.workspace"] < pos["P0.hard_reset"] < pos["Z.colima_clean"] < pos["P1.host_deps"] < pos["B.crypto"]):
    raise SystemExit(f"DAG order wrong: {need} -> {[order.index(n) for n in need]}")
PY
}

_check_forbidden_spam() {
  local log="$1"
  local pat
  for pat in \
    '^\+ ip link' '^\+ iptables' 'do_unmount_and_remove' 'k3s-killall\.sh' 'k3s-uninstall\.sh' \
    '^\+ rm -rf /var/lib/cni' 'Selecting previously unselected package' 'go: downloading'; do
    if grep -qE "$pat" "$log"; then
      _bump "forbidden spam in main output: $pat"
      grep -nE "$pat" "$log" | head -3 >&2
      return 1
    fi
  done
  return 0
}

_check_ux_shape() {
  local log="$1"
  grep -q 'allowed_order' "$log" || _bump 'dry-run log missing allowed_order JSON'
  grep -q 'Waiting 90s for k3s to settle' "$log" || _bump 'missing k3s settle countdown'
  for tool in tcpdump tshark htop strace xcaddy; do
    grep -q "$tool" "$log" || _bump "missing VM tool name: $tool"
  done
  grep -q 'Workspace bootstrap invariant' "$log" || _bump 'missing workspace invariant banner'
  grep -q 'rp_cb_setup_full_log\|RP_CB_FULL_LOG' "$REPO_ROOT/scripts/lib/rp-cold-bootstrap-lib.sh" || \
    _bump 'lib must define internal full log (bench_logs/cold-bootstrap.full.log)'
  [[ -f "$REPO_ROOT/bench_logs/cold-bootstrap.full.log" ]] || \
    _bump 'bench_logs/cold-bootstrap.full.log missing after cold-bootstrap'
  if grep -qE '^[^#]*exec > >\(tee' "$REPO_ROOT/scripts/lib/rp-cold-bootstrap-lib.sh" 2>/dev/null; then
    _bump 'lib must not exec tee on stdout'
  fi
}

_check_source_order() {
  local cb="$REPO_ROOT/scripts/cold-bootstrap.sh"
  local aw p0 z p1
  at="$(_line_of 'rp_cb_phase_enter A.toolchain' "$cb")"
  aw="$(_line_of 'rp_cb_phase_enter A.workspace' "$cb")"
  p0="$(_line_of 'rp_cb_phase_enter P0.hard_reset' "$cb")"
  z="$(_line_of 'rp_cb_phase_enter Z.colima_clean' "$cb")"
  p1="$(_line_of 'rp_cb_phase_enter P1.host_deps' "$cb")"
  if [[ -z "$at" || -z "$aw" || -z "$p0" || -z "$z" || -z "$p1" ]]; then
    _bump "cold-bootstrap.sh missing phase enter lines"
    return 1
  fi
  if [[ "$at" -ge "$aw" ]] || [[ "$aw" -ge "$p0" ]] || [[ "$p0" -ge "$z" ]] || [[ "$z" -ge "$p1" ]]; then
    _bump "cold-bootstrap.sh source order wrong: AT@$at A@$aw P0@$p0 Z@$z P1@$p1"
    return 1
  fi
}

_check_namespace_policy() {
  local cb="$REPO_ROOT/scripts/cold-bootstrap.sh"
  local ns="$REPO_ROOT/scripts/rp-clean-old-namespaces.sh"
  grep -q 'RP_FORCE_NAMESPACE_DELETE' "$cb" || _bump 'cold-bootstrap must pass RP_FORCE_NAMESPACE_DELETE to namespace script'
  grep -q 'RP_FORCE_NAMESPACE_DELETE:-0' "$cb" || _bump 'RP_FORCE_NAMESPACE_DELETE must default to 0'
  grep -q 'namespace cleanup skipped' "$ns" || _bump 'rp-clean-old-namespaces.sh must skip delete by default'
  grep -q 'RP_CLEAN_OLD_NS:-1' "$cb" && _bump 'cold-bootstrap must not default RP_CLEAN_OLD_NS=1'
  grep -q 'BOOTSTRAP_FORCE_NS_DELETE' "$REPO_ROOT/scripts/lib/rp-cold-bootstrap-lib.sh" || \
    _bump 'bootstrap cluster runner must export BOOTSTRAP_FORCE_NS_DELETE'
  if grep -qE 'kubectl delete namespace.*record-platform|Deleting stale app namespaces' "$cb"; then
    _bump 'cold-bootstrap.sh must not kubectl delete record-platform inline'
  fi
}

_check_make_bootstrap_env() {
  local cb="$REPO_ROOT/scripts/cold-bootstrap.sh"
  grep -q 'BOOTSTRAP_SKIP_RESET=1' "$cb" || _bump 'missing BOOTSTRAP_SKIP_RESET=1'
  grep -q 'BOOTSTRAP_SKIP_P0=1' "$cb" || _bump 'missing BOOTSTRAP_SKIP_P0=1'
  grep -q 'BOOTSTRAP_FULL_WIPE=0' "$cb" || _bump 'missing BOOTSTRAP_FULL_WIPE=0'
  grep -q 'source.*ensure-colima-docker-context' "$cb" || _bump 'F.cluster_deploy must source ensure-colima-docker-context.sh'
  grep -qE 'och_ensure_colima_docker_context' "$cb" || _bump 'F.cluster_deploy must call och_ensure_colima_docker_context'
  grep -qE 'env OCH_FORCE_COLIMA_DOCKER=1 och_ensure_colima_docker_context' "$cb" && \
    _bump 'F.cluster_deploy must not run och_ensure_colima_docker_context via env (shell function, not binary)'
  grep -q 'live output in log' "$REPO_ROOT/scripts/lib/rp-cold-bootstrap-lib.sh" && \
    _bump 'F.cluster_deploy must not print tail -f / live output in log hint'
  grep -q 'rp-audit-runtime-service-list' "$cb" || _bump 'cold-bootstrap must run rp-audit-runtime-service-list before C.images and F.cluster_deploy'
  grep -q 'C.image_contract' "$cb" || _bump 'cold-bootstrap must run C.image_contract before F.cluster_deploy'
  grep -q 'rp-verify-image-build-contract' "$cb" || _bump 'C.image_contract must run rp-verify-image-build-contract.sh'
  grep -q 'RP_WEBAPP_CONTRACT_MODE=static' "$cb" || _bump 'C.image_contract must use RP_WEBAPP_CONTRACT_MODE=static (no docker build during cold-bootstrap)'
  grep -q 'BOOTSTRAP_SKIP_P6_RUNTIME_IMAGES=1' "$cb" || _bump 'F.cluster_deploy must set BOOTSTRAP_SKIP_P6_RUNTIME_IMAGES=1'
  grep -q 'rp_run_native_tty.*colima-start' "$REPO_ROOT/scripts/rp-colima-start-clean.sh" || \
    _bump 'colima start must use rp_run_native_tty'
}

_check_source_order || _fail=1
_check_namespace_policy || _fail=1
_check_make_bootstrap_env || _fail=1
_check_graph_order || _fail=1

if [[ -z "$LOG" ]]; then
  LOG="$(mktemp "${TMPDIR:-/tmp}/rp-cb-order-ux.XXXXXX")"
  export COLD_BOOTSTRAP_DRY_RUN=1
  export COLD_BOOTSTRAP_SKIP_COLIMA_RESET=1
  export COLD_BOOTSTRAP_SKIP_GATES=1
  export COLD_BOOTSTRAP_CONFIRM=yes
  export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-backups/hybrid-rp-och/materialized-rp-runtime}"
  perl -e 'alarm shift; exec @ARGV' 120 bash "$REPO_ROOT/scripts/cold-bootstrap.sh" >"$LOG" 2>&1 || true
fi

_check_order_in_log "$LOG" || _fail=1
_check_forbidden_spam "$LOG" || _fail=1
_check_ux_shape "$LOG" || _fail=1

if [[ $_fail -ne 0 ]]; then
  echo "Log: $LOG" >&2
  exit 1
fi
echo "✅ cold-bootstrap order + OCH UX checks passed"
echo "   log: $LOG"
