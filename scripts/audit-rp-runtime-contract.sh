#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
export OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/runtime-contract-audit}"
export RP_RUNTIME_AUDIT_MODE="${RP_RUNTIME_AUDIT_MODE:-all}"
python3 "$SCRIPT_DIR/lib/rp-runtime-contract-audit.py"
