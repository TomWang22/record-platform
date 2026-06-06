#!/usr/bin/env bash
# Shared helpers for Record Platform cold-bootstrap (source from cold-bootstrap.sh only).
set -euo pipefail

RP_CB_REPO_ROOT="${RP_CB_REPO_ROOT:-}"
RP_CB_GRAPH="${RP_CB_GRAPH:-$RP_CB_REPO_ROOT/infra/bootstrap_invariants.graph.json}"
RP_CB_PROGRESS="${RP_CB_PROGRESS:-$RP_CB_REPO_ROOT/bench_logs/bootstrap_state_progress.json}"
RP_CB_BENCH="${RP_CB_BENCH:-$RP_CB_REPO_ROOT/bench_logs}"
RP_CB_TIMINGS="${RP_CB_TIMINGS:-$RP_CB_BENCH/bootstrap_phase_timings.json}"
RP_CB_START_MS="${RP_CB_START_MS:-0}"
RP_CB_DRY_RUN="${RP_CB_DRY_RUN:-0}"
RP_CB_PHASE_START_MS=""

_SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=rp-log.sh
source "$_SCRIPT_LIB_DIR/rp-log.sh"
export RP_LOG_BENCH="$RP_CB_BENCH"
export RP_LOG_DRY_RUN="$RP_CB_DRY_RUN"

# COLD_BOOTSTRAP_COLOR=auto|force|never (default auto — no forced FORCE_COLOR)
rp_cb_apply_color_policy() {
  case "${COLD_BOOTSTRAP_COLOR:-auto}" in
    force|1|yes)
      export FORCE_COLOR=1
      ;;
    never|0|no)
      export NO_COLOR=1
      unset FORCE_COLOR 2>/dev/null || true
      ;;
    auto|*)
      if [[ "${COLD_BOOTSTRAP_FORCE_COLOR:-0}" == "1" ]]; then
        export FORCE_COLOR=1
      else
        unset FORCE_COLOR 2>/dev/null || true
      fi
      ;;
  esac
}

rp_cb_apply_color_policy

# Default: concise phase output. COLD_BOOTSTRAP_QUIET=1 suppresses GATE lines.
rp_cb_quiet() {
  [[ "${COLD_BOOTSTRAP_QUIET:-0}" == "1" ]]
}

rp_is_tty() {
  [[ -t 1 ]] && [[ "${CI:-0}" != "1" ]]
}

rp_cb_color_enabled() {
  [[ -z "${NO_COLOR:-}" ]] || return 1
  if [[ "${FORCE_COLOR:-}" == "1" || "${COLD_BOOTSTRAP_FORCE_COLOR:-0}" == "1" ]]; then
    return 0
  fi
  rp_is_tty
}

_rp_cb_log_path() {
  local phase="$1" step="$2"
  mkdir -p "${RP_CB_BENCH}/command-logs/${phase}"
  printf '%s/command-logs/%s/%s.log' "$RP_CB_BENCH" "$phase" "$step"
}

_rp_cb_mirror_log_to_full() {
  local log="$1"
  [[ -n "${RP_CB_FULL_LOG:-}" && -f "$log" ]] && cat "$log" >>"${RP_CB_FULL_LOG}" 2>/dev/null || true
}

_rp_cb_script_run() {
  local log="$1"
  shift
  if ! command -v script >/dev/null 2>&1; then
    return 1
  fi
  if [[ "$(uname -s)" == Darwin ]]; then
    script -q "$log" "$@" 2>/dev/null
    return $?
  fi
  local cmd
  cmd="$(printf '%q ' "$@")"
  script -qefc "$cmd" "$log" 2>/dev/null
}

# Destructive / noisy — log only; concise ▶/✅ on terminal (P0, align-kubeconfig, VM tools).
_rp_run_quiet_body() {
  local phase="$1" step="$2"
  shift 2
  local log
  log="$(_rp_cb_log_path "$phase" "$step")"
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[quiet] %s → %s\n' "$*" "$log" >>"$RP_LOG_PHASE_FILE"

  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    return 0
  fi

  {
    printf '=== %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '+ %s\n\n' "$*"
  } >"$log"

  local ec=0
  set +e
  if [[ "${RP_BOOTSTRAP_XTRACE:-0}" == "1" ]]; then
    PS4='+(${BASH_SOURCE##*/}:${LINENO}): ' bash -x -c "$(printf '%q ' "$@")" >>"$log" 2>&1
    ec=$?
  else
    ( set +x; unset PS4; "$@" ) >>"$log" 2>&1
    ec=$?
  fi
  set -e
  _rp_cb_mirror_log_to_full "$log"
  return "$ec"
}

