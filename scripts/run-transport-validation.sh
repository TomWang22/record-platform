#!/usr/bin/env bash
# Transport Validation — thin wrapper around Python CLI.
# Orchestration, config (transport-config.yaml), and experiment metadata live in the CLI.
# Usage: ./scripts/run-transport-validation.sh [--warmup] [--transport-gate] [--capture] [--v2] ...
# Or:   python3 scripts/run_transport_validation.py [same flags]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec python3 "$ROOT/scripts/run_transport_validation.py" "$@"
