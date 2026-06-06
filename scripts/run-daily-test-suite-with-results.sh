#!/usr/bin/env bash
# Run preflight + full test suite once, save results to a timestamped dir, and print a short self-analyze (failures by suite/test).
# Use from host cron for daily runs, e.g.: 0 6 * * * /path/to/scripts/run-daily-test-suite-with-results.sh
# Optional: SUITE_LOG_PARENT=/var/log/record-platform ./scripts/run-daily-test-suite-with-results.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SUITE_LOG_PARENT="${SUITE_LOG_PARENT:-/tmp}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$SUITE_LOG_PARENT/daily-suite-$TS"
mkdir -p "$OUT_DIR"
FULL_LOG="$OUT_DIR/full.log"
SUMMARY="$OUT_DIR/summary.txt"
FAILURES="$OUT_DIR/failures.txt"

echo "=== Daily test suite run: $TS ==="
echo "Results: $OUT_DIR"

# Run full pipeline (preflight + suites). Suites runner uses SUITE_LOG_DIR when set.
export SUITE_LOG_DIR="$OUT_DIR/suite-logs"
mkdir -p "$SUITE_LOG_DIR"
if [[ ! -x "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" ]]; then
  echo "FAIL" > "$SUMMARY"
  echo "Not found: run-preflight-scale-and-all-suites.sh" >> "$SUMMARY"
  exit 1
fi
if "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh" 2>&1 | tee "$FULL_LOG"; then
  echo "PASS" > "$SUMMARY"
  echo "All suites passed." >> "$SUMMARY"
else
  echo "FAIL" > "$SUMMARY"
  echo "One or more suites failed." >> "$SUMMARY"
fi

# Self-analyze: narrow down scope (which suite, which test failed)
echo "" >> "$SUMMARY"
echo "--- Failure / error lines (narrow scope) ---" >> "$SUMMARY"
grep -E '(FAILED|❌|error|Error|ERROR|exit [1-9]|curl exit 77|SSL certificate|TLS.*failed|context deadline exceeded|dial.*failed)' "$FULL_LOG" 2>/dev/null | head -80 >> "$SUMMARY" || true

# Per-suite failure summary
echo "" >> "$SUMMARY"
echo "--- Per-suite result ---" >> "$SUMMARY"
for f in "$SUITE_LOG_DIR"/*.log; do
  [[ -f "$f" ]] || continue
  name=$(basename "$f" .log)
  if grep -qE 'FAILED|❌|exit 1' "$f" 2>/dev/null; then
    echo "FAIL: $name" >> "$SUMMARY"
    grep -E 'FAILED|❌|error|Error' "$f" 2>/dev/null | head -5 >> "$FAILURES" 2>/dev/null || true
  else
    echo "PASS: $name" >> "$SUMMARY"
  fi
done

echo ""
echo "Summary: $SUMMARY"
cat "$SUMMARY"
if [[ -f "$FAILURES" ]] && [[ -s "$FAILURES" ]]; then
  echo ""
  echo "Failure snippets: $FAILURES"
  head -30 "$FAILURES"
fi

exit 0
