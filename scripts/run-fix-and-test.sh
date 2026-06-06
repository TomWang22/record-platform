#!/usr/bin/env bash
# Run fix-and-test pipeline: Colima context, trim, preflight, ensure, scale,
# fresh CA+leaf reissue, strict TLS verify, pod check, then all 5 test suites.
# Logs to ./fix-and-test.log. Use: ./scripts/run-fix-and-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

LOG="${LOG:-$REPO_ROOT/fix-and-test.log}"
echo "=== Fix-and-test started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
RUN_REISSUE=1 RUN_SUITES=1 "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee -a "$LOG"
echo "=== Fix-and-test finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
