#!/usr/bin/env bash
# T20.13E — Live inference telemetry harness with diagnostic embed warmup/retry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-network-contract.sh
source "$SCRIPT_DIR/lib/rp-network-contract.sh"
# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

usage() {
  cat <<'EOF'
Usage: rp-ai-live-inference-transcript.sh [options]

Read-only live inference telemetry harness. Writes local output under
bench_logs/ai-platform/live-inference/ (not committed).

Produces:
  <timestamp>.md
  <timestamp>.summary.json
  raw-<timestamp>/*.json

Options:
  --help              Show this help
  --skip-flagged      Skip flagged overlap diagnostic mode
  --skip-endpoints    Skip structured insight endpoints
  --embed-warmup-runs N          (default 3)
  --embed-warmup-threshold-ms M  (default 2000)
  --embed-retry-on-timeout N     (default 1)
  --embed-timeout-ms M           (default 5000, classification only)
  --no-embed-warmup              Skip pre-shadow embed warmup gate

Env:
  RP_COMB_EMAIL / RP_COMB_PASSWORD — contract auth (default e2e-contract)
  K8S_NS — kubernetes namespace (default record-platform)
  TARGET_IP — optional MetalLB override

Does not change production retrieval, vector default, or overlap flag defaults.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

export TARGET_IP="${TARGET_IP:-$(rp_discover_metallb_ip || true)}"
export K8S_NS="${K8S_NS:-record-platform}"

echo "=== T20.13E live inference telemetry harness ==="
exec python3 "$SCRIPT_DIR/rp-ai-live-inference-transcript.py" "$@"
