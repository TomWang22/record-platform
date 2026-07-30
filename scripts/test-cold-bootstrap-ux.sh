#!/usr/bin/env bash
# UX regression: main bootstrap output must not contain phase JSON or raw k3s teardown trace.
#
# Usage:
#   bash scripts/test-cold-bootstrap-ux.sh
#   bash scripts/test-cold-bootstrap-ux.sh /tmp/rp-ux.log
#   COLD_BOOTSTRAP_CONFIRM=yes COLD_BOOTSTRAP_DRY_RUN_UX=1 make cold-bootstrap > /tmp/rp-ux.log 2>&1
#   bash scripts/test-cold-bootstrap-ux.sh /tmp/rp-ux.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG="${1:-}"
_fail=0

_forbidden_main_patterns=(
  '^\+ ip link'
  '^\+ iptables'
  '^\+ rm -rf /var/lib/cni'
  'k3s-uninstall\.sh'
  'do_unmount_and_remove'
  'ip netns delete'
)

_check_main_log() {
  local log="$1"
  [[ -f "$log" ]] || { echo "❌ missing log: $log" >&2; return 1; }

  if grep -qE '"enter":|"completed":|"prerequisites":' "$log"; then
    echo "❌ phase-guard JSON in main output" >&2
    grep -nE '"enter":|"completed":|"prerequisites":' "$log" | head -10 >&2
    return 1
  fi

  if ! grep -q '"allowed_order"' "$log"; then
    echo "❌ missing bootstrap_allowed_order JSON on stdout (RP plan shape)" >&2
    return 1
  fi

  local pat
  for pat in "${_forbidden_main_patterns[@]}"; do
    if grep -qE "$pat" "$log"; then
      echo "❌ forbidden k3s teardown trace in main output (pattern: $pat)" >&2
      grep -nE "$pat" "$log" | head -5 >&2
      return 1
    fi
  done

  for phase in A.workspace P1.host_deps P0.hard_reset Z.colima_clean B.crypto; do
    if ! grep -q "\\[${phase}\\]" "$log"; then
      echo "❌ missing phase header [${phase}]" >&2
      return 1
    fi
  done

  if grep -q 'cold-bootstrap INCOMPLETE' "$log" && ! grep -q 'exit 2' "$REPO_ROOT/scripts/cold-bootstrap.sh"; then
    echo "❌ log shows INCOMPLETE but script missing exit 2" >&2
    return 1
  fi

  if grep -q '\[P0\] HARD RESET' "$log"; then
    echo "❌ nested bootstrap [P0] HARD RESET in main output" >&2
    return 1
  fi

  if grep -q 'still running' "$log"; then
    echo "❌ heartbeat spam in main output (RP_BOOTSTRAP_HEARTBEAT_SEC should default to 0)" >&2
    return 1
  fi

  if [[ "${COLD_BOOTSTRAP_SKIP_COLIMA_RESET:-0}" != "1" ]]; then
    if ! grep -qE '▶ kill jobs|▶ colima-stop|command-logs/P0\.hard_reset/' "$log"; then
      echo "❌ missing P0 quiet steps (expected kill-jobs / colima-stop in main output or command-logs)" >&2
      return 1
    fi
  fi

  return 0
}

_test_log_routing() {
  local bench="${REPO_ROOT}/bench_logs"
  export RP_CB_REPO_ROOT="$REPO_ROOT"
  export RP_CB_BENCH="$bench"
  export RP_CB_DRY_RUN=0
  export RP_CB_CURRENT_PHASE="ux-test"
  export RP_BOOTSTRAP_HEARTBEAT_SEC=1

  # shellcheck source=lib/rp-cold-bootstrap-lib.sh
  source "$SCRIPT_DIR/lib/rp-cold-bootstrap-lib.sh"

  local out
  out="$(mktemp "${TMPDIR:-/tmp}/rp-log-routing.XXXXXX")"
  if ! rp_run_logged "ux-test" "99-spam" "log routing test" bash -c \
    'echo "+ ip link delete fake"; echo "k3s-uninstall.sh trace"; sleep 2' >"$out" 2>&1; then
    :
  fi

  if grep -qE '^\+ ip link|k3s-uninstall' "$out"; then
    echo "❌ log routing: k3s trace leaked to terminal" >&2
    cat "$out" >&2
    rm -f "$out"
    return 1
  fi

  local step_log="${bench}/command-logs/ux-test/99-spam.log"
  if [[ ! -f "$step_log" ]] || ! grep -q '+ ip link delete fake' "$step_log"; then
    echo "❌ log routing: spam not captured in $step_log" >&2
    rm -f "$out"
    return 1
  fi

  rm -f "$out"
  echo "✅ log routing unit check (terminal clean, details in command log)"
  return 0
}

_test_log_routing || _fail=1

if [[ -z "$LOG" ]]; then
  LOG="$(mktemp "${TMPDIR:-/tmp}/rp-cold-bootstrap-ux.XXXXXX")"
  export COLD_BOOTSTRAP_DRY_RUN="${COLD_BOOTSTRAP_DRY_RUN_UX:-1}"
  export COLD_BOOTSTRAP_SKIP_COLIMA_RESET=1
  export COLD_BOOTSTRAP_CONFIRM=yes
  export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-backups/hybrid-rp-och/materialized-rp-runtime}"
  make cold-bootstrap >"$LOG" 2>&1 || true
  echo "Generated dry-run log: $LOG"
fi

_check_main_log "$LOG" || _fail=1

if [[ $_fail -ne 0 ]]; then
  echo "Log: $LOG" >&2
  exit 1
fi

echo "✅ cold-bootstrap UX smoke test passed"
echo "   log: $LOG"
