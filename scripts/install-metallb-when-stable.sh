#!/usr/bin/env bash
# Wait for a "stable API" (several consecutive successful kubectl checks), then run install-metallb.sh.
# Use when the cluster is up but the API is sometimes 503 or connection refused; this avoids installing during a flaky window.
#
# Usage: ./scripts/install-metallb-when-stable.sh
#   STABLE_CHECKS=3     number of consecutive successful checks (default 3)
#   STABLE_INTERVAL=20  seconds between checks (default 20)
#   STABLE_MAX_WAIT=600 max seconds to wait for stable window (default 600 = 10 min)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STABLE_CHECKS="${STABLE_CHECKS:-3}"
STABLE_INTERVAL="${STABLE_INTERVAL:-20}"
STABLE_MAX_WAIT="${STABLE_MAX_WAIT:-600}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

say "Waiting for stable API (${STABLE_CHECKS} consecutive checks every ${STABLE_INTERVAL}s; max ${STABLE_MAX_WAIT}s)"
info "Then running: ./scripts/install-metallb.sh"
echo ""

# Ensure tunnel so host kubectl can reach API
"$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
sleep 2

start=$(date +%s)
consecutive=0
while true; do
  now=$(date +%s)
  if [[ $((now - start)) -ge $STABLE_MAX_WAIT ]]; then
    warn "Did not see ${STABLE_CHECKS} consecutive stable checks within ${STABLE_MAX_WAIT}s."
    info "Options: 1) Run again later. 2) ./scripts/install-metallb-chunked.sh (applies in phases). 3) ./scripts/colima-fix-control-plane-for-good.sh then retry."
    exit 1
  fi
  if kubectl get nodes --request-timeout=15s >/dev/null 2>&1 && kubectl get ns default --request-timeout=10s >/dev/null 2>&1; then
    consecutive=$((consecutive + 1))
    info "Stable check $consecutive/$STABLE_CHECKS at ${STABLE_INTERVAL}s interval"
    if [[ $consecutive -ge $STABLE_CHECKS ]]; then
      ok "API stable; installing MetalLB..."
      break
    fi
  else
    consecutive=0
  fi
  sleep "$STABLE_INTERVAL"
done

exec "$SCRIPT_DIR/install-metallb.sh" "$@"