rp_run_quiet() {
  local phase="$1" step="$2"
  shift 2
  local log ec
  log="$(_rp_cb_log_path "$phase" "$step")"
  printf '  ▶ %s\n' "$step"
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  _rp_run_quiet_body "$phase" "$step" "$@"
  ec=$?
  if [[ "$ec" -eq 0 ]]; then
    printf '  ✅ %s\n' "$step"
    return 0
  fi
  printf '  ❌ %s failed — see %s\n' "$step" "$log" >&2
  tail -80 "$log" 2>/dev/null | sed 's/^/    /' >&2 || true
  return "$ec"
}

# Natural terminal output (pnpm, colima start, kubectl).
rp_run_native() {
  rp_run_native_tty "$@"
}

# Colima/kubectl — native terminal when TTY; log via script(1) or post-run capture.
rp_run_native_tty() {
  local phase="$1" step="$2"
  shift 2
  local log
  log="$(_rp_cb_log_path "$phase" "$step")"
  printf '  ▶ %s\n' "$step"
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[native] %s → %s\n' "$*" "$log" >>"$RP_LOG_PHASE_FILE"

  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi

  {
    printf '=== %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '+ %s\n\n' "$*"
  } >"$log"

  local ec=0
  set +e
  if rp_is_tty && _rp_cb_script_run "$log" "$@"; then
    ec=0
  elif rp_is_tty; then
    # Direct run — no stdout/stderr pipe (preserves Colima INFO colors on terminal).
    "$@"
    ec=$?
    {
      printf '\n=== native TTY (stream not piped; captured when script(1) works) ===\n'
      printf '+ %s\n' "$*"
    } >>"$log"
  else
    "$@" 2>&1 | tee -a "$log"
    ec="${PIPESTATUS[0]}"
  fi
  set -e
  _rp_cb_mirror_log_to_full "$log"

  if [[ "$ec" -eq 0 ]]; then
    printf '  ✅ %s\n' "$step"
    return 0
  fi
  printf '  ❌ %s failed — see %s\n' "$step" "$log" >&2
  tail -80 "$log" 2>/dev/null | sed 's/^/    /' >&2 || true
  return "$ec"
}

phase_header() {
  local phase="$1"
  local subtitle="${2:-}"
  printf '\n[%s]' "$phase"
  [[ -n "$subtitle" ]] && printf ' %s' "$subtitle"
  printf '\n'
}

# Live stream — use for short verification, pnpm build, kubectl apply, rollout status, restore progress.
rp_run_stream() {
  local label="$1"
  shift
  local cmd_display="$*"
  printf '▶ %s\n' "$label"
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[cmd] %s\n' "$cmd_display" >>"$RP_LOG_PHASE_FILE"

  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$cmd_display"
    return 0
  fi

  local ec=0
  set +e
  if [[ -n "${RP_LOG_PHASE_FILE:-}" ]]; then
    "$@" 2>&1 | tee -a "$RP_LOG_PHASE_FILE"
    ec="${PIPESTATUS[0]}"
  else
    "$@"
    ec=$?
  fi
  set -e
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[exit %s] %s\n' "$ec" "$cmd_display" >>"$RP_LOG_PHASE_FILE"
  return "$ec"
}

