#!/usr/bin/env bash
# Gate 5 v7 authorizer preflight — now verifies source-controlled StandardAuthorizer.
# Historical stop-gate that required authorizer absence is retired.
# Delegates to gate5-v7-authorizer-verify.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/gate5-v7-authorizer-verify.sh"
