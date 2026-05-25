#!/usr/bin/env bash
# Strict HTTP/3 edge smoke — MetalLB EXTERNAL-IP only (--http3-only, --resolve, dev-chain.pem).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/rp-edge-strict-smoke-runner.sh
source "$SCRIPT_DIR/lib/rp-edge-strict-smoke-runner.sh"

STRESS="${RP_HTTP3_STRICT_CRITICAL_ATTEMPTS:-10}"
MIN_PASS="${RP_HTTP3_STRICT_CRITICAL_MIN_PASS:-10}"

rp_edge_strict_smoke_run h3 http3-strict "--http3-only" "$STRESS" "$MIN_PASS"
