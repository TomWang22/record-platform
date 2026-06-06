#!/usr/bin/env bash
# Record Platform bootstrap terminal UX — OCH-style colored summaries, raw logs in bench_logs/.
# Source from cold-bootstrap / cluster scripts; do not execute directly.
set -euo pipefail

RP_LOG_BENCH="${RP_LOG_BENCH:-${RP_CB_BENCH:-${REPO_ROOT:-.}/bench_logs}}"
RP_LOG_VERBOSE="${COLD_BOOTSTRAP_VERBOSE:-${RP_LOG_VERBOSE:-0}}"
RP_LOG_DRY_RUN="${RP_CB_DRY_RUN:-${RP_LOG_DRY_RUN:-0}}"
RP_LOG_PHASE_FILE="${RP_LOG_PHASE_FILE:-}"

# --- color detection (TTY, FORCE_COLOR, COLD_BOOTSTRAP_FORCE_COLOR, NO_COLOR) ---
rp_color_enabled() {
  [[ -z "${NO_COLOR:-}" ]] || return 1
  if [[ "${FORCE_COLOR:-}" == "1" || "${COLD_BOOTSTRAP_FORCE_COLOR:-}" == "1" ]]; then
    return 0
  fi
  [[ -t 1 ]]
}

_rp_c() {
  local code="$1"
  shift
  if rp_color_enabled; then
    printf '\033[%sm' "$code"
    printf '%s' "$*"
    printf '\033[0m'
  else
    printf '%s' "$*"
  fi
}

rp_info() {
  _rp_c '1;34' "$*"
  printf '\n'
}

rp_warn() {
  _rp_c '1;33' "⚠️  $*"
  printf '\n'
}

rp_error() {
  _rp_c '1;31' "❌ $*"
  printf '\n' >&2
}

rp_success() {
  _rp_c '1;32' "✅ $*"
  printf '\n'
}

rp_phase() {
  local name="$1"
  local subtitle="${2:-}"
  printf '\n'
  _rp_c '1;34' "[${name}]"
  if [[ -n "$subtitle" ]]; then
    printf ' '
    _rp_c '0' "$subtitle"
  fi
  printf '\n'
}

rp_step() {
  _rp_c '0;36' "▶ $*"
  printf '\n'
}

rp_log_init_bench() {
  mkdir -p "$RP_LOG_BENCH"
}

rp_log_set_phase_file() {
  local phase="$1"
  RP_LOG_PHASE_FILE="${RP_LOG_BENCH}/${phase}.log"
  rp_log_init_bench
  : >"$RP_LOG_PHASE_FILE"
  export RP_LOG_PHASE_FILE
}

rp_log_append_phase() {
  local line="$1"
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] || return 0
  printf '%s\n' "$line" >>"$RP_LOG_PHASE_FILE"
}

# Run command: full output → bench_logs/<logname>.log; terminal = step + result unless verbose.
rp_run_logged() {
  local logname="$1"
  shift
  local logfile="${RP_LOG_BENCH}/${logname}.log"
  rp_log_init_bench
  local cmd_display="$*"
  rp_step "$cmd_display"
  rp_log_append_phase "[cmd] $cmd_display"

  if [[ "$RP_LOG_DRY_RUN" == "1" ]]; then
    rp_info "[dry-run] $cmd_display"
    return 0
  fi

  local ec=0
  if [[ "$RP_LOG_VERBOSE" == "1" ]]; then
    set +e
    "$@" 2>&1 | tee -a "$logfile"
    ec="${PIPESTATUS[0]}"
    set -e
  else
    set +e
    "$@" >>"$logfile" 2>&1
    ec=$?
    set -e
  fi
  rp_log_append_phase "[exit $ec] $cmd_display"
  return "$ec"
}

# Quiet run: no stdout/stderr on terminal unless verbose or failure.
rp_run_quiet() {
  local logname="$1"
  shift
  local logfile="${RP_LOG_BENCH}/${logname}.log"
  rp_log_init_bench
  local cmd_display="$*"

  if [[ "$RP_LOG_DRY_RUN" == "1" ]]; then
    rp_step "$cmd_display"
    rp_info "[dry-run] $cmd_display"
    return 0
  fi

  local ec=0
  if [[ "$RP_LOG_VERBOSE" == "1" ]]; then
    rp_step "$cmd_display"
    set +e
    "$@" 2>&1 | tee -a "$logfile"
    ec="${PIPESTATUS[0]}"
    set -e
  else
    set +e
    "$@" >>"$logfile" 2>&1
    ec=$?
    set -e
  fi
  rp_log_append_phase "[exit $ec] $cmd_display"
  return "$ec"
}

# Failure footer: phase name, recovery, log path, safe tail (indented; not shell-pasteable).
rp_log_fail_footer() {
  local phase="$1"
  local msg="$2"
  local recovery="${3:-}"
  local logfile="${4:-${RP_LOG_PHASE_FILE:-}}"

  rp_error "Phase failed: ${phase} — ${msg}"
  if [[ -n "$recovery" ]]; then
    rp_info "Recovery: ${recovery}"
  fi
  if [[ -n "$logfile" && -f "$logfile" ]]; then
    rp_info "Full log: ${logfile}"
    rp_info "Tail:"
    tail -120 "$logfile" 2>/dev/null | while IFS= read -r _line || [[ -n "$_line" ]]; do
      printf '  %s\n' "$_line"
    done
  fi
  local _tee="${RP_COLD_BOOTSTRAP_LOG:-/tmp/rp-cold-bootstrap.log}"
  if [[ -f "$_tee" ]]; then
    rp_info "Session tee: ${_tee}  (do not paste log lines into the shell)"
  fi
}

# Subcommand failed inside a phase — point at a named bench_logs file.
rp_log_cmd_failed() {
  local label="$1"
  local logfile="${RP_LOG_BENCH}/${2}.log"
  rp_error "${label}"
  rp_info "Log: ${logfile}"
  rp_info "Tail:"
  tail -80 "$logfile" 2>/dev/null | while IFS= read -r _line || [[ -n "$_line" ]]; do
    printf '  %s\n' "$_line"
  done
}