# Noisy/destructive commands — full output to bench_logs/command-logs/<phase>/<step>.log + heartbeat on terminal.
rp_run_logged() {
  local phase="$1"
  local step="$2"
  local label="$3"
  shift 3
  local cmd_display="$*"
  local log_dir="${RP_CB_BENCH}/command-logs/${phase}"
  local log_file="${log_dir}/${step}.log"
  local heartbeat="${RP_BOOTSTRAP_HEARTBEAT_SEC:-0}"
  local _show_log="${RP_BOOTSTRAP_SHOW_LOG_PATH:-0}"
  mkdir -p "$log_dir"

  if [[ "$_show_log" == "1" ]]; then
    printf '▶ %s\n  log: %s\n' "$label" "$log_file"
  else
    printf '▶ %s\n' "$label"
  fi
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[logged] %s → %s\n' "$cmd_display" "$log_file" >>"$RP_LOG_PHASE_FILE"

  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$cmd_display"
    return 0
  fi

  {
    printf '=== %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '+ %s\n\n' "$cmd_display"
  } >"$log_file"

  local elapsed=0 ec=0
  set +e
  # Never stream k3s-uninstall set -x trace to the operator terminal.
  ( set +x; unset PS4; "$@" ) >>"$log_file" 2>&1 &
  local pid=$!
  if [[ "$heartbeat" -gt 0 ]]; then
    while kill -0 "$pid" 2>/dev/null; do
      sleep "$heartbeat"
      elapsed=$((elapsed + heartbeat))
      printf '  still running (%ss): %s\n' "$elapsed" "$label"
      if [[ "${RP_BOOTSTRAP_TAIL_NOISY:-0}" == "1" ]] && [[ -s "$log_file" ]]; then
        tail -n 20 "$log_file" | sed 's/^/    /'
      fi
    done
  fi
  wait "$pid"
  ec=$?
  set -e

  if [[ "$ec" -eq 0 ]]; then
    printf '✅ %s\n' "$label"
    [[ "$_show_log" == "1" ]] && printf '  log: %s\n' "$log_file"
    [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[exit 0] %s\n' "$cmd_display" >>"$RP_LOG_PHASE_FILE"
    return 0
  fi

  printf '❌ %s failed (exit %s)\n' "$label" "$ec" >&2
  printf '  log: %s\n' "$log_file" >&2
  printf '  --- tail -120 ---\n' >&2
  tail -120 "$log_file" 2>/dev/null | sed 's/^/  /' >&2 || true
  [[ -n "${RP_LOG_PHASE_FILE:-}" ]] && printf '[exit %s] %s\n' "$ec" "$cmd_display" >>"$RP_LOG_PHASE_FILE"
  return "$ec"
}

# Summary lines on terminal; noisy command body in command-logs (VM tools, cert proofs).
rp_run_summary() {
  local phase="$1" step="$2" items_csv="$3"
  shift 3
  local log items=() it
  log="$(_rp_cb_log_path "$phase" "$step")"
  IFS=',' read -ra items <<< "$items_csv"

  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '  ▶ %s\n' "$step"
    for it in "${items[@]}"; do
      printf '    ▶ install %s\n' "$it"
      printf '    ✅ %s\n' "$it"
    done
    return 0
  fi

  printf '  ▶ %s\n' "$step"
  for it in "${items[@]}"; do
    printf '    ▶ install %s\n' "$it"
  done

  if ! _rp_run_quiet_body "$phase" "$step" "$@"; then
    printf '  ❌ %s failed — see %s\n' "$step" "$log" >&2
    tail -80 "$log" 2>/dev/null | sed 's/^/    /' >&2 || true
    return 1
  fi

  for it in "${items[@]}"; do
    printf '    ✅ %s\n' "$it"
  done
  return 0
}

# Back-compat aliases
run_stream() { rp_run_stream "$@"; }
run_logged() { rp_run_logged "${RP_CB_CURRENT_PHASE:-misc}" "step" "$@"; }

rp_cb_countdown() {
  local total="${1:-90}"
  local msg="${2:-k3s to settle}"
  local step=15 t="$total"
  printf 'Waiting %ss for %s\n' "$total" "$msg"
  while (( t > 0 )); do
    printf '  %s\n' "$t"
    local sleep_for="$step"
    (( t < sleep_for )) && sleep_for="$t"
    sleep "$sleep_for"
    t=$((t - sleep_for))
  done
  printf '  done\n'
  printf '✅ k3s settled\n'
}

gate_ok() {
  printf '✅ GATE [%s] %s\n' "$1" "${2:-complete}"
}

gate_fail() {
  printf '❌ GATE [%s] %s\n' "$1" "$2" >&2
}

rp_cb_ms_now() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

rp_cb_record_phase_ms() {
  local node="$1"
  local start_ms="$2"
  local end_ms
  end_ms="$(rp_cb_ms_now)"
  mkdir -p "$RP_CB_BENCH"
  TIMINGS_PATH="$RP_CB_TIMINGS" PHASE_NODE="$node" PHASE_START_MS="$start_ms" PHASE_END_MS="$end_ms" python3 <<'PY'
import json, os
p = os.environ["TIMINGS_PATH"]
n = os.environ["PHASE_NODE"]
ms = int(os.environ["PHASE_END_MS"]) - int(os.environ["PHASE_START_MS"])
d = {}
if os.path.isfile(p):
    d = json.load(open(p, encoding="utf-8"))
d[n] = ms
with open(p, "w", encoding="utf-8") as fh:
    json.dump(d, fh, indent=2)
PY
}

rp_cb_say() {
  phase_header "$1" "${2:-}"
}

rp_cb_ok() {
  printf '✅ %s\n' "$*"
}

rp_cb_run() {
  local label="${RP_CB_RUN_LABEL:-${RP_CB_CURRENT_PHASE:-command}}"
  unset RP_CB_RUN_LABEL
  rp_run_stream "$label" "$@"
}

# Colima bridge kubeconfig + API health (embedded; no manual align between phases).
rp_cb_ensure_kube_api() {
  local _why="${1:-cluster}"
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    echo "[dry-run] bash scripts/rp-ensure-kube-api.sh  # ${_why}"
    return 0
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    return 0
  fi
  rp_run_stream "align kube API (bridge)" bash "$RP_CB_REPO_ROOT/scripts/rp-ensure-kube-api.sh"
}

rp_cb_phase_guard() {
  local _args=("$@")
  if [[ "${COLD_BOOTSTRAP_DEBUG_JSON:-0}" != "1" ]]; then
    _args+=(--quiet)
  fi
  node "$RP_CB_REPO_ROOT/scripts/bootstrap-phase-guard.mjs" \
    --graph "$RP_CB_GRAPH" \
    --progress "$RP_CB_PROGRESS" \
    "${_args[@]}"
}

# Write progress snapshot to bench_logs only (no stdout JSON spam).
rp_cb_progress_json() {
  mkdir -p "$RP_CB_BENCH"
  if [[ -f "$RP_CB_PROGRESS" ]]; then
    return 0
  fi
  rp_cb_phase_guard --reset >/dev/null 2>&1 || true
}

rp_cb_phase_enter() {
  local node="$1"
  local subtitle="${2:-}"
  export RP_CB_CURRENT_PHASE="$node"
  phase_header "$node" "$subtitle"
  RP_CB_PHASE_START_MS="$(rp_cb_ms_now)"
  rp_log_set_phase_file "$node"
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    return 0
  fi
  rp_cb_phase_guard --enter "$node"
}

rp_cb_phase_complete() {
  local node="$1"
  rp_cb_phase_guard --complete "$node"
  if [[ "$RP_CB_DRY_RUN" != "1" ]] && [[ -n "${RP_CB_PHASE_START_MS:-}" ]]; then
    rp_cb_record_phase_ms "$node" "$RP_CB_PHASE_START_MS"
  fi
  case "$node" in
    G.app_runtime|J.final_contract)
      if [[ -f "$RP_CB_REPO_ROOT/scripts/export-bootstrap-phase-metrics.sh" ]]; then
        bash "$RP_CB_REPO_ROOT/scripts/export-bootstrap-phase-metrics.sh" 2>/dev/null || true
      fi
      ;;
  esac
  if ! rp_cb_quiet; then
    gate_ok "$node" "complete"
  fi
}

