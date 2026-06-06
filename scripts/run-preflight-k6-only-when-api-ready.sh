#!/usr/bin/env bash
# Wait for Kubernetes API to be reachable, then run full preflight with k6 (no pgbench).
# Use when pgbench is already running separately (e.g. daily cron or standalone).
#
# Usage:
#   ./scripts/run-preflight-k6-only-when-api-ready.sh           # wait up to API_WAIT_SEC, then run
#   API_WAIT_SEC=600 ./scripts/run-preflight-k6-only-when-api-ready.sh   # wait up to 10 min
#   SKIP_API_WAIT=1 ./scripts/run-preflight-k6-only-when-api-ready.sh    # run immediately (fail if API down)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

API_WAIT_SEC="${API_WAIT_SEC:-300}"
SKIP_API_WAIT="${SKIP_API_WAIT:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

if [[ "$SKIP_API_WAIT" != "1" ]]; then
  say "Waiting for Kubernetes API (up to ${API_WAIT_SEC}s)..."
  waited=0
  while [[ $waited -lt "$API_WAIT_SEC" ]]; do
    if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
      ok "API reachable after ${waited}s"
      break
    fi
    echo "  Attempt at ${waited}s: API not ready"
    sleep 10
    waited=$((waited + 10))
  done
  if ! kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
    warn "API still unreachable after ${API_WAIT_SEC}s. Options:"
    echo "  1. Run: ./scripts/colima-forward-6443.sh && ./scripts/ensure-k8s-api.sh"
    echo "  2. Restart Colima, then re-run this script"
    echo "  3. Re-run with SKIP_API_WAIT=1 to fail fast (e.g. when API is known up)"
    exit 1
  fi
fi

say "Running preflight with k6, no pgbench (RUN_FULL_LOAD=0 RUN_K6=1 RUN_PGBENCH=0)..."
exec env RUN_FULL_LOAD=0 RUN_K6=1 RUN_PGBENCH=0 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" "$@"
