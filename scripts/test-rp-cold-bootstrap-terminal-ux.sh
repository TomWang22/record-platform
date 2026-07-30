#!/usr/bin/env bash
# Terminal/runner UX regression for RP cold-bootstrap (RP execution model).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

_fail=0
_bump() { echo "❌ $*" >&2; _fail=1; }

_lib="$REPO_ROOT/scripts/lib/rp-cold-bootstrap-lib.sh"
_cb="$REPO_ROOT/scripts/cold-bootstrap.sh"
_p0="$REPO_ROOT/scripts/rp-hard-reset.sh"
_z="$REPO_ROOT/scripts/rp-colima-start-clean.sh"

grep -q 'rp_run_quiet()' "$_lib" || _bump "missing rp_run_quiet in rp-cold-bootstrap-lib.sh"
grep -q 'rp_run_native_tty()' "$_lib" || _bump "missing rp_run_native_tty in rp-cold-bootstrap-lib.sh"
grep -q 'rp_is_tty()' "$_lib" || _bump "missing rp_is_tty in rp-cold-bootstrap-lib.sh"

grep -q 'exec > >(tee' "$_lib" && _bump "rp-cold-bootstrap-lib.sh must not exec tee (breaks Colima TTY)"
grep -q 'rp_cb_setup_full_log' "$_lib" || _bump "missing rp_cb_setup_full_log"

grep -q 'COLD_BOOTSTRAP_COLOR' "$_cb" || _bump "cold-bootstrap.sh should set COLD_BOOTSTRAP_COLOR"
grep -qE 'COLD_BOOTSTRAP_FORCE_COLOR=\$\{COLD_BOOTSTRAP_FORCE_COLOR:-1\}' "$_cb" && \
  _bump "cold-bootstrap.sh must not default COLD_BOOTSTRAP_FORCE_COLOR=1"
if head -25 "$_lib" | grep -qE '^export FORCE_COLOR=1'; then
  _bump "rp-cold-bootstrap-lib.sh must not unconditionally export FORCE_COLOR=1 at top"
fi

grep -q 'rp_run_quiet' "$_p0" || _bump "rp-hard-reset.sh must use rp_run_quiet"
grep -q 'rp_run_logged.*Colima+k3s start' "$_z" && _bump "rp-colima-start-clean must not use rp_run_logged for colima start"
grep -q 'rp_run_native_tty' "$_z" "$_p0" || _bump "Z/P0 scripts must reference rp_run_native_tty where needed"
grep -q 'rp_run_native_tty.*colima-start' "$_z" || _bump "colima start must use rp_run_native_tty"

# Phase order in source (RP: A → P1 → P0 → Z)
_an=$(grep -n 'rp_cb_phase_enter A.workspace' "$_cb" | head -1 | cut -d: -f1)
_p1n=$(grep -n 'rp_cb_phase_enter P1.host_deps' "$_cb" | head -1 | cut -d: -f1)
_p0n=$(grep -n 'rp_cb_phase_enter P0.hard_reset' "$_cb" | head -1 | cut -d: -f1)
_zn=$(grep -n 'rp_cb_phase_enter Z.colima_clean' "$_cb" | head -1 | cut -d: -f1)
[[ -n "$_an" && -n "$_p1n" && -n "$_p0n" && -n "$_zn" ]] || _bump "missing phase enter lines in cold-bootstrap.sh"
if [[ -n "$_an" && -n "$_p1n" && -n "$_p0n" && -n "$_zn" ]]; then
  if [[ "$_an" -ge "$_p1n" ]] || [[ "$_p1n" -ge "$_p0n" ]] || [[ "$_p0n" -ge "$_zn" ]]; then
    _bump "phase order in cold-bootstrap.sh: A@$_an P1@$_p1n P0@$_p0n Z@$_zn"
  fi
fi
grep -q 'rp_run_native' "$_cb" || _bump "cold-bootstrap.sh should use rp_run_native for workspace/pnpm"

# Dry-run log shape (bash entry — avoid make overhead; skip slow kubectl gates)
LOG="$(mktemp "${TMPDIR:-/tmp}/rp-cb-term-ux.XXXXXX")"
export COLD_BOOTSTRAP_DRY_RUN=1
export COLD_BOOTSTRAP_SKIP_COLIMA_RESET=1
export COLD_BOOTSTRAP_SKIP_GATES=1
export COLD_BOOTSTRAP_CONFIRM=yes
export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-backups/hybrid-rp-och/materialized-rp-runtime}"
perl -e 'alarm shift; exec @ARGV' 90 bash "$REPO_ROOT/scripts/cold-bootstrap.sh" >"$LOG" 2>&1 || true

[[ -f "$REPO_ROOT/bench_logs/cold-bootstrap.full.log" ]] || \
  _bump "cold-bootstrap must write bench_logs/cold-bootstrap.full.log"

for pat in '^\+ ip link' '^\+ iptables' 'k3s-uninstall\.sh' 'k3s-killall\.sh' 'do_unmount_and_remove'; do
  if grep -qE "$pat" "$LOG"; then
    _bump "forbidden k3s trace in dry-run main output: $pat"
    grep -nE "$pat" "$LOG" | head -3 >&2
  fi
done

grep -q '\[P0\.hard_reset\]' "$LOG" || _bump "dry-run log missing [P0.hard_reset]"
grep -q 'rp_run_native_tty' "$_z" || true

if [[ $_fail -ne 0 ]]; then
  echo "Log: $LOG" >&2
  exit 1
fi
echo "✅ cold-bootstrap terminal UX checks passed"
echo "   log: $LOG"