# Diagnostics when bootstrap-cluster.log stops growing (stall detector).
rp_cb_bootstrap_stall_diag() {
  local log="${1:-${RP_CB_BENCH}/bootstrap-cluster.log}"
  local stall_secs="${2:-120}"
  printf '\n❌ bootstrap-cluster.log unchanged for %ss — diagnostics:\n' "$stall_secs" >&2
  printf '  log: %s (%s bytes)\n' "$log" "$(wc -c <"$log" 2>/dev/null | tr -d ' ' || echo 0)" >&2
  if command -v kubectl >/dev/null 2>&1; then
    printf '\n--- kubectl get pods -A ---\n' >&2
    kubectl get pods -A --request-timeout=20s 2>&1 | sed 's/^/  /' >&2 || true
    printf '\n--- kubectl get ns record-platform -o json (finalizers) ---\n' >&2
    kubectl get namespace record-platform -o json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("  phase:", d.get("status", {}).get("phase"))
print("  finalizers:", d.get("spec", {}).get("finalizers"))
' 2>&1 | sed 's/^/  /' >&2 || kubectl get namespace record-platform -o yaml 2>&1 | sed 's/^/  /' >&2 || true
    printf '\n--- kubectl get events -A (last 80) ---\n' >&2
    kubectl get events -A --sort-by=.lastTimestamp 2>/dev/null | tail -80 | sed 's/^/  /' >&2 || true
  fi
  printf '\n--- child process tree (make bootstrap) ---\n' >&2
  ps -ax -o pid=,ppid=,command= 2>/dev/null | grep -E '[m]ake.*bootstrap|[b]ootstrap-cluster' | sed 's/^/  /' >&2 || true
}

