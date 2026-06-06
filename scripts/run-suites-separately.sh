#!/usr/bin/env bash
# Run test suites separately. Usage:
#   ./run-suites-separately.sh              # run all
#   ./run-suites-separately.sh 1            # baseline only
#   ./run-suites-separately.sh 2            # enhanced only
#   ./run-suites-separately.sh 3 4 5        # adversarial, rotation, standalone
#   SKIP_API_CHECK=1 ./run-suites-separately.sh 5   # standalone without API wait (quicker)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Shims first so kubectl uses shim (avoids "shim not active" / API server issues). See API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Pre-flight: fix kubeconfig so tests don't hang
if [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
  say "Pre-flight: kubeconfig"
  "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || warn "Preflight had issues; continuing anyway."
fi

run() {
  local n="$1" name="$2" script="$3"
  local path="$SCRIPT_DIR/$script"
  [[ ! -f "$path" ]] && { warn "Not found: $path"; return 1; }
  say "--- $n: $name ---"
  if env SKIP_API_CHECK="${SKIP_API_CHECK:-0}" "$path"; then
    ok "$name: PASSED"
    return 0
  else
    warn "$name: FAILED"
    return 1
  fi
}

RUN_ALL=("1" "2" "3" "4" "5")
[[ $# -gt 0 ]] && RUN_ALL=("$@")

for n in "${RUN_ALL[@]}"; do
  case "$n" in
    1) run 1 "Baseline smoke" "test-microservices-http2-http3.sh" ;;
    2) run 2 "Enhanced smoke" "test-microservices-http2-http3-enhanced.sh" ;;
    3) run 3 "Adversarial" "enhanced-adversarial-tests.sh" ;;
    4) run 4 "Rotation suite" "rotation-suite.sh" ;;
    5) run 5 "Standalone capture" "test-packet-capture-standalone.sh" ;;
    *) warn "Unknown suite: $n (use 1–5)" ;;
  esac
done

say "=== Done ==="
