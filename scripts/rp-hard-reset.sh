#!/usr/bin/env bash
# P0.hard_reset — quiet teardown (internals in bench_logs/command-logs/P0.hard_reset/*.log).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
export RP_CB_REPO_ROOT="${RP_CB_REPO_ROOT:-$REPO_ROOT}"
export RP_CB_BENCH="${RP_CB_BENCH:-$REPO_ROOT/bench_logs}"
export RP_CB_DRY_RUN="${RP_HARD_RESET_DRY_RUN:-${RP_CB_DRY_RUN:-0}}"
export RP_CB_CURRENT_PHASE="${RP_CB_CURRENT_PHASE:-P0.hard_reset}"

# shellcheck source=lib/rp-cold-bootstrap-lib.sh
source "$SCRIPT_DIR/lib/rp-cold-bootstrap-lib.sh"

_PHASE="P0.hard_reset"

if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
  printf '  [dry-run] P0 hard reset steps\n'
  exit 0
fi

command -v colima >/dev/null 2>&1 || {
  printf '❌ colima not on PATH\n' >&2
  exit 1
}

rp_run_quiet "$_PHASE" kill-jobs bash "$SCRIPT_DIR/dev-kill-all.sh"
rm -f "${HOME}/.kube/config.colima-forward" 2>/dev/null || true
rp_run_quiet "$_PHASE" colima-factory-reset bash -c '
  colima stop 2>/dev/null || true
  colima delete -f 2>/dev/null || true
  rm -rf "${HOME}/.colima"
  command -v kubectl >/dev/null 2>&1 || exit 0
  kubectl config get-contexts -o name 2>/dev/null | while read -r ctx; do
    case "$ctx" in colima|colima-*|docker-desktop|kind-*)
      kubectl config delete-context "$ctx" 2>/dev/null || true
      ;;
    esac
  done
  kubectl config delete-cluster colima 2>/dev/null || true
  kubectl config delete-user colima 2>/dev/null || true
  true
'
printf '  ✅ colima factory reset complete\n'
rm -rf "${REPO_ROOT}/.build-cache" 2>/dev/null || true
printf '  ℹ️  cleared .build-cache (P0 wiped Colima Docker — runtime builds happen in E.build_images)\n'
printf '✅ P0 hard reset complete\n'