# Nested make bootstrap — one terminal line; full P2–P9 in bench_logs/bootstrap-cluster.log
rp_cb_run_bootstrap_cluster() {
  local log="${RP_CB_BENCH}/bootstrap-cluster.log"
  export RP_CB_BOOTSTRAP_LOG="$log"
  mkdir -p "$RP_CB_BENCH"
  printf '  ▶ cluster deploy (bootstrap-cluster.sh)\n'
  if [[ "$RP_CB_DRY_RUN" == "1" ]]; then
    printf '[dry-run] BOOTSTRAP_CONFIRM=yes bash scripts/bootstrap-cluster.sh 2>&1 | tee %s\n' "$log"
    return 0
  fi
  export BOOTSTRAP_CONFIRM=yes
  export BOOTSTRAP_FORCE_NS_DELETE="${RP_FORCE_NAMESPACE_DELETE:-0}"
  unset BOOTSTRAP_QUIET COLD_BOOTSTRAP_QUIET
  chmod +x "$RP_CB_REPO_ROOT/scripts/bootstrap-cluster.sh" \
    "$RP_CB_REPO_ROOT/scripts/dev-kill-all.sh" \
    "$RP_CB_REPO_ROOT/scripts/bring-up-external-infra.sh" \
    "$RP_CB_REPO_ROOT/scripts/strict-tls-bootstrap.sh" \
    "$RP_CB_REPO_ROOT/scripts/deploy-dev.sh" \
    "$RP_CB_REPO_ROOT/scripts/verify-app-runtime.sh" 2>/dev/null || true
  : >"$log"
  local status=0
  set -o pipefail
  set +e
  (
    cd "$RP_CB_REPO_ROOT"
    HOUSING_NS="${HOUSING_NS:-record-platform}" \
      bash "$RP_CB_REPO_ROOT/scripts/bootstrap-cluster.sh"
  ) 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  set -e
  set +o pipefail
  if [[ "$status" -ne 0 ]]; then
    printf '❌ cluster deploy failed (exit %s)\n' "$status" >&2
    printf '  command: BOOTSTRAP_CONFIRM=yes HOUSING_NS=%s bash scripts/bootstrap-cluster.sh\n' "${HOUSING_NS:-record-platform}" >&2
    tail -80 "$log" 2>/dev/null | sed 's/^/  /' >&2 || true
    return "$status"
  fi
  printf '  ✅ cluster deploy complete\n'
  printf '  log: %s\n' "$log"
  return 0
}

rp_cb_phase_fail() {
  local node="$1"
  local msg="$2"
  local recovery="${3:-re-run: COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap}"
  rp_cb_phase_guard --fail "$node" --message "$msg" 2>/dev/null || true
  printf '\n' >&2
  rp_log_fail_footer "$node" "$msg" "$recovery" "${RP_LOG_PHASE_FILE:-}"
  exit 1
}

# Internal full log only — never exec tee (preserves TTY for Colima native output).
rp_cb_setup_log_tee() {
  rp_cb_setup_full_log
}

rp_cb_setup_full_log() {
  if [[ "${RP_CB_FULL_LOG_ACTIVE:-}" == "1" ]]; then
    return 0
  fi
  export RP_CB_FULL_LOG_ACTIVE=1
  mkdir -p "$RP_CB_BENCH"
  export RP_CB_FULL_LOG="${RP_CB_FULL_LOG:-$RP_CB_BENCH/cold-bootstrap.full.log}"
  export RP_COLD_BOOTSTRAP_LOG="${RP_COLD_BOOTSTRAP_LOG:-$RP_CB_FULL_LOG}"
  : >"$RP_CB_FULL_LOG"
  if [[ "${COLD_BOOTSTRAP_VERBOSE:-0}" == "1" ]]; then
    printf 'full log: %s\n' "$RP_CB_FULL_LOG"
    printf '  (no exec tee — optional external tee will not preserve Colima TTY)\n'
  fi
}

