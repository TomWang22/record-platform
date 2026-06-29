#!/usr/bin/env bash
# T20.15D-S — Allowlist hybrid canary API transcript (local artifacts only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/resolve-lb-ip.sh
source "$SCRIPT_DIR/lib/resolve-lb-ip.sh"

export E2E_API_BASE="${E2E_API_BASE:-https://record-platform.test}"
export AI_CONTRACT_EMAIL="${AI_CONTRACT_EMAIL:-e2e-contract@record-platform.local}"
export AI_CONTRACT_PASSWORD="${AI_CONTRACT_PASSWORD:-ContractPass123!}"
export CONTRACT_USER_ID="${CONTRACT_USER_ID:-2ed75568-7deb-4c29-91b0-6919f24a0c9f}"

exec python3 "$SCRIPT_DIR/rp-ai-hybrid-canary-transcript.py" "$@"
