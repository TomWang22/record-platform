#!/usr/bin/env bash
# Apply k3s API server and etcd tuning per docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md.
# Reduces API stalls and connection resets under burst writes (e.g. reissue step 2).
# Requires: Colima running with k3s. Run from repo root.
# Usage: ./scripts/apply-k3s-etcd-tuning.sh
# After running: k3s restarts; wait ~60s then re-run preflight or colima-forward-6443.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

info() { echo "ℹ️  $*"; }

if ! command -v colima >/dev/null 2>&1; then
  echo "❌ colima not found. This script is for Colima + k3s only."
  exit 1
fi
if ! colima status 2>&1 | grep -qi running; then
  echo "❌ Colima is not running."
  echo ""
  echo "  Start Colima with Kubernetes, then run this script again:"
  echo "    colima start --with-kubernetes"
  echo "    ./scripts/apply-k3s-etcd-tuning.sh"
  echo ""
  echo "  Or use a full teardown+start (recommended if you had API resets):"
  echo "    ./scripts/colima-teardown-and-start.sh"
  echo "    ./scripts/apply-k3s-etcd-tuning.sh"
  echo ""
  if [[ "${COLIMA_START:-0}" == "1" ]]; then
    say "Starting Colima (COLIMA_START=1)..."
    colima start --with-kubernetes 2>&1 || { echo "❌ colima start failed"; exit 1; }
    ok "Colima started; applying tuning..."
  else
    exit 1
  fi
fi

# Tuning profile: CONSERVATIVE (queue writes, avoid 503) vs default (400) vs AGGRESSIVE (higher throughput).
# See docs/COLIMA_K3S_ISSUES_AND_FIXES.md and docs/COLIMA_K3S_STABILITY_AND_METALLB.md.
if [[ "${CONSERVATIVE:-0}" == "1" ]]; then
  MUTATING_INFLIGHT=100
  REQUESTS_INFLIGHT=800
  info "Using CONSERVATIVE=1: max-mutating-requests-inflight=$MUTATING_INFLIGHT, max-requests-inflight=$REQUESTS_INFLIGHT"
elif [[ "${AGGRESSIVE:-0}" == "1" ]]; then
  MUTATING_INFLIGHT=300
  REQUESTS_INFLIGHT=1200
  info "Using AGGRESSIVE=1: max-mutating-requests-inflight=$MUTATING_INFLIGHT, max-requests-inflight=$REQUESTS_INFLIGHT (single-node throughput; still use chunked apply for large manifests)"
else
  MUTATING_INFLIGHT=400
  REQUESTS_INFLIGHT=800
fi

# Drop-in YAML for k3s (loaded after main config). Per stabilization plan.
K3S_DROPIN_NAME="50-control-plane-stabilization.yaml"
# shellcheck disable=SC2016
# API request timeout: longer to reduce flakiness (connection resets, 504). Default 60s; 300s helps slow applies.
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-300}"
K3S_DROPIN_CONTENT="# Control-plane stabilization: in-flight limits, request timeout, and etcd quota (single-node Colima).
# CONSERVATIVE=1 -> 100 mutating; AGGRESSIVE=1 -> 300 mutating / 1200 read; else 400/800.
# request-timeout=300s reduces flakiness from short timeouts. See docs/COLIMA_K3S_ISSUES_AND_FIXES.md
kube-apiserver-arg:
  - \"max-requests-inflight=${REQUESTS_INFLIGHT}\"
  - \"max-mutating-requests-inflight=${MUTATING_INFLIGHT}\"
  - \"default-watch-cache-size=200\"
  - \"request-timeout=${REQUEST_TIMEOUT}s\"
  - \"min-request-timeout=600\"
etcd-arg:
  - \"quota-backend-bytes=8589934592\"
  - \"max-request-bytes=1572864\"
  - \"snapshot-count=50000\"
"

say "Applying k3s/etcd tuning (Colima VM)..."
info "  Creating /etc/rancher/k3s/config.yaml.d/$K3S_DROPIN_NAME in VM"

# Ensure drop-in directory exists and write the file (use bash -c so redirection runs in VM)
colima ssh -- bash -c 'sudo mkdir -p /etc/rancher/k3s/config.yaml.d'
echo "$K3S_DROPIN_CONTENT" | colima ssh -- bash -c "sudo tee /etc/rancher/k3s/config.yaml.d/$K3S_DROPIN_NAME > /dev/null"
ok "Drop-in config written"

say "Restarting k3s (API will be unavailable for ~30–60s)..."
colima ssh -- sudo systemctl restart k3s
ok "k3s restart requested"

say "Waiting for API server (up to 90s)..."
for i in $(seq 1 18); do
  if kubectl get nodes --request-timeout=5s >/dev/null 2>&1; then
    ok "API server ready after $((i * 5))s"
    break
  fi
  [[ $i -eq 18 ]] && { warn "API not ready after 90s. Run: ./scripts/colima-forward-6443.sh && kubectl get nodes"; exit 0; }
  sleep 5
done

ok "Tuning applied. Re-run preflight when ready: METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh"