rp_cb_assert_workspace_no_booking_social() {
  local bad=0
  for svc in booking-service social-service; do
    if [[ -d "$RP_CB_REPO_ROOT/services/$svc" ]]; then
      echo "❌ services/$svc must not be in workspace build matrix" >&2
      bad=1
    fi
  done
  if pnpm -r list 2>/dev/null | grep -qE 'booking-service|social-service'; then
    echo "❌ pnpm workspace lists forbidden legacy service (skipped at restore)" >&2
    bad=1
  fi
  [[ $bad -eq 0 ]] || return 1
}

rp_cb_resolve_restore_dir_display() {
  if [[ -n "${RESTORE_BACKUP_DIR_ABS:-}" ]]; then
    printf '%s' "$RESTORE_BACKUP_DIR_ABS"
  elif [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
    printf '%s' "$RESTORE_BACKUP_DIR"
  else
    printf '%s' "(unset — will use default or latest backups/all-8-*)"
  fi
}

rp_cb_print_wall_timer_start() {
  printf '\n=== [cold-bootstrap] wall timer start (%s) ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -t 0 ]] && [[ "${COLD_BOOTSTRAP_CONFIRM:-}" != "yes" ]]; then
    printf 'cold-bootstrap: interactive confirm on a TTY, or set COLD_BOOTSTRAP_CONFIRM=yes.\n'
  fi
}

rp_cb_print_banner() {
  local resolved
  resolved="$(rp_cb_resolve_restore_dir_display)"
  if rp_cb_color_enabled; then
    printf '\n\033[1mPhase —\033[0m Record Platform cold-bootstrap (hybrid RP runtime)\n'
  else
    printf '\nPhase — Record Platform cold-bootstrap (hybrid RP runtime)\n'
  fi
  printf '  RP_PUBLIC_HOST=%s\n' "${RP_PUBLIC_HOST:-record-platform.test}"
  printf '  RESTORE_BACKUP_DIR(input)=%s\n' "${resolved}"
  [[ "$RP_CB_DRY_RUN" == "1" ]] && printf '  COLD_BOOTSTRAP_DRY_RUN=1\n'
  if [[ "${COLD_BOOTSTRAP_VERBOSE:-0}" == "1" ]]; then
    printf '  logs: bench_logs/cold-bootstrap.full.log bench_logs/command-logs/<phase>/*.log\n'
    printf '  verbose flags: COLD_BOOTSTRAP_VERBOSE=1 RP_BOOTSTRAP_HEARTBEAT_SEC=15 RP_BOOTSTRAP_SHOW_LOG_PATH=1\n'
  fi
}

rp_cb_print_operator_notes() {
  local resolved
  resolved="$(rp_cb_resolve_restore_dir_display)"
  printf 'Restore: %s\n' "${resolved}"
  if [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
    printf 'Using RESTORE_BACKUP_DIR=%s\n' "${RESTORE_BACKUP_DIR}"
  fi
  [[ "${COLD_BOOTSTRAP_VERBOSE:-0}" == "1" ]] || return 0
  cat <<'EOF'
Skip schema gate: BOOTSTRAP_SKIP_DB_SCHEMA_INSPECT=1
Contract JSON: verify-bootstrap-state at end (skip: VERIFY_BOOTSTRAP_STATE_SKIP=1)
Edge transport: VERIFY_BOOTSTRAP_HTTP3_EDGE=0 until /etc/hosts updated
Timing regression: FAIL_ON_REGRESSION=1 REGRESSION_THRESHOLD=1.2 (needs ≥3 bench_logs/historical_timings/)
SLO/SLA: scripts/rp-verify-slo-sla.sh (edge probes skipped until hosts: RP_SLO_SKIP_EDGE_PROBES=1)
EOF
}

rp_cb_run_regression_gate() {
  if [[ "${BOOTSTRAP_SKIP_REGRESSION_CHECK:-0}" == "1" ]]; then
    echo "ℹ️  BOOTSTRAP_SKIP_REGRESSION_CHECK=1 — skipping timing regression" >&2
    return 0
  fi
  mkdir -p "$RP_CB_BENCH/historical_timings"
  if [[ -x "$RP_CB_REPO_ROOT/scripts/save-timing-history.sh" ]]; then
    bash "$RP_CB_REPO_ROOT/scripts/save-timing-history.sh" 2>/dev/null || true
  fi
  if [[ -f "$RP_CB_REPO_ROOT/scripts/detect-bootstrap-regression.mjs" ]]; then
    FAIL_ON_REGRESSION="${FAIL_ON_REGRESSION:-1}" REGRESSION_THRESHOLD="${REGRESSION_THRESHOLD:-1.2}" \
      node "$RP_CB_REPO_ROOT/scripts/detect-bootstrap-regression.mjs" || {
        if [[ "${FAIL_ON_REGRESSION:-1}" == "1" ]]; then
          rp_cb_phase_fail "J.final_contract" "bootstrap timing regression" "review bench_logs/bootstrap_regression_report.json"
        fi
        echo "⚠️  timing regression detected (FAIL_ON_REGRESSION=0 would continue)" >&2
      }
  fi
  if [[ -x "$RP_CB_REPO_ROOT/scripts/export-bootstrap-regression-prom.sh" ]]; then
    bash "$RP_CB_REPO_ROOT/scripts/export-bootstrap-regression-prom.sh" 2>/dev/null || true
  fi
}

rp_cb_write_wall_timing() {
  local end_ms
  end_ms="$(rp_cb_ms_now)"
  local dur=$(( (end_ms - RP_CB_START_MS) / 1000 ))
  local min=$(( dur / 60 ))
  local sec=$(( dur % 60 ))
  echo "⏱ cold-bootstrap wall clock: ${min}m ${sec}s"
  mkdir -p "$RP_CB_BENCH"
  python3 -c "
import json
d={'kind':'suite_wall_timer','suite':'cold-bootstrap','duration_ms':int('$end_ms')-int('$RP_CB_START_MS'),'duration_human':'${min}m ${sec}s'}
open('$RP_CB_BENCH/cold-bootstrap-last-timing.json','w').write(json.dumps(d,indent=2)+'\n')
"
  if [[ -x "$RP_CB_REPO_ROOT/scripts/export-och-wall-clock-prom.sh" ]]; then
    OCH_PUSH_WALL_CLOCK=1 bash "$RP_CB_REPO_ROOT/scripts/export-och-wall-clock-prom.sh" cold-bootstrap 2>/dev/null || true
  fi
  if [[ -x "$RP_CB_REPO_ROOT/scripts/rp-export-bootstrap-slo-prom.sh" ]]; then
    bash "$RP_CB_REPO_ROOT/scripts/rp-export-bootstrap-slo-prom.sh" 2>/dev/null || true
  fi
}

rp_cb_print_allowed_order_json() {
  local _json="${RP_CB_BENCH}/bootstrap_allowed_order.json"
  if [[ ! -f "$_json" ]]; then
    printf '{ "error": "missing bootstrap_allowed_order.json" }\n'
    return 0
  fi
  cat "$_json"
  printf '\n'
}

rp_cb_print_allowed_order() {
  rp_cb_print_allowed_order_json
}

rp_cb_plan_forbidden_audit() {
  echo "=== Plan: forbidden runtime audit ==="
  local issues=0
  if [[ -d "$RP_CB_REPO_ROOT/services/booking-service" ]] || [[ -d "$RP_CB_REPO_ROOT/services/social-service" ]]; then
    echo "  ❌ booking-service or social-service directory present in services/"
    issues=$((issues + 1))
  else
    echo "  ✅ no booking-service / social-service in services/"
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qiE 'off-campus-housing|och-'; then
    echo "  ❌ legacy external containers still running"
    issues=$((issues + 1))
  else
    echo "  ✅ no legacy external container names"
  fi
  for p in 5444 5445 5446 5447 5448; do
    if nc -z 127.0.0.1 "$p" 2>/dev/null; then
      echo "  ❌ forbidden runtime DB port $p is listening"
      issues=$((issues + 1))
    fi
  done
  if [[ $issues -eq 0 ]]; then
    echo "  ✅ runtime ports 5444–5448 not bound; RP path 5433–5443 expected after restore"
  fi
  return 0
}
