#!/usr/bin/env bash
# Full flow on k3d: build & load images → restart deployments → wait for pods → run preflight (k6).
# Requires: k3d cluster record-platform up, Docker + Postgres/Redis/Kafka (Compose) on host.
# Usage: ./scripts/run-full-flow-k3d.sh
#   SKIP_BUILD=1       skip build-and-load (use existing :dev images)
#   SKIP_PREFLIGHT=1   skip preflight after pods ready
#   RUN_FULL_LOAD=1    run full preflight (pgbench + k6 + suites); default 0 (k6 + suites only)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_PREFLIGHT="${SKIP_PREFLIGHT:-0}"
RUN_FULL_LOAD="${RUN_FULL_LOAD:-0}"
POD_WAIT_TIMEOUT="${POD_WAIT_TIMEOUT:-300}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

# Ensure k3d context
ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"k3d-record-platform"* ]]; then
  k3d kubeconfig merge record-platform --kubeconfig-merge-default 2>/dev/null || true
  kubectl config use-context k3d-record-platform 2>/dev/null || { warn "k3d cluster record-platform not found."; exit 1; }
fi
ok "Context: $(kubectl config current-context)"

# 1. Build and load :dev images (needs network for npm/Docker)
if [[ "$SKIP_BUILD" != "1" ]]; then
  say "Step 1/4: Build and load service images into k3d..."
  "$SCRIPT_DIR/build-and-load-k3d.sh" record-platform || { warn "Build/load had failures; continuing anyway."; }
else
  info "Step 1/4: Skipping build (SKIP_BUILD=1)"
fi

# 2. Restart deployments so they pick up loaded images
say "Step 2/4: Restarting record-platform deployments..."
kubectl rollout restart deployment -n record-platform --timeout=60s 2>/dev/null || true
kubectl rollout status deployment -n record-platform --timeout=120s 2>/dev/null || true
ok "Rollout restarted"

# 3. Wait for pods (optional: wait for available)
say "Step 3/4: Waiting for pods (timeout ${POD_WAIT_TIMEOUT}s)..."
for i in $(seq 1 "$((POD_WAIT_TIMEOUT / 10))"); do
  not_ready=$(kubectl get pods -n record-platform --no-headers 2>/dev/null | grep -vE "Running|Completed" | grep -c . || echo "0")
  if [[ "${not_ready}" == "0" ]]; then
    ok "All record-platform pods running or completed"
    break
  fi
  [[ $i -eq $((POD_WAIT_TIMEOUT / 10)) ]] && warn "Some pods still not ready after ${POD_WAIT_TIMEOUT}s"
  sleep 10
done
kubectl get pods -n record-platform --no-headers 2>/dev/null | head -20

# 4. Preflight (k6 + suites; or full if RUN_FULL_LOAD=1)
if [[ "$SKIP_PREFLIGHT" != "1" ]]; then
  say "Step 4/4: Running preflight..."
  if [[ "$RUN_FULL_LOAD" == "1" ]]; then
    RUN_FULL_LOAD=1 RUN_K6=1 RUN_PGBENCH=1 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 || warn "Preflight had failures"
  else
    RUN_FULL_LOAD=0 RUN_K6=1 RUN_PGBENCH=0 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 || warn "Preflight had failures"
  fi
else
  info "Step 4/4: Skipping preflight (SKIP_PREFLIGHT=1)"
fi

ok "Full flow done. See above for any failures."
