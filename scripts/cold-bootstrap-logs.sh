#!/usr/bin/env bash
# Print paths and tail hints for cold-bootstrap session + per-step command logs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BENCH="${RP_CB_BENCH:-$REPO_ROOT/bench_logs}"
TEE="${RP_COLD_BOOTSTRAP_LOG:-/tmp/rp-cold-bootstrap.log}"

printf '=== RP cold-bootstrap logs ===\n\n'

printf 'Main session:\n'
for _f in "$TEE" "$BENCH/cold-bootstrap.full.log"; do
  if [[ -f "$_f" ]]; then
    _sz="$(wc -l <"$_f" 2>/dev/null | tr -d ' ')"
    printf '  %s (%s lines)\n' "$_f" "${_sz:-?}"
  fi
done

printf '\nProgress JSON:\n'
[[ -f "$BENCH/bootstrap_state_progress.json" ]] && printf '  %s\n' "$BENCH/bootstrap_state_progress.json" \
  || printf '  (not found)\n'

printf '\nPer-phase command logs (noisy steps — colima delete, apt, etc.):\n'
if [[ -d "$BENCH/command-logs" ]]; then
  find "$BENCH/command-logs" -type f -name '*.log' 2>/dev/null | sort | while read -r _log; do
    _sz="$(wc -l <"$_log" 2>/dev/null | tr -d ' ')"
    printf '  %s (%s lines)\n' "$_log" "${_sz:-?}"
  done
else
  printf '  (no command-logs/ yet — run P0.hard_reset / Z.colima_clean)\n'
fi

printf '\nPer-phase summaries:\n'
find "$BENCH" -maxdepth 1 -type f -name '*.log' ! -name 'cold-bootstrap.full.log' 2>/dev/null | sort | while read -r _p; do
  printf '  %s\n' "$_p"
done

printf '\nUseful tails:\n'
[[ -f "$TEE" ]] && printf '  tail -200 %s\n' "$TEE"
[[ -f "$BENCH/cold-bootstrap.full.log" ]] && printf '  tail -200 %s\n' "$BENCH/cold-bootstrap.full.log"
[[ -f "$BENCH/command-logs/P0.hard_reset/03-colima-delete.log" ]] && \
  printf '  tail -200 %s\n' "$BENCH/command-logs/P0.hard_reset/03-colima-delete.log"
[[ -f "$BENCH/command-logs/Z.colima_clean/01-colima-start.log" ]] && \
  printf '  tail -200 %s\n' "$BENCH/command-logs/Z.colima_clean/01-colima-start.log"
[[ -f "$BENCH/command-logs/Z.colima_clean/05-vm-tools-apt-1.log" ]] && \
  printf '  tail -200 %s\n' "$BENCH/command-logs/Z.colima_clean/05-vm-tools-apt-1.log"
