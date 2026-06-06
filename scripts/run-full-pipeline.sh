#!/usr/bin/env bash
# Run the full pipeline: Kafka SSL → preflight → tooling → all 5 suites.
# Logs to run-all-suites.log and runs all the way through.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

LOG="${FULL_PIPELINE_LOG:-$REPO_ROOT/run-all-suites.log}"
touch "$LOG"

echo "=== Full pipeline started $(date +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"
echo "=== Full pipeline started $(date +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Log: $LOG" >> "$LOG"
echo "Log: $LOG"

export RUN_SUITES=1
export STRICT=1

set +e
set -o pipefail
"$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee -a "$LOG"
rc=$?
set -e
set +o pipefail

echo "" >> "$LOG"
if [[ $rc -eq 0 ]]; then
  echo "=== Full pipeline finished OK $(date +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"
  echo "=== Full pipeline finished OK $(date +%Y-%m-%dT%H:%M:%SZ) ==="
else
  echo "=== Full pipeline finished with exit $rc $(date +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"
  echo "=== Full pipeline finished with exit $rc $(date +%Y-%m-%dT%H:%M:%SZ) ==="
fi
exit $rc
