#!/usr/bin/env bash
# Wait for k3s to be "active" in the VM, then for the API (kubectl get nodes) to succeed.
# Use after colima start or when colima-api-status.sh shows 503 / k3s "activating".
#
# Usage: ./scripts/wait-for-k3s-ready.sh
#   K3S_ACTIVE_WAIT=180  — max seconds to wait for systemctl is-active k3s (default 180)
#   API_WAIT=120         — max seconds to wait for kubectl get nodes after k3s active (default 120)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

K3S_ACTIVE_WAIT="${K3S_ACTIVE_WAIT:-180}"
API_WAIT="${API_WAIT:-120}"
INTERVAL="${INTERVAL:-10}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

say "Waiting for k3s (Colima VM) to be ready"
echo "  Phase 1: systemctl is-active k3s == active (max ${K3S_ACTIVE_WAIT}s)"
echo "  Phase 2: kubectl get nodes (max ${API_WAIT}s)"
echo ""

# Ensure kubeconfig uses 6443 (tunnel)
if [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
  "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
fi

# Phase 1: k3s service active (Colima sometimes keeps "activating" until API is up — fallback to Phase 2 after 90s)
start=$(date +%s)
ACTIVATING_FALLBACK=90
while true; do
  state=$(colima ssh -- sudo systemctl is-active k3s 2>/dev/null | head -1 | tr -d '\r\n' | tr -d '[:space:]')
  state="${state:-unknown}"
  # Colima sometimes appends "unknown" on a second line; take only the first word (active|activating|failed|inactive)
  state="${state%%unknown*}"; state="${state:-unknown}"
  [[ "$state" == "" ]] && state="unknown"
  now=$(date +%s)
  elapsed=$((now - start))
  if [[ "$state" == "active" ]]; then
    ok "k3s is active (${elapsed}s)"
    break
  fi
  if [[ $elapsed -ge $K3S_ACTIVE_WAIT ]]; then
    echo "⚠️  k3s systemctl still not 'active' after ${K3S_ACTIVE_WAIT}s. Trying Phase 2 (API) anyway..."
    break
  fi
  if [[ $elapsed -ge $ACTIVATING_FALLBACK ]] && [[ "$state" == "activating" ]]; then
    echo "  (state=activating for ${elapsed}s — skipping to API check; Colima often stays 'activating' until API is ready)"
    break
  fi
  echo "  Waiting for k3s (state=${state}, ${elapsed}s / ${K3S_ACTIVE_WAIT}s)..."
  sleep "$INTERVAL"
done

# Phase 2: API responds
say "Waiting for API server (kubectl get nodes)..."
start=$(date +%s)
while true; do
  elapsed=$(($(date +%s) - start))
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "API server ready (${elapsed}s)"
    kubectl get nodes
    say "Ready. Proceed with preflight or suites."
    exit 0
  fi
  now=$(date +%s)
  elapsed=$((now - start))
  if [[ $elapsed -ge $API_WAIT ]]; then
    echo "⚠️  API not ready after ${API_WAIT}s. Run: $REPO_ROOT/scripts/colima-api-status.sh"
    exit 1
  fi
  echo "  Waiting for API (${elapsed}s / ${API_WAIT}s)..."
  sleep "$INTERVAL"
done
