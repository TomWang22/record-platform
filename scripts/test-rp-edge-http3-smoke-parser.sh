#!/usr/bin/env bash
# Legacy entry: delegates to shared h2/h3 edge curl probe parser tests.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/test-rp-edge-curl-probe-parser.sh"
