#!/usr/bin/env bash
# Legacy entry: P0.hard_reset + Z.colima_clean (use those directly from cold-bootstrap).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/rp-hard-reset.sh"
bash "$SCRIPT_DIR/rp-colima-start-clean.sh"
