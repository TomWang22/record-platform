#!/usr/bin/env bash
# Idempotent Colima bridge kubeconfig + API health (embedded in cold-bootstrap / make bootstrap).
# MetalLB IPs (.240–.242) are for Kafka/Caddy Services — not the Kubernetes API server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
export RP_LOG_BENCH="${RP_LOG_BENCH:-${RP_CB_BENCH:-$REPO_ROOT/bench_logs}}"
# shellcheck source=lib/rp-log.sh
source "$SCRIPT_DIR/lib/rp-log.sh"

if [[ "${RP_KUBE_ENSURE_SKIP:-0}" == "1" ]]; then
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "❌ kubectl required for cluster bootstrap" >&2
  exit 1
fi

if command -v colima >/dev/null 2>&1; then
  if ! colima status >/dev/null 2>&1; then
    echo "❌ colima is not running (start cluster before k8s phases)" >&2
    exit 1
  fi
fi

export RP_KUBE_ALIGN_QUIET="${RP_KUBE_ALIGN_QUIET:-1}"
export RP_KUBE_API_QUIET="${RP_KUBE_API_QUIET:-1}"

bash "$SCRIPT_DIR/rp-align-colima-kubeconfig.sh"
server="$(bash "$SCRIPT_DIR/rp-kube-api-health.sh")"
rp_success "kube API bridge healthy: $server"
